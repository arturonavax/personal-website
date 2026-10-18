import { beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  clearRecentPageviewsCache,
  computeDedupeKey,
  recordAnalyticsNonBlocking,
  PAGEVIEW_DEDUPE_WINDOW_MS,
} from "../../cloudflare/worker";

/**
 * Real-SQLite verification of the authoritative L2 dedupe (migration 0010) and the atomic
 * pageview + rollup batch. A thin D1 shim over bun:sqlite executes the *exact* SQL the Worker emits,
 * so SQL semantics (ON CONFLICT, NOT EXISTS, changes()) are proven, not mocked.
 */

const MIGRATIONS_DIR = path.join(
  process.cwd(),
  "cloudflare",
  "d1",
  "migrations",
);
const MIGRATIONS = [
  "0001_initial_schema.sql",
  "0002_analytics_rollups.sql",
  "0009_telemetry_performance_indexes.sql",
  "0010_telemetry_dedupe_and_index_pruning.sql",
];

function createD1Shim() {
  const sqlite = new Database(":memory:");
  for (const file of MIGRATIONS) {
    sqlite.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        sql,
        params,
        run: async () => {
          sqlite.prepare(sql).run(...(params as never[]));
          return { success: true };
        },
        all: async () => ({
          results: sqlite.prepare(sql).all(...(params as never[])),
        }),
      }),
    }),
    batch: async (stmts: { sql: string; params: unknown[] }[]) => {
      sqlite.transaction(() => {
        for (const s of stmts)
          sqlite.prepare(s.sql).run(...(s.params as never[]));
      })();
      return stmts.map(() => ({ success: true }));
    },
  } as unknown as D1Database;
  const count = (table: string) =>
    (
      sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as {
        c: number;
      }
    ).c;
  return { db, sqlite, count };
}

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function humanRequest(urlPath: string, ip = "198.51.100.7", ua = CHROME_UA) {
  return new Request(`https://arturonavax.dev${urlPath}`, {
    headers: {
      "user-agent": ua,
      accept: "text/html",
      "accept-language": "en-US,en;q=0.9",
      "sec-fetch-dest": "document",
      "cf-connecting-ip": ip,
    },
  });
}

const BASE = 1_000_000_000_000; // divisible by the 5000 ms bucket size

async function recordAt(
  now: number,
  db: D1Database,
  urlPath: string,
  req = humanRequest(urlPath),
) {
  const realNow = Date.now;
  Date.now = () => now;
  try {
    await recordAnalyticsNonBlocking(req, urlPath, db, {} as never);
  } finally {
    Date.now = realNow;
  }
}

describe("Authoritative D1 pageview dedupe (migration 0010)", () => {
  beforeEach(() => clearRecentPageviewsCache());

  it("schema: UNIQUE dedupe_key exists and redundant indexes are pruned", () => {
    const { sqlite } = createD1Shim();
    const names = (
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='pageviews'",
        )
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toContain("idx_pageviews_dedupe_key");
    for (const pruned of [
      "idx_pageviews_perf_composite",
      "idx_pageviews_path_created",
      "idx_pageviews_country_created",
      "idx_pageviews_content",
      "idx_pageviews_referrer",
    ]) {
      expect(names).not.toContain(pruned);
    }
    for (const kept of [
      "idx_pageviews_created_at",
      "idx_pageviews_analytics",
      "idx_pageviews_visitor",
      "idx_pageviews_attribution",
    ]) {
      expect(names).toContain(kept);
    }
  });

  it("collapses a duplicate across isolates (L1 cleared) into ONE pageview and ONE rollup row", async () => {
    const { db, count } = createD1Shim();
    await recordAt(BASE + 100, db, "/blog/");
    clearRecentPageviewsCache(); // simulate a different isolate with an empty L1 cache
    await recordAt(BASE + 900, db, "/blog/");

    expect(count("pageviews")).toBe(1);
    expect(count("pageview_events")).toBe(1);
  });

  it("collapses duplicates that straddle a bucket boundary inside the window", async () => {
    const { db, count } = createD1Shim();
    await recordAt(BASE + PAGEVIEW_DEDUPE_WINDOW_MS - 1, db, "/experience/");
    clearRecentPageviewsCache();
    await recordAt(BASE + PAGEVIEW_DEDUPE_WINDOW_MS + 1, db, "/experience/");

    expect(count("pageviews")).toBe(1);
    expect(count("pageview_events")).toBe(1);
  });

  it("records again once the window has elapsed, and records distinct paths/visitors independently", async () => {
    const { db, count } = createD1Shim();
    await recordAt(BASE + 100, db, "/blog/");
    clearRecentPageviewsCache();
    await recordAt(BASE + 3 * PAGEVIEW_DEDUPE_WINDOW_MS, db, "/blog/"); // outside window
    await recordAt(BASE + 3 * PAGEVIEW_DEDUPE_WINDOW_MS + 10, db, "/projects/"); // other path
    await recordAt(
      BASE + 3 * PAGEVIEW_DEDUPE_WINDOW_MS + 20,
      db,
      "/blog/",
      humanRequest("/blog/", "203.0.113.9"), // other visitor
    );

    expect(count("pageviews")).toBe(3 + 0 + 0 + 0 === 3 ? 4 : 4);
    expect(count("pageview_events")).toBe(4);
  });

  it("normalizes trailing slashes/case so /Blog and /blog/ are the same page", async () => {
    const { db, count } = createD1Shim();
    await recordAt(BASE + 100, db, "/Blog/");
    clearRecentPageviewsCache();
    await recordAt(BASE + 200, db, "/blog");
    expect(count("pageviews")).toBe(1);
  });

  it("bots (search/AI) are recorded with is_bot=1 and NEVER feed human rollups", async () => {
    const { db, sqlite, count } = createD1Shim();
    const botUa =
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)";
    await recordAt(
      BASE + 100,
      db,
      "/blog/",
      humanRequest("/blog/", "192.0.2.50", botUa),
    );

    expect(count("pageviews")).toBe(1);
    expect(count("pageview_events")).toBe(0);
    const row = sqlite
      .prepare("SELECT is_bot, dedupe_key FROM pageviews")
      .get() as {
      is_bot: number;
      dedupe_key: string;
    };
    expect(row.is_bot).toBe(1);
    expect(row.dedupe_key).toHaveLength(32);
  });

  it("the UNIQUE index itself rejects a same-bucket race even if NOT EXISTS were bypassed", async () => {
    const { sqlite } = createD1Shim();
    const key = await computeDedupeKey("hash", "/blog", 1);
    sqlite.exec(
      `INSERT INTO pageviews (path, visitor_hash, is_bot, dedupe_key) VALUES ('/blog','hash',0,'${key}')`,
    );
    expect(() =>
      sqlite.exec(
        `INSERT INTO pageviews (path, visitor_hash, is_bot, dedupe_key) VALUES ('/blog','hash',0,'${key}')`,
      ),
    ).toThrow();
  });
});
