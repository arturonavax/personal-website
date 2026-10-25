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
function fixture(schema = "schema.sql", oldRollup = false) {
  const sqlite = new Database(":memory:");
  const source = load(schema);
  sqlite.exec(
    oldRollup
      ? source.replace(
          /^  (?:device_(?:desktop|mobile)|os_(?:windows|macos|ios|android|linux|other)) INTEGER NOT NULL DEFAULT 0,\n/gm,
          "",
        )
      : source,
  );
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
  it("bootstrap/reset and non-destructive 0011 agree; migration preserves old counts", () => {
    const fresh = fixture();
    const reset = fixture("reset.sql");
    const upgraded = fixture("schema.sql", true);
    upgraded.sqlite.exec(
      "INSERT INTO analytics_rollups (date,path,views,uniques) VALUES ('2026-10-24','/old',2,2)",
    );
    upgraded.sqlite.exec(load("migrations/0011_aggregate_device_os.sql"));
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
      for (const f of [fresh, reset, upgraded])
        expect(
          f.sqlite
            .prepare("PRAGMA table_info(analytics_rollups)")
            .all()
            .some((c: any) => c.name === column),
        ).toBe(true);
    }
    expect(upgraded.rows()[0]?.views).toBe(2);
    expect(upgraded.rows()[0]?.os_other).toBe(0);
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

  it("replays old WAL without OS as other and new WAL without extra aggregate writes", async () => {
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
    ).toHaveLength(1);
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
