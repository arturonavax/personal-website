import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import {
  D1TelemetryAdapter,
  clearL1DedupeCache,
} from "../src/lib/adapters/cloudflare/d1-telemetry.adapter";
import {
  reconcileR2WalToD1,
  handleAnalyticsRollup,
} from "../cloudflare/cron-scheduler";

const load = (name: string) => readFileSync(`cloudflare/d1/${name}`, "utf8");
function fixture(schema = "schema.sql") {
  const sqlite = new Database(":memory:");
  sqlite.exec(load(schema));
  const sql: string[] = [];
  const execSql: string[] = [];
  const db = {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          const statement = {
            sql: query,
            run: async () => {
              sqlite.prepare(query).run(...(args as never[]));
              return { success: true };
            },
          };
          return statement;
        },
      };
    },
    async batch(stmts: { sql: string; run: () => Promise<unknown> }[]) {
      sql.push(...stmts.map((s) => s.sql));
      for (const stmt of stmts) await stmt.run();
      return stmts.map(() => ({ success: true }));
    },
    async exec(query: string) {
      execSql.push(query);
      sqlite.exec(query);
    },
  } as unknown as D1Database;
  const rows = () =>
    sqlite
      .prepare("SELECT * FROM analytics_rollups ORDER BY date, path")
      .all() as Record<string, number | string>[];
  return { sqlite, db, rows, sql, execSql };
}
const timestamp = Date.UTC(2026, 9, 25, 12);
const visit = (key: string, ua: string, deviceType?: string) => ({
  path: "/blog",
  visitorHash: key,
  dedupeKey: key,
  skipL1Check: true,
  userAgent: ua,
  deviceType,
  nowMs: timestamp,
});
const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

