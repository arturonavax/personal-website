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
  sqlite.exec(
    readFileSync("cloudflare/d1/migrations/0002_visit_dimensions.sql", "utf8"),
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
    expect(f.count("pageviews")).toBe(1);
    expect(f.count("pageview_events")).toBe(1);
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
    expect([
      f.count("pageviews"),
      f.count("pageview_events"),
      f.count("telemetry_events"),
    ]).toEqual([1, 1, 1]);
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

});
