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
        get: async () => ({ text: async () => record }),
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

  it("cron runs through the production entrypoint and rolls up yesterday and today idempotently", async () => {
    const f = fixture();
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const time = Date.parse(`${yesterday}T11:00:00Z`);
    f.sqlite
      .prepare(
        "INSERT INTO pageview_events (path,locale,country,timestamp) VALUES ('/es/blog','es','MX',?)",
      )
      .run(time);
    await worker.scheduled(
      { cron: "0 2 * * *" } as ScheduledController,
      f.env,
      f.ctx,
    );
    await f.drain();
    await worker.scheduled(
      { cron: "5 0 * * *" } as ScheduledController,
      f.env,
      f.ctx,
    );
    await f.drain();
    expect(
      f.sqlite
        .prepare(
          "SELECT total_views FROM pageviews_daily_summary WHERE summary_date=? AND path='/es/blog'",
        )
        .get(yesterday),
    ).toEqual({ total_views: 1 });
    f.sqlite.close();
  });

  it("does not overwrite a complete historical day with partially pruned raw events", async () => {
    const f = fixture();
    const date = new Date(Date.now() - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    f.sqlite
      .prepare(
        "INSERT INTO pageviews_daily_summary (summary_date,path,locale,country,total_views) VALUES (?, '/blog', 'en','XX', 9)",
      )
      .run(date);
    f.sqlite
      .prepare(
        "INSERT INTO pageview_events (path,locale,country,timestamp) VALUES ('/blog','en','XX',?)",
      )
      .run(Date.now() - 7 * 86_400_000 + 1_000);
    await worker.scheduled(
      { cron: "0 2 * * *" } as ScheduledController,
      f.env,
      f.ctx,
    );
    await f.drain();
    expect(
      f.sqlite
        .prepare(
          "SELECT total_views FROM pageviews_daily_summary WHERE summary_date=? AND path='/blog'",
        )
        .get(date),
    ).toEqual({ total_views: 9 });
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
      get: async () => ({ text: async () => `${record}\n${record}` }),
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
    expect(
      f.sqlite
        .prepare(
          "SELECT total_views FROM pageviews_daily_summary WHERE summary_date=? AND path='/es/blog'",
        )
        .get(yesterday),
    ).toEqual({ total_views: 1 });
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
    expect(body.quotas.workers_daily.used).toBeNull();
    expect(body.quotas.workers_monthly.used).toBeNull();
    expect(body.quotas.r2_class_a_monthly.used).toBeNull();
    expect(body.quotas.pages_builds_monthly.used).toBeNull();
    expect(body.quotas.usage_evidence).toMatchObject({
      workers: "unavailable",
      d1: "local_estimate",
    });
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