describe("minimized device/OS rollups", () => {
  it("bootstrap and reset agree on the coarse rollup columns", () => {
    const fresh = fixture();
    const reset = fixture("reset.sql");
    for (const column of [
      "device_desktop",
      "device_mobile",
      "os_windows",
      "os_macos",
      "os_ios",
      "os_android",
      "os_linux",
      "os_other",
    ]) {
      for (const f of [fresh, reset])
        expect(
          f.sqlite
            .prepare("PRAGMA table_info(analytics_rollups)")
            .all()
            .some((c: any) => c.name === column),
        ).toBe(true);
    }
  });

  it("counts only coarse buckets in the existing rollup upsert and preserves views", async () => {
    const { db, rows, sql } = fixture();
    const adapter = new D1TelemetryAdapter(db);
    await adapter.ingestVisit(visit("a", windows, "desktop"));
    await adapter.ingestVisit(visit("b", iphone, "mobile"));
    expect(rows()[0]).toMatchObject({
      views: 2,
      uniques: 2,
      device_desktop: 1,
      device_mobile: 1,
      os_windows: 1,
      os_ios: 1,
    });
    expect(
      sql.filter((q) => q.includes("INSERT INTO analytics_rollups")),
    ).toHaveLength(2);
    expect(
      sql.some(
        (q) => q.includes("INSERT INTO telemetry_events") && q.includes("os_"),
      ),
    ).toBe(false);
  });

  it("does not count a repeated D1 insert after the L1 shield is lost", async () => {
    const { db, sqlite, rows } = fixture();
    const adapter = new D1TelemetryAdapter(db);
    const event = visit("retry", windows);
    await adapter.ingestVisit(event);
    await adapter.ingestVisit(event);
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM telemetry_events").get(),
    ).toEqual({ n: 1 });
    expect(rows()[0]).toMatchObject({ views: 1, uniques: 1, os_windows: 1 });
  });

  it("preserves L1 duplicate suppression without changing counters", async () => {
    clearL1DedupeCache();
    const { db, rows } = fixture();
    const adapter = new D1TelemetryAdapter(db);
    const first = { ...visit("dedupe-preserve", windows), skipL1Check: false };
    expect((await adapter.ingestVisit(first)).recorded).toBe(true);
    expect((await adapter.ingestVisit(first)).deduped).toBe(true);
    expect(rows()[0]).toMatchObject({ views: 1, os_windows: 1 });
    clearL1DedupeCache();
  });

  it("replays old WAL without OS as other, gating each rollup by its raw insert", async () => {
    const { db, rows, sql } = fixture();
    const records = [
      {
        dedupe_key: "old",
        path: "/blog",
        created_at: "2026-10-25T12:00:00.000Z",
        device_type: "desktop",
      },
      {
        dedupe_key: "new",
        path: "/blog",
        created_at: "2026-10-25T12:01:00.000Z",
        device_type: "mobile",
        os_type: "android",
      },
    ];
    const bucket = {
      list: async () => ({
        objects: [{ key: "wal/telemetry/test.ndjson" }],
        truncated: false,
      }),
      get: async () => ({
        text: async () => records.map((r) => JSON.stringify(r)).join("\n"),
      }),
      delete: async () => {},
    };
    await reconcileR2WalToD1({ DB: db, R2_BUCKET: bucket as never });
    expect(rows()[0]).toMatchObject({
      views: 2,
      device_desktop: 1,
      device_mobile: 1,
      os_other: 1,
      os_android: 1,
    });
    expect(
      sql.filter((q) => q.includes("INSERT INTO analytics_rollups")),
    ).toHaveLength(2);
  });

  it("replayed WAL keys cannot increment rollups more than once", async () => {
    const { db, sqlite, rows } = fixture();
    const record = {
      dedupe_key: "wal-repeat",
      path: "/blog",
      created_at: new Date().toISOString(),
      device_type: "mobile",
      os_type: "android",
    };
    const bucket = {
      list: async ({ prefix }: { prefix: string }) => ({
        objects:
          prefix === "wal/telemetry/"
            ? [{ key: "wal/telemetry/retry.ndjson" }]
            : [],
        truncated: false,
      }),
      get: async () => ({
        text: async () =>
          JSON.stringify(record) + "\n" + JSON.stringify(record),
      }),
      delete: async () => {},
    };
    await reconcileR2WalToD1({ DB: db, R2_BUCKET: bucket as never });
    await reconcileR2WalToD1({ DB: db, R2_BUCKET: bucket as never });
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM telemetry_events").get(),
    ).toEqual({ n: 1 });
    expect(rows()[0]).toMatchObject({
      views: 1,
      device_mobile: 1,
      os_android: 1,
    });
  });

  it("rebuilds complete daily summaries without overlap and prunes raw events", async () => {
    const { db, sqlite } = fixture();
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const insert = sqlite.prepare(
      "INSERT INTO pageview_events (path, locale, country, referrer, timestamp) VALUES ('/blog', 'en', 'XX', '', ?)",
    );
    insert.run(Date.parse(`${yesterday}T01:00:00Z`));
    insert.run(Date.parse(`${yesterday}T23:00:00Z`));
    insert.run(Date.parse(`${today}T01:00:00Z`));
    sqlite
      .prepare(
        "INSERT INTO telemetry_events (dedupe_key, path, event_type, visitor_hash, created_at) VALUES ('expired', '/blog', 'pageview', 'anon', '2020-01-01T00:00:00Z')",
      )
      .run();
    await handleAnalyticsRollup({ DB: db });
    await handleAnalyticsRollup({ DB: db });
    expect(
      sqlite
        .prepare(
          "SELECT summary_date, total_views FROM pageviews_daily_summary WHERE path = '/blog' ORDER BY summary_date",
        )
        .all(),
    ).toEqual([
      { summary_date: yesterday, total_views: 2 },
      { summary_date: today, total_views: 1 },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT count(*) AS n FROM telemetry_events WHERE dedupe_key = 'expired'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it("cron bounds new dimensions to 30 days without deleting historical views", async () => {
    const { db, sqlite, rows } = fixture();
    sqlite.exec(
      "INSERT INTO analytics_rollups (date,path,views,uniques,device_mobile,os_ios) VALUES ('2020-01-01','/old',3,3,2,2)",
    );
    await handleAnalyticsRollup({ DB: db });
    expect(rows()[0]).toMatchObject({
      views: 3,
      uniques: 3,
      device_mobile: 0,
      os_ios: 0,
    });
  });

  it("late WAL preserves old views without reviving dimensions or adding cleanup writes", async () => {
    const { db, sqlite, rows, sql, execSql } = fixture();
    sqlite.exec(
      "INSERT INTO analytics_rollups (date,path,views,uniques,device_mobile,os_ios) VALUES ('2020-01-01','/old',3,3,2,2)",
    );
    const records = [
      {
        dedupe_key: "late",
        path: "/old",
        created_at: "2020-01-01T00:00:00Z",
        device_type: "mobile",
        os_type: "ios",
      },
      {
        dedupe_key: "current",
        path: "/now",
        created_at: new Date().toISOString(),
        device_type: "mobile",
        os_type: "android",
      },
    ];
    const bucket = {
      list: async ({ prefix }: { prefix: string }) => ({
        objects:
          prefix === "wal/telemetry/"
            ? [{ key: "wal/telemetry/mixed.ndjson" }]
            : [],
        truncated: false,
      }),
      get: async () => ({
        text: async () =>
          records.map((record) => JSON.stringify(record)).join("\n"),
      }),
      delete: async () => {},
    };
    await handleAnalyticsRollup({ DB: db, R2_BUCKET: bucket as never });
    expect(rows().find((row) => row.path === "/old")).toMatchObject({
      views: 4,
      device_mobile: 0,
      os_ios: 0,
    });
    expect(rows().find((row) => row.path === "/now")).toMatchObject({
      views: 1,
      device_mobile: 1,
      os_android: 1,
    });
    expect(
      sql.filter((query) => query.includes("INSERT INTO analytics_rollups")),
    ).toHaveLength(2);
    expect(execSql).toHaveLength(2);
  });
});
