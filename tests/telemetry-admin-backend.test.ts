import { beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import worker from "../cloudflare/entrypoint";
import { clearRecentPageviewsCache } from "../cloudflare/worker";
import { edgeQuotaTracker } from "../src/lib/adapters";

function fixture() {
  const sqlite = new Database(":memory:");
  sqlite.exec(
    readFileSync("cloudflare/d1/migrations/0001_initial_schema.sql", "utf8"),
  );
  const db = {
    prepare(sql: string) {
      const bind = (...args: unknown[]) => ({
        sql,
        args,
        run: async () => {
          const result = sqlite.prepare(sql).run(...(args as never[]));
          return {
            success: true,
            meta: { rows_written: result.changes, rows_read: 0 },
          };
        },
        all: async () => ({
          results: sqlite.prepare(sql).all(...(args as never[])),
          meta: { rows_read: 1 },
        }),
        first: async () => sqlite.prepare(sql).get(...(args as never[])),
      });
      return { bind, ...bind() };
    },
    batch: async (statements: { sql: string; args: unknown[] }[]) =>
      sqlite.transaction(() =>
        statements.map(({ sql, args }) => {
          const result = sqlite.prepare(sql).run(...(args as never[]));
          return {
            success: true,
            meta: { rows_written: result.changes, rows_read: 0 },
          };
        }),
      )(),
    exec: async (sql: string) => {
      sqlite.exec(sql);
    },
  } as unknown as D1Database;
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  } as ExecutionContext;
  const env = {
    DB: db,
    ASSETS: {
      fetch: async () =>
        new Response("<html>ok</html>", {
          headers: { "Content-Type": "text/html" },
        }),
    },
  } as never;
  const drain = async () => {
    await Promise.all(pending.splice(0));
  };
  const count = (table: string) =>
    (
      sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
        n: number;
      }
    ).n;
  return { sqlite, db, ctx, env, drain, count };
}

function document(path: string, ip = "198.51.100.4") {
  return new Request(`https://arturonavax.dev${path}`, {
    headers: {
      accept: "text/html",
      "sec-fetch-dest": "document",
      "cf-connecting-ip": ip,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
      "accept-language": "es-MX,es;q=0.8",
    },
  });
}

beforeEach(() => {
  clearRecentPageviewsCache();
  edgeQuotaTracker.reset();
});

