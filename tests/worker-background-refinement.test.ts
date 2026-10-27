import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { reconcileR2WalToD1 } from "../cloudflare/cron-scheduler";
import { processIncomingEmail } from "../cloudflare/email-worker";

const encode = (s: string) => new TextEncoder().encode(s);
const body = (s: string) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encode(s)); c.close(); } });
function fixture(entries: Record<string, string>) {
  const sqlite = new Database(":memory:");
  sqlite.exec(readFileSync("cloudflare/d1/schema.sql", "utf8"));
  const objects = new Map(Object.entries(entries));
  const deleted: string[] = [];
  const bucket = {
    list: async ({ prefix, limit, cursor }: { prefix: string; limit: number; cursor?: string }) => {
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? keys.findIndex(k => k > cursor) : 0;
      const page = keys.slice(Math.max(start, 0), Math.max(start, 0) + limit);
      return { objects: page.map(key => ({ key })), truncated: keys.length > Math.max(start, 0) + limit, cursor: page.at(-1) };
    },
    get: async (key: string) => { const text = objects.get(key); return text === undefined ? null : { size: encode(text).byteLength, body: body(text) }; },
    delete: async (keys: string[]) => { for (const key of keys) { deleted.push(key); objects.delete(key); } },
  };
  let failAt = 0;
  let failMidBatch = false;
  let calls = 0;
  const db = {
    prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({ run: async () => { calls++; if (calls === failAt) throw Error("db failed"); sqlite.prepare(sql).run(...(params as never[])); return { success: true }; }, sql, params }) }),
    batch: async (stmts: { sql: string; params: unknown[] }[]) => { calls++; if (calls === failAt) throw Error("db failed"); const results: { success: true; meta: { rows_written: number } }[] = []; sqlite.transaction(() => { for (const s of stmts) { if (failMidBatch && results.length === 1) throw Error("mid-batch failure"); const info = sqlite.prepare(s.sql).run(...(s.params as never[])); results.push({ success: true, meta: { rows_written: info.changes } }); } })(); return results; },
    exec: async (sql: string) => { sqlite.exec(sql); },
  } as unknown as D1Database;
  const count = (table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { sqlite, objects, deleted, bucket, db, count, fail: () => { failAt = calls + 1; }, failMid: () => { failMidBatch = true; }, clearFail: () => { failAt = 0; failMidBatch = false; } };
}
const event = (id: string) => JSON.stringify({ dedupe_key: id, path: "/blog", created_at: new Date().toISOString(), is_bot: 0 });
const lead = JSON.stringify({ name: "A", from_email: "a@example.test", body: "Hello" });
const run = (f: ReturnType<typeof fixture>) => reconcileR2WalToD1({ DB: f.db, R2_BUCKET: f.bucket as never });

