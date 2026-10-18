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
const MIGRATIONS = ["0001_initial_schema.sql"];

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

import worker from "../../cloudflare/worker";
import {
  D1TelemetryAdapter,
  QuotaDegradationTier,
  edgeQuotaTracker,
  flushCompactRollupBuffer,
} from "../../src/lib/adapters";
import { reconcileR2WalToD1 } from "../../cloudflare/cron-scheduler";

function createMockR2Bucket() {
  const objects = new Map<string, string>();
  return {
    objects,
    put: async (key: string, value: unknown) => {
      const str =
        typeof value === "string"
          ? value
          : value instanceof Uint8Array
            ? new TextDecoder().decode(value)
            : String(value);
      objects.set(key, str);
      return { key };
    },
    get: async (key: string) => {
      const val = objects.get(key);
      if (val === undefined) return null;
      return {
        text: async () => val,
        arrayBuffer: async () => new TextEncoder().encode(val).buffer,
        body: new ReadableStream(),
        httpMetadata: { contentType: "application/x-ndjson" },
        size: val.length,
        etag: "mock-etag",
      };
    },
    delete: async (keys: string | string[]) => {
      if (Array.isArray(keys)) {
        for (const k of keys) objects.delete(k);
      } else {
        objects.delete(keys);
      }
    },
    list: async (opts?: { prefix?: string; limit?: number }) => {
      const prefix = opts?.prefix || "";
      const matched = [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .slice(0, opts?.limit || 1000)
        .map((key) => ({ key }));
      return { objects: matched, truncated: false };
    },
  };
}

describe("Task 6: 30m L1 Cache Dedupe, 5-Tier Degradation, R2 WAL & Static Bypass", () => {
  beforeEach(() => {
    clearRecentPageviewsCache();
    edgeQuotaTracker.reset();
  });

  it("1. 30m L1 Cache Dedupe & SPA Double-Count Prevention: 1 SSR visit + 5 SPA transitions within 30m produce 1 D1 write", async () => {
    const { db, count } = createD1Shim();
    const adapter = new D1TelemetryAdapter(db);
    const t0 = 1_700_000_000_000;

    // Initial SSR / document visit
    const first = await adapter.ingestVisit({
      path: "/en/blog/post-1",
      visitorHash: "visitor-abc-123",
      eventType: "pageview",
      isBot: false,
      country: "US",
      referrerHost: "google.com",
      nowMs: t0,
    });
    expect(first.recorded).toBe(true);
    expect(first.deduped).toBe(false);
    expect(first.storageTier).toBe("D1");
    expect(count("telemetry_events")).toBe(1);
    expect(count("analytics_rollups")).toBe(1);

    // 5 rapid SPA transitions / refreshes within the 30-minute window
    for (let i = 1; i <= 5; i++) {
      const subsequent = await adapter.ingestVisit({
        path: "/en/blog/post-1/",
        visitorHash: "visitor-abc-123",
        eventType: "spa_transition",
        isBot: false,
        country: "US",
        referrerHost: "arturonavax.dev",
        nowMs: t0 + i * 60_000, // +1m, +2m, +3m, +4m, +5m (< 30m)
      });
      expect(subsequent.recorded).toBe(false);
      expect(subsequent.deduped).toBe(true);
      expect(subsequent.storageTier).toBe("L1_CACHE");
    }

    // Exactly 1 D1 write occurred across all 6 hits
    expect(count("telemetry_events")).toBe(1);
    expect(count("analytics_rollups")).toBe(1);

    // End-to-end Worker verification:
    // (a) Prefetch request (/en/blog/post-2 with Sec-Purpose: prefetch) does NOT record a visit,
    //     so a subsequent SPA transition beacon records the real visit.
    const waitPromises: Promise<unknown>[] = [];
    const mockCtx = {
      waitUntil: (p: Promise<unknown>) => waitPromises.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    const mockEnv = {
      DB: db,
      ASSETS: {
        fetch: async () =>
          new Response("<!doctype html><html><body>ok</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
      } as unknown as Fetcher,
    };

    const prefetchReq = new Request("https://arturonavax.dev/en/blog/post-2", {
      headers: {
        "user-agent": CHROME_UA,
        accept: "text/html",
        "sec-purpose": "prefetch",
        "cf-connecting-ip": "203.0.113.77",
      },
    });
    const prefetchRes = await worker.fetch(prefetchReq, mockEnv, mockCtx);
    await Promise.all(waitPromises.splice(0));
    expect(prefetchRes.headers.get("X-Edge-Visit-Logged")).toBeNull();
    expect(count("pageviews")).toBe(0);

    const spaBeaconReq = new Request(
      "https://arturonavax.dev/api/telemetry/collect",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": CHROME_UA,
          "cf-connecting-ip": "203.0.113.77",
        },
        body: JSON.stringify({
          path: "/en/blog/post-2/",
          type: "pageview",
          trigger: "spa_transition",
        }),
      },
    );
    const spaBeaconRes = await worker.fetch(spaBeaconReq, mockEnv, mockCtx);
    await Promise.all(waitPromises.splice(0));
    expect(spaBeaconRes.status).toBe(202);
    expect(count("telemetry_events")).toBe(2);

    // (b) Real SSR navigation (/en/projects with Sec-Fetch-Mode: navigate) sets X-Edge-Visit-Logged: 1
    //     and ev_init=1 cookie, and an immediate duplicate beacon from the same visitor is deduplicated at L1.
    const ssrNavReq = new Request("https://arturonavax.dev/en/projects", {
      headers: {
        "user-agent": CHROME_UA,
        accept: "text/html",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "cf-connecting-ip": "203.0.113.88",
      },
    });
    const ssrNavRes = await worker.fetch(ssrNavReq, mockEnv, mockCtx);
    await Promise.all(waitPromises.splice(0));
    expect(ssrNavRes.headers.get("X-Edge-Visit-Logged")).toBe("1");
    expect(ssrNavRes.headers.get("Set-Cookie")).toContain("ev_init=1");
    const pageviewsAfterSsr = count("pageviews");
    const telemetryAfterSsr = count("telemetry_events");
    expect(pageviewsAfterSsr).toBe(1);

    const dupBeaconReq = new Request(
      "https://arturonavax.dev/api/telemetry/collect",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": CHROME_UA,
          "cf-connecting-ip": "203.0.113.88",
        },
        body: JSON.stringify({
          path: "/en/projects/",
          type: "pageview",
          trigger: "initial_load",
        }),
      },
    );
    const dupBeaconRes = await worker.fetch(dupBeaconReq, mockEnv, mockCtx);
    await Promise.all(waitPromises.splice(0));
    const dupJson = (await dupBeaconRes.json()) as {
      recorded: boolean;
      deduped: boolean;
      storageTier: string;
    };
    expect(dupJson.recorded).toBe(false);
    expect(dupJson.deduped).toBe(true);
    expect(dupJson.storageTier).toBe("L1_CACHE");
    expect(count("pageviews")).toBe(pageviewsAfterSsr);
    expect(count("telemetry_events")).toBe(telemetryAfterSsr);
  });

  it("2. 5-Tier Quota Degradation & Automatic D1 Error Failover to R2 WAL", async () => {
    const r2 = createMockR2Bucket();
    const { db, sqlite, count } = createD1Shim();

    // Tier 2 (COMPACT_ROLLUP): 80,000 writes -> skips raw telemetry_events, buffers analytics_rollups
    edgeQuotaTracker.setCountsForTesting(82_000, 10_000);
    expect(edgeQuotaTracker.getTier()).toBe(
      QuotaDegradationTier.COMPACT_ROLLUP,
    );

    const adapter = new D1TelemetryAdapter(db, { STORAGE_BUCKET: r2 });
    const rollupRes = await adapter.ingestVisit({
      path: "/projects/distributed-engine",
      visitorHash: "visitor-tier2",
      eventType: "pageview",
      isBot: false,
      country: "DE",
    });
    expect(rollupRes.recorded).toBe(true);
    expect(rollupRes.storageTier).toBe("D1");
    expect(count("telemetry_events")).toBe(0); // Raw event skipped in Tier 2
    await flushCompactRollupBuffer(db);
    expect(count("analytics_rollups")).toBe(1);

    // Simulate D1 throwing "D1_ERROR: daily write quota exceeded" during a visit and a contact form submission
    edgeQuotaTracker.reset();
    const failingDb = {
      prepare: () => ({
        bind: () => ({
          run: async () => {
            throw new Error("D1_ERROR: daily write quota exceeded");
          },
          all: async () => {
            throw new Error("D1_ERROR: daily write quota exceeded");
          },
        }),
      }),
    } as unknown as D1Database;
    (failingDb as unknown as { batch: () => Promise<never> }).batch =
      async () => {
        throw new Error("D1_ERROR: daily write quota exceeded");
      };

    const failingAdapter = new D1TelemetryAdapter(failingDb, {
      STORAGE_BUCKET: r2,
    });
    const failoverRes = await failingAdapter.ingestVisit({
      path: "/blog/edge-resilience",
      visitorHash: "visitor-failover",
      eventType: "pageview",
      isBot: false,
      country: "US",
    });

    expect(failoverRes.recorded).toBe(true);
    expect(failoverRes.storageTier).toBe("R2_WAL");
    expect(edgeQuotaTracker.getTier()).toBe(
      QuotaDegradationTier.R2_WAL_FALLBACK,
    );

    const walTelemetryKeys = [...r2.objects.keys()].filter((k) =>
      k.startsWith("wal/telemetry/"),
    );
    expect(walTelemetryKeys.length).toBe(1);

    // Contact form submission under D1 quota error also returns HTTP 200 and spills lead to wal/leads/
    const contactReq = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "198.51.100.200",
      },
      body: JSON.stringify({
        name: "Grace Hopper",
        email: "grace@navy.mil",
        subject: "Compiler Architecture",
        message:
          "Testing zero data loss R2 WAL failover when D1 quota is full.",
      }),
    });
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    const contactRes = await worker.fetch(
      contactReq,
      {
        DB: failingDb,
        STORAGE_BUCKET: r2 as unknown as R2Bucket,
        ASSETS: {
          fetch: async () => new Response("OK", { status: 200 }),
        } as unknown as Fetcher,
      },
      mockCtx,
    );
    expect(contactRes.status).toBe(200);
    const walLeadKeys = [...r2.objects.keys()].filter((k) =>
      k.startsWith("wal/leads/"),
    );
    expect(walLeadKeys.length).toBe(1);
    void sqlite;
  });

  it("3. R2 WAL Nightly Cron Reconciliation: replays telemetry NDJSON and leads JSON into D1 and deletes R2 WAL objects", async () => {
    const { db, count } = createD1Shim();
    const r2 = createMockR2Bucket();

    const walLines = [
      JSON.stringify({
        dedupe_key: "wal-dedupe-1",
        path: "/blog/post-a",
        event_type: "pageview",
        visitor_hash: "v-hash-1",
        is_bot: 0,
        bot_name: null,
        country: "US",
        device_type: "desktop",
        referrer_host: "news.ycombinator.com",
        status_code: 200,
        created_at: "2026-10-18T02:10:00.000Z",
      }),
      JSON.stringify({
        dedupe_key: "wal-dedupe-2",
        path: "/blog/post-a",
        event_type: "spa_transition",
        visitor_hash: "v-hash-2",
        is_bot: 1,
        bot_name: "GPTBot",
        country: "US",
        device_type: "desktop",
        referrer_host: "openai.com",
        status_code: 200,
        created_at: "2026-10-18T02:15:00.000Z",
      }),
    ].join("\n");

    await r2.put("wal/telemetry/2026-10-18/iso-test-1.ndjson", walLines);
    await r2.put(
      "wal/leads/lead-test-1.json",
      JSON.stringify({
        name: "Alan Turing",
        from_email: "alan@bletchley.uk",
        phone: "+44 20 7946 0921",
        subject: "[Web] Cryptography Inquiry",
        body: "Reconciled from R2 WAL",
        locale: "en",
        ip: "192.0.2.99",
        country: "GB",
        turnstile_verified: 1,
        created_at: "2026-10-18T03:00:00.000Z",
      }),
    );

    const summary = await reconcileR2WalToD1({
      DB: db,
      STORAGE_BUCKET: r2 as unknown as R2Bucket,
    });

    expect(summary.telemetryObjectsProcessed).toBe(1);
    expect(summary.telemetryEventsInserted).toBe(2);
    expect(summary.leadObjectsProcessed).toBe(1);
    expect(summary.leadsInserted).toBe(1);
    expect(summary.deletedKeys.length).toBe(2);
    expect(r2.objects.size).toBe(0);

    expect(count("telemetry_events")).toBe(2);
    expect(count("analytics_rollups")).toBe(1);
    expect(count("contact_leads")).toBe(1);
  });

  it("4. Minimum-Cost R2 Sync: r2:pull with matching rootHash in content/_manifest.v2.json performs 1 GetObject and 0 ListObjectsV2", async () => {
    const { runR2Pull } = await import("../../scripts/r2-pull.mjs");
    const { buildLocalManifestV2 } =
      await import("../../scripts/lib/r2-content.mjs");

    const localManifest = buildLocalManifestV2();
    const tmpCachePath = path.join(
      process.cwd(),
      ".cache",
      `r2-manifest.test-${Date.now()}.json`,
    );
    fs.mkdirSync(path.dirname(tmpCachePath), { recursive: true });
    fs.writeFileSync(
      tmpCachePath,
      JSON.stringify(
        {
          etag: '"v2-etag-1"',
          rootHash: localManifest.rootHash,
          manifest: localManifest,
        },
        null,
        2,
      ),
      "utf8",
    );

    const getObjectKeys: string[] = [];
    let listObjectsV2Calls = 0;

    const mockDriver = {
      getObjectCalls: 0,
      listObjectsCalls: 0,
      getJsonIfModified: async (key: string) => {
        mockDriver.getObjectCalls++;
        getObjectKeys.push(key);
        return {
          notModified: false,
          etag: '"v2-etag-1"',
          data: localManifest,
        };
      },
      getBuffer: async (key: string) => {
        mockDriver.getObjectCalls++;
        getObjectKeys.push(key);
        return null;
      },
      listObjectsV2: async () => {
        listObjectsV2Calls++;
        mockDriver.listObjectsCalls++;
        return [];
      },
    };

    try {
      const result = await runR2Pull({
        driver: mockDriver,
        cachePath: tmpCachePath,
        silent: true,
      });

      expect(result.skipped).toBe(true);
      expect(result.getObjectCalls).toBe(1);
      expect(getObjectKeys).toEqual(["content/_manifest.v2.json"]);
      expect(result.listObjectsCalls).toBe(0);
      expect(listObjectsV2Calls).toBe(0);
    } finally {
      if (fs.existsSync(tmpCachePath)) {
        fs.unlinkSync(tmpCachePath);
      }
    }
  });

  it("5. Static Asset Zero-D1 Bypass: requests to /_astro/client.js, /fonts/inter.woff2, /favicon.svg trigger 0 D1 queries", async () => {
    let d1Calls = 0;
    const spyDb = {
      prepare: () => {
        d1Calls++;
        return {
          bind: () => ({
            run: async () => ({ success: true }),
            all: async () => ({ results: [] }),
          }),
        };
      },
      batch: async () => {
        d1Calls++;
        return [];
      },
    } as unknown as D1Database;

    const mockEnv = {
      DB: spyDb,
      ASSETS: {
        fetch: async () =>
          new Response("/* static asset */", {
            status: 200,
            headers: { "Content-Type": "application/javascript" },
          }),
      } as unknown as Fetcher,
    };

    const waitPromises: Promise<unknown>[] = [];
    const mockCtx = {
      waitUntil: (p: Promise<unknown>) => waitPromises.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    for (const assetPath of [
      "/_astro/client.js",
      "/fonts/inter.woff2",
      "/favicon.svg",
    ]) {
      const req = new Request(`https://arturonavax.dev${assetPath}`, {
        headers: {
          "user-agent": CHROME_UA,
          accept: "*/*",
        },
      });
      const res = await worker.fetch(req, mockEnv, mockCtx);
      expect(res.status).toBe(200);
    }

    await Promise.all(waitPromises);
    expect(waitPromises.length).toBe(0);
    expect(d1Calls).toBe(0);
  });
});