describe("production-shaped telemetry and admin contracts", () => {
  it("records nominal documents in the same raw/rollup path as collector, with bounded dimensions and no repeat", async () => {
    const f = fixture();
    const req = document("/es/blog/");
    Object.defineProperty(req, "cf", {
      value: { country: "MX", region: "Jalisco" },
    });
    const first = await worker.fetch(req, f.env, f.ctx);
    await f.drain();
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Edge-Visit-Logged")).toBe("1");
    expect(f.count("telemetry_events")).toBe(1);
    expect(
      f.sqlite
        .prepare(
          "SELECT views, human_views FROM analytics_rollups WHERE path='/es/blog'",
        )
        .get(),
    ).toEqual({ views: 1, human_views: 1 });
    expect(
      f.sqlite
        .prepare(
          "SELECT country, region, os_type, device_type, browser, browser_language FROM telemetry_events",
        )
        .get(),
    ).toEqual({
      country: "MX",
      region: "Jalisco",
      os_type: "windows",
      device_type: "desktop",
      browser: "chrome",
      browser_language: "es-MX",
    });
    await worker.fetch(document("/es/blog/"), f.env, f.ctx);
    await f.drain();
    expect(f.count("telemetry_events")).toBe(1);
    expect(
      f.sqlite
        .prepare("SELECT views FROM analytics_rollups WHERE path='/es/blog'")
        .get(),
    ).toEqual({ views: 1 });
    f.sqlite.close();
  });

  it("normalizes absent or hostile dimensions to unknown without persisting headers", async () => {
    const f = fixture();
    const req = new Request("https://arturonavax.dev/en/blog/", {
      headers: {
        accept: "text/html",
        "sec-fetch-dest": "document",
        "cf-connecting-ip": "198.51.100.13",
        "user-agent": "arbitrary browser token",
        "accept-language": "es-MX<script>",
      },
    });
    Object.defineProperty(req, "cf", {
      value: { country: "MEXICO", region: "<script>" },
    });
    expect((await worker.fetch(req, f.env, f.ctx)).status).toBe(200);
    await f.drain();
    expect(
      f.sqlite
        .prepare(
          "SELECT country, region, os_type, browser, browser_language FROM telemetry_events",
        )
        .get(),
    ).toEqual({
      country: "XX",
      region: "unknown",
      os_type: "unknown",
      browser: "unknown",
      browser_language: "unknown",
    });
    expect(f.count("telemetry_events")).toBe(1);
    f.sqlite.close();
  });

  it("persists a valid script-and-region language preference with optional quality and an unknown device", async () => {
    const f = fixture();
    const req = new Request("https://arturonavax.dev/en/blog/", {
      headers: {
        accept: "text/html",
        "sec-fetch-dest": "document",
        "cf-connecting-ip": "198.51.100.19",
        "user-agent": "Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36",
        "accept-language": "zh-Hant-TW;q=0.9,en;q=0.8",
      },
    });
    expect((await worker.fetch(req, f.env, f.ctx)).status).toBe(200);
    await f.drain();
    expect(
      f.sqlite
        .prepare(
          "SELECT device_type, os_type, browser, browser_language FROM telemetry_events",
        )
        .get(),
    ).toEqual({
      device_type: "unknown",
      os_type: "unknown",
      browser: "chrome",
      browser_language: "zh-Hant-TW",
    });
    expect(f.count("telemetry_events")).toBe(1);
    f.sqlite.close();
  });

  it("replays unknown raw dimensions without inferring a desktop from an absent UA", async () => {
    const f = fixture();
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const record = JSON.stringify({
      dedupe_key: "unknown-wal",
      path: "/en/blog",
      event_type: "pageview",
      visitor_hash: "fixture",
      is_bot: 0,
      device_type: "unknown",
      os_type: "other",
      browser: "unknown",
      browser_language: "zh-Hant-TW",
      created_at: `${yesterday}T11:00:00.000Z`,
    });
    const env = {
      ...f.env,
      STORAGE_BUCKET: {
        list: async () => ({
          objects: [{ key: `wal/telemetry/${yesterday}/unknown.ndjson` }],
          truncated: false,
        }),
        get: async () => ({ size: new TextEncoder().encode(record).byteLength, body: new Blob([record]).stream() }),
        delete: async () => {},
      },
    };
    await worker.scheduled(
      { cron: "0 2 * * *" } as ScheduledController,
      env,
      f.ctx,
    );
    await f.drain();
    expect(
      f.sqlite
        .prepare("SELECT device_type, browser_language FROM telemetry_events")
        .get(),
    ).toEqual({ device_type: "unknown", browser_language: "zh-Hant-TW" });
    expect(f.count("telemetry_events")).toBe(1);
    f.sqlite.close();
  });

  it("cron prunes aged human raw detail but keeps 30-day sampled bot detail", async () => {
    const f = fixture();
    const insert = f.sqlite.prepare("INSERT INTO telemetry_events (dedupe_key,path,visitor_hash,is_bot,created_at) VALUES (?, '/blog','fixture',?,?)");
    insert.run("old-human", 0, new Date(Date.now() - 8 * 86_400_000).toISOString());
    insert.run("old-bot", 1, new Date(Date.now() - 8 * 86_400_000).toISOString());
    insert.run("expired-bot", 1, new Date(Date.now() - 31 * 86_400_000).toISOString());
    await worker.scheduled({ cron: "0 2 * * *" } as ScheduledController, f.env, f.ctx);
    await f.drain();
    await worker.scheduled({ cron: "5 0 * * *" } as ScheduledController, f.env, f.ctx);
    await f.drain();
    expect(f.sqlite.prepare("SELECT dedupe_key FROM telemetry_events").all()).toEqual([{ dedupe_key: "old-bot" }]);
    f.sqlite.close();
  });

  it("replays a raw WAL visit with dimensions before cron summary and never double counts a retry", async () => {
    const f = fixture();
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const key = `wal/telemetry/${yesterday}/fixture.ndjson`;
    const record = JSON.stringify({
      dedupe_key: "retry-wal",
      path: "/es/blog",
      event_type: "pageview",
      visitor_hash: "fixture",
      is_bot: 0,
      country: "MX",
      region: "Jalisco",
      device_type: "mobile",
      os_type: "android",
      browser: "chrome",
      browser_language: "es-MX",
      created_at: `${yesterday}T11:00:00.000Z`,
    });
    const bucket = {
      list: async ({ prefix }: { prefix: string }) => ({
        objects: prefix === "wal/telemetry/" ? [{ key }] : [],
        truncated: false,
      }),
      get: async () => ({ size: new TextEncoder().encode(`${record}\n${record}`).byteLength, body: new Blob([`${record}\n${record}`]).stream() }),
      delete: async () => {}, // simulated lost acknowledgement; replay repeats
    };
    const env = { ...f.env, STORAGE_BUCKET: bucket };
    for (let i = 0; i < 2; i++) {
      await worker.scheduled(
        { cron: "0 2 * * *" } as ScheduledController,
        env,
        f.ctx,
      );
      await f.drain();
    }
    expect(f.count("telemetry_events")).toBe(1);
    expect(
      f.sqlite
        .prepare(
          "SELECT country, region, os_type, device_type, browser, browser_language FROM telemetry_events",
        )
        .get(),
    ).toEqual({
      country: "MX",
      region: "Jalisco",
      os_type: "android",
      device_type: "mobile",
      browser: "chrome",
      browser_language: "es-MX",
    });
    expect(
      f.sqlite
        .prepare("SELECT views FROM analytics_rollups WHERE path='/es/blog'")
        .get(),
    ).toEqual({ views: 1 });
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('pageview_events','pageviews_daily_summary')").get()).toEqual({ n: 0 });
    f.sqlite.close();
  });

  it("does not acknowledge an unpersisted contact lead as received", async () => {
    const f = fixture();
    const request = () =>
      new Request("https://arturonavax.dev/api/contact", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "198.51.100.9",
        },
        body: JSON.stringify({
          name: "Test Visitor",
          email: "visitor@example.org",
          subject: "Question",
          message: "Could we talk about a project?",
        }),
      });
    const missing = await worker.fetch(
      request(),
      { ...f.env, DB: undefined },
      f.ctx,
    );
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ status: "unavailable" });
    expect(f.count("contact_leads")).toBe(0);
    const ok = await worker.fetch(request(), f.env, f.ctx);
    expect(ok.status).toBe(200);
    expect(f.count("contact_leads")).toBe(1);
    f.sqlite.close();
  });

  it("never invokes provider fetch on unauthenticated metrics or public speculative requests", async () => {
    const f = fixture();
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw Error("unexpected provider network"); };
    try {
      const env = { ...f.env, CLOUDFLARE_ANALYTICS_API_TOKEN: "fake-local-token", CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "dummy" };
      const unauthorized = await worker.fetch(new Request("https://arturonavax.dev/api/metrics"), env, f.ctx);
      expect(unauthorized.status).toBe(403);
      expect(await unauthorized.json()).toMatchObject({ error: expect.any(String) });
      const prefetch = await worker.fetch(new Request("https://arturonavax.dev/blog/?astro-prefetch", { headers: { accept: "text/html" } }), env, f.ctx);
      await f.drain();
      expect(prefetch.status).toBe(200);
      expect(calls).toBe(0);
      expect(f.count("telemetry_events")).toBe(0);
    } finally { globalThis.fetch = original; f.sqlite.close(); }
  });

  it("publishes one provider gauge shape while retaining local enforcement", async () => {
    const f = fixture();
    const env = { ...f.env, ADMIN_ACCESS_TOKEN: "test-only-admin-token-at-least-20" };
    const get = (path: string) => worker.fetch(new Request(`https://arturonavax.dev${path}`, { headers: { Authorization: `Bearer ${env.ADMIN_ACCESS_TOKEN}` } }), env, f.ctx);
    for (const path of ["/api/metrics?fresh=true", "/api/telemetry?fresh=true"]) {
      const res = await get(path);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Object.keys(data.quotas).sort()).toEqual(["degradation_tier", "degradation_tier_name", "is_d1_reads_exceeded", "is_d1_writes_exceeded", "plan_tier", "provider_usage", "strategy"].sort());
      expect(data.quotas.strategy.daily_write_budget).toBe(100000);
      expect(data.quotas.provider_usage?.workers_requests.used ?? null).toBeNull();
    }
    expect(f.count("telemetry_events")).toBe(0);
    f.sqlite.close();
  });

  it("isolates the outer private metrics cache by provider configuration and UTC date", async () => {
    const f = fixture();
    const previousFetch = globalThis.fetch;
    const RealDate = Date;
    let clock = new RealDate("2026-10-28T12:00:00Z").getTime();
    const requests: string[] = [];
    globalThis.Date = class extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date>) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    } as DateConstructor;
    globalThis.fetch = async (input, init) => {
      requests.push(String(input));
      if (String(input).includes("/access/users")) return Response.json({ success: true, result: [], result_info: { page: 1, total_pages: 1 } });
      const query = JSON.parse(String(init?.body)).query as string;
      const value = (init?.headers as Record<string, string>).Authorization.includes("token-b") ? 9 : 3;
      const field = ["workersInvocationsAdaptive", "d1AnalyticsAdaptiveGroups", "r2StorageAdaptiveGroups", "r2OperationsAdaptiveGroups"].find((item) => query.includes(item));
      const rows = field === "workersInvocationsAdaptive" ? [{ sum: { requests: value } }] : field === "d1AnalyticsAdaptiveGroups" ? [{ sum: { rowsRead: value, rowsWritten: 0 } }] : field === "r2StorageAdaptiveGroups" ? [{ max: { payloadSize: value, metadataSize: 0 }, dimensions: { datetime: new RealDate(clock).toISOString() } }] : [];
      return Response.json({ data: { viewer: { accounts: [{ [field!]: rows }] } } });
    };
    try {
      const common = { ...f.env, ADMIN_ACCESS_TOKEN: "test-only-admin-token-at-least-20", CLOUDFLARE_ANALYTICS_DATABASE_ID: "db" };
      const get = async (config: object) => {
        const res = await worker.fetch(new Request("https://arturonavax.dev/api/metrics", { headers: { Authorization: "Bearer test-only-admin-token-at-least-20" } }), { ...common, ...config }, f.ctx);
        return { status: res.status, header: res.headers.get("X-Telemetry-Source"), body: await res.json() };
      };
      const a = { CLOUDFLARE_ANALYTICS_API_TOKEN: "token-a", CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "account-a", CLOUDFLARE_ANALYTICS_BUCKET_NAME: "bucket-a" };
      const first = await get(a);
      expect(first.status).toBe(200);
      expect(first.body.quotas.provider_usage.workers_requests.used).toBe(3);
      const count = requests.length;
      expect((await get(a)).header).toBe("edge-memory-cache");
      expect(requests).toHaveLength(count);
      const changed = await get({ ...a, CLOUDFLARE_ANALYTICS_API_TOKEN: "token-b" });
      expect(changed.header).not.toBe("edge-memory-cache");
      expect(changed.body.quotas.provider_usage.workers_requests.used).toBe(9);
      for (const config of [{ ...a, CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "account-b" }, { ...a, CLOUDFLARE_ANALYTICS_BUCKET_NAME: "bucket-b" }]) {
        const before = requests.length;
        expect((await get(config)).header).not.toBe("edge-memory-cache");
        expect(requests.length).toBeGreaterThan(before);
      }
      clock = new RealDate("2026-10-29T00:00:00Z").getTime();
      const today = await get(a);
      expect(today.header).not.toBe("edge-memory-cache");
      expect(today.body.quotas.provider_usage.workers_requests.period).toContain("2026-10-29");
      expect(f.count("telemetry_events")).toBe(0);
    } finally { globalThis.Date = RealDate; globalThis.fetch = previousFetch; f.sqlite.close(); }
  });

  it("does not present fabricated provider usage as measured counters", async () => {
    const f = fixture();
    const env = {
      ...f.env,
      ADMIN_ACCESS_TOKEN: "test-only-admin-token-at-least-20",
    };
    const response = await worker.fetch(
      new Request("https://arturonavax.dev/api/metrics?fresh=true", {
        headers: { Authorization: "Bearer test-only-admin-token-at-least-20" },
      }),
      env,
      f.ctx,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { quotas: Record<string, any> };
    expect(body.quotas.provider_usage.workers_requests).toMatchObject({ used: null, status: "setup_required" });
    expect(body.quotas.provider_usage.d1_rows_read.used).toBeNull();
    expect(body.quotas.provider_usage.r2_class_a.used).toBeNull();
    expect(body.quotas.strategy.daily_write_budget).toBe(100000);
    expect(body.quotas.workers_daily).toBeUndefined();
    expect(body.quotas.workers_monthly).toBeUndefined();
    expect(body.quotas.pages_builds_monthly).toBeUndefined();
    f.sqlite.close();
  });

  it("distinguishes unavailable and degraded leads from observed empty success", async () => {
    const f = fixture();
    const auth = {
      ...f.env,
      ADMIN_ACCESS_TOKEN: "test-only-admin-token-at-least-20",
    };
    const get = (env: unknown) =>
      worker.fetch(
        new Request("https://arturonavax.dev/api/leads?fresh=true", {
          headers: {
            Authorization: "Bearer test-only-admin-token-at-least-20",
          },
        }),
        env as never,
        f.ctx,
      );
    const ok = await get(auth);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "ok", leads: [] });
    const missing = await get({ ...auth, DB: undefined });
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({
      status: "unavailable",
      leads: [],
    });
    edgeQuotaTracker.setCountsForTesting(90_000, 0);
    const degraded = await get(auth);
    expect(degraded.status).toBe(503);
    expect(await degraded.json()).toMatchObject({
      status: "degraded",
      leads: [],
    });
    f.sqlite.close();
  });
});