describe("bounded background replay", () => {
  it("retains invalid neighbors, commits valid rows and never acknowledges malformed lines", async () => {
    const f = fixture({ "wal/telemetry/a": event("a") + "\n{bad", "wal/telemetry/b": event("b"), "wal/leads/c": "{}", "wal/leads/d": lead });
    const result = await run(f);
    expect(f.deleted).toEqual(["wal/telemetry/b", "wal/leads/d"]);
    expect(result.telemetryEventsInserted).toBe(1);
    expect(result.leadsInserted).toBe(1);
    expect(f.count("telemetry_events")).toBe(1);
    expect(f.count("contact_leads")).toBe(1);
    expect(f.objects.size).toBe(2);
  });
  it("caps actual bytes even when R2 size under-reports, retaining oversized object", async () => {
    const f = fixture({ "wal/telemetry/a": event("a") + " ".repeat(100_000), "wal/telemetry/b": event("b") });
    const original = f.bucket.get;
    f.bucket.get = async (key: string) => { const value = await original(key); return value && { ...value, size: key.endsWith("/a") ? 1 : value.size }; };
    await run(f);
    expect(f.deleted).toEqual(["wal/telemetry/b"]);
    expect(f.count("telemetry_events")).toBe(1);
  });
  it("retains a truncated object but replays a valid neighbor", async () => {
    const f = fixture({ "wal/telemetry/a": event("a"), "wal/telemetry/b": event("b") });
    const original = f.bucket.get;
    f.bucket.get = async (key: string) => { const value = await original(key); return value && key.endsWith("/a") ? { ...value, size: value.size + 10 } : value; };
    await run(f);
    expect(f.deleted).toEqual(["wal/telemetry/b"]);
    expect(f.count("telemetry_events")).toBe(1);
  });
  it("reserves the 256 KiB run byte budget and retains deferred objects", async () => {
    const padded = (id: string) => event(id) + " ".repeat(60_000);
    const f = fixture(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`wal/telemetry/${i}`, padded(String(i))])));
    await run(f);
    expect(f.deleted).toHaveLength(4);
    expect(f.count("telemetry_events")).toBe(4);
    expect(f.objects.size).toBe(2);
    await run(f);
    expect(f.objects.size).toBe(0);
  });
  it("defers record and statement overload without deleting, then retries after backlog reduction", async () => {
    const records = Array.from({ length: 300 }, (_, i) => event(String(i))).join("\n");
    const f = fixture({ "wal/telemetry/a": records, "wal/telemetry/b": event("b") });
    await run(f);
    expect(f.objects.has("wal/telemetry/a")).toBe(true);
    expect(f.count("telemetry_events")).toBeLessThan(300);
    expect(f.deleted).toContain("wal/telemetry/b");
    f.objects.set("wal/telemetry/a", event("a"));
    await run(f);
    expect(f.objects.size).toBe(0);
  });
  it("looks past poisoned head keys within bounded selection without deleting them", async () => {
    const entries = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`wal/telemetry/${String(i).padStart(2, "0")}`, "{invalid"]));
    const f = fixture({ ...entries, "wal/telemetry/20": event("later") });
    await run(f);
    expect(f.deleted).toEqual(["wal/telemetry/20"]);
    expect(f.objects.size).toBe(20);
    expect(f.count("telemetry_events")).toBe(1);
  });
  it("preserves separate identical lead submissions and acknowledges both objects", async () => {
    const identical = JSON.stringify({ ...JSON.parse(lead), created_at: "2026-10-18T00:00:00.000Z" });
    const f = fixture({ "wal/leads/a": identical, "wal/leads/b": identical });
    const result = await run(f);
    expect(result.leadsInserted).toBe(2);
    expect(result.leadObjectsProcessed).toBe(2);
    expect(f.count("contact_leads")).toBe(2);
    expect(f.deleted).toEqual(["wal/leads/a", "wal/leads/b"]);
    expect(f.objects.size).toBe(0);
  });
  it("keeps a failed lead batch unacknowledged and retries telemetry keys idempotently", async () => {
    const f = fixture({ "wal/telemetry/a": event("a"), "wal/leads/a": lead });
    f.fail();
    await expect(run(f)).rejects.toThrow("db failed");
    expect(f.deleted).toEqual([]);
    expect(f.count("contact_leads")).toBe(0);
    expect(f.count("telemetry_events")).toBe(0);
    f.clearFail();
    await run(f);
    f.objects.set("wal/telemetry/a", event("a"));
    const retry = await run(f);
    expect(retry.telemetryEventsInserted).toBe(0);
    expect(f.count("telemetry_events")).toBe(1);
    expect(f.count("contact_leads")).toBe(1);
  });
  it("retains DB failures and replay remains idempotent after partial prior writes", async () => {
    const f = fixture({ "wal/telemetry/a": event("a") });
    f.failMid();
    await expect(run(f)).rejects.toThrow("mid-batch failure");
    expect(f.deleted).toEqual([]);
    expect(f.count("telemetry_events")).toBe(0);
    expect(f.count("analytics_rollups")).toBe(0);
    f.clearFail();
    await run(f);
    f.objects.set("wal/telemetry/a", event("a"));
    await run(f);
    expect(f.count("telemetry_events")).toBe(1);
    expect(f.count("analytics_rollups")).toBe(1);
  });
});

describe("incoming email", () => {
  const message = (text: string, rawSize: number) => {
    let rejection = "";
    return { value: { from: "sender@example.test", to: "inbox@example.test", headers: new Headers({ subject: "Inquiry" }), raw: body(text), rawSize, setReject: (reason: string) => { rejection = reason; }, forward: async () => {} }, rejected: () => rejection };
  };
  it("rejects declared and actual oversized streams without D1 writes", async () => {
    for (const size of [65_537, 1]) {
      const f = fixture({});
      const m = message("X".repeat(65_537), size);
      const pending: Promise<unknown>[] = [];
      await processIncomingEmail(m.value, { DB: f.db }, { waitUntil: p => pending.push(p) } as never);
      await Promise.all(pending);
      expect(m.rejected()).not.toBe("");
      expect(f.count("contact_leads")).toBe(0);
    }
  });
  it("accepted email persists through waitUntil without a webhook", async () => {
    const f = fixture({});
    const m = message("hello", 5);
    const pending: Promise<unknown>[] = [];
    await processIncomingEmail(m.value, { DB: f.db }, { waitUntil: p => pending.push(p) } as never);
    await Promise.all(pending);
    expect(m.rejected()).toBe("");
    expect(f.count("contact_leads")).toBe(1);
  });
});
