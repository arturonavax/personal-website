import { beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import worker, {
  clearRecentPageviewsCache,
  prefetchCircuitBreaker,
  type Env,
} from "../cloudflare/worker";
import { edgeQuotaTracker } from "../src/lib/adapters";

const TOKEN = "local-test-only-admin-token-32-characters";
function fixture(status = 200) {
  const sqlite = new Database(":memory:");
  sqlite.exec(
    readFileSync("cloudflare/d1/migrations/0001_initial_schema.sql", "utf8"),
  );
  function statement(sql: string, params: unknown[] = []) {
    return {
      sql,
      params,
      bind: (...values: unknown[]) => statement(sql, values),
      run: async () => {
        const result = sqlite.prepare(sql).run(...(params as never[]));
        return {
          success: true,
          meta: {
            changes: result.changes,
            rows_written: result.changes,
            rows_read: 0,
          },
        };
      },
      all: async () => ({
        results: sqlite.prepare(sql).all(...(params as never[])),
      }),
      first: async () => sqlite.prepare(sql).get(...(params as never[])),
    };
  }
  const db = {
    prepare: statement,
    batch: async (stmts: ReturnType<typeof statement>[]) =>
      sqlite.transaction(() =>
        stmts.map((stmt) => {
          const result = sqlite
            .prepare(stmt.sql)
            .run(...(stmt.params as never[]));
          return {
            success: true,
            meta: {
              changes: result.changes,
              rows_written: result.changes,
              rows_read: 0,
            },
          };
        }),
      )(),
  } as unknown as D1Database;
  const env: Env = {
    DB: db,
    ADMIN_ACCESS_TOKEN: TOKEN,
    D1_PREFETCH_SAMPLE_RATE: "1",
    ASSETS: {
      fetch: async () =>
        new Response(status === 304 ? null : "<html>local</html>", {
          status,
          headers: { "Content-Type": "text/html" },
        }),
    } as Fetcher,
  };
  async function fetch(url: string, init: RequestInit = {}) {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      passThroughOnException() {},
    } as ExecutionContext;
    const request = new Request(`https://arturonavax.dev${url}`, init);
    const response = await worker.fetch(request, env, ctx);
    await Promise.all(pending);
    return response;
  }
  const count = (table: string) =>
    (
      sqlite.query(`SELECT count(*) AS count FROM ${table}`).get() as {
        count: number;
      }
    ).count;
  const admin = (query = "") =>
    fetch(`/api/telemetry?fresh=true&${query}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  return { sqlite, env, fetch, count, admin };
}

beforeEach(() => {
  edgeQuotaTracker.reset();
  prefetchCircuitBreaker.reset();
  clearRecentPageviewsCache();
});

describe("successful speculative delivery is isolated from committed visits", () => {
  for (const marker of [
    "query",
    "purpose",
    "sec-purpose",
    "x-astro-prefetch",
  ]) {
    for (const status of [200, 304]) {
      it(`persists ${marker} prefetch after HTTP ${status}, and later records a human visit`, async () => {
        const f = fixture(status);
        const headers: Record<string, string> = {
          accept: "text/html",
          "user-agent": "Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36",
        };
        if (marker !== "query")
          headers[marker] = marker === "x-astro-prefetch" ? "true" : "prefetch";
        const response = await f.fetch(
          `/blog/${marker === "query" ? "?astro-prefetch" : ""}`,
          { headers },
        );
        expect(response.status).toBe(status);
        expect(f.count("prefetch_analytics_events")).toBe(1);
        expect(f.count("pageviews")).toBe(0);
        expect(f.count("telemetry_events")).toBe(0);
        delete headers[marker];
        await f.fetch("/blog/", { headers });
        expect(f.count("pageviews")).toBe(1);
        expect(f.count("prefetch_analytics_events")).toBe(1);
        f.sqlite.close();
      });
    }
  }
  for (const [status, method, path] of [
    [404, "GET", "/blog/"],
    [500, "GET", "/blog/"],
    [200, "HEAD", "/blog/"],
    [200, "GET", "/image.png"],
  ] as const) {
    it(`does not persist ${method} ${path} HTTP ${status}`, async () => {
      const f = fixture(status);
      await f.fetch(path + "?astro-prefetch", { method });
      expect(f.count("prefetch_analytics_events")).toBe(0);
      expect(f.count("pageviews")).toBe(0);
      f.sqlite.close();
    });
  }
});

it("retains explicit bypass and kill-switch protection for query-marker prefetches", async () => {
  for (const flag of [
    "BYPASS_PREFETCH_TELEMETRY",
    "ENABLE_PREFETCH_TELEMETRY",
  ]) {
    const f = fixture();
    Object.assign(f.env, {
      [flag]: flag === "BYPASS_PREFETCH_TELEMETRY" ? true : "false",
    });
    await f.fetch("/protected/?astro-prefetch");
    expect(f.count("prefetch_analytics_events")).toBe(0);
    expect(f.count("pageviews")).toBe(0);
    f.sqlite.close();
  }
});

describe("truthful admin prefetch data", () => {
  it("counts the filtered isolated ledger, independently of human/bot segmentation", async () => {
    const f = fixture();
    f.sqlite
      .exec(`INSERT INTO prefetch_analytics_events(path, visitor_hash, country, referrer, created_at) VALUES
      ('/blog/', 'one', 'CO', 'https://example.test', datetime('now')),
      ('/blog/', 'two', 'CO', 'https://example.test', datetime('now')),
      ('/projects/', 'three', 'US', '', datetime('now')),
      ('/blog/', 'old', 'CO', '', '2000-01-01 00:00:00');`);
    const response = await f.admin(
      "range=1d&country=CO&path=/blog/&search=example&segment=human",
    );
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stats.prefetches_count).toBe(2);
    expect(data.prefetches).toHaveLength(2);
    expect(data.stats.total_pageviews).toBe(0);
    expect(data.pageviews).toEqual([]);
    const empty = await (await f.admin("path=/missing/")).json();
    expect(empty.stats.prefetches_count).toBe(0);
    expect(empty.pageviews).toEqual([]);
    expect(empty.top_pages).toEqual([]);
    f.sqlite.close();
  });
  it("counts all matching prefetch rows beyond the display limit and retains totals on page-only reads", async () => {
    const f = fixture();
    for (let i = 0; i < 20; i++) {
      f.sqlite
        .prepare(
          "INSERT INTO prefetch_analytics_events(path, visitor_hash, country) VALUES (?, ?, ?)",
        )
        .run("/many/", `visitor-${i}`, "CO");
    }
    const response = await f.admin("path=/many/");
    const data = await response.json();
    expect(data.stats.prefetches_count).toBe(20);
    expect(data.prefetches).toHaveLength(15);
    const page = await (await f.admin("path=/many/&page_only=1")).json();
    expect(page.stats.prefetches_count).toBe(20);
    expect(page.prefetches).toEqual([]);
    f.sqlite.close();
  });
  it("retains the 15-second fresh-request cooldown and the original snapshot timestamp", async () => {
    const f = fixture();
    const first = await f.admin("path=/cooldown/");
    const initial = await first.json();
    f.sqlite.exec(
      "INSERT INTO prefetch_analytics_events(path, visitor_hash) VALUES ('/cooldown/', 'later')",
    );
    const cached = await f.admin("path=/cooldown/");
    const data = await cached.json();
    expect(cached.headers.get("X-Telemetry-Source")).toBe("edge-memory-cache");
    expect(cached.headers.get("Cache-Control")).toContain("no-store");
    expect(data.timestamp).toBe(initial.timestamp);
    expect(data.stats.prefetches_count).toBe(0);
    f.sqlite.close();
  });
  it("distinguishes quota-protected reads from an empty observed dataset", async () => {
    const f = fixture();
    edgeQuotaTracker.setCountsForTesting(90_000, 10_000);
    const response = await f.admin("path=/quota-protected/");
    expect(response.status).toBe(503);
    expect((await response.json()).status).toBe("degraded");
    f.sqlite.close();
  });
  it("distinguishes unavailable D1 from an observed empty ledger", async () => {
    const f = fixture();
    delete f.env.DB;
    const response = await f.admin("path=/unavailable/");
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.status).toBe("unavailable");
    expect(data.pageviews).toEqual([]);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    f.sqlite.close();
  });
});

function dashboardFixture(fail = false, pageOnly = false) {
  const source = readFileSync("src/pages/[...lang]/admin/index.astro", "utf8");
  const fn = source.slice(
    source.indexOf("    async function fetchDashboardData("),
    source.indexOf("    function fmtK("),
  );
  const calls: { url: string; options?: RequestInit }[] = [];
  const nodes = new Map<
    string,
    {
      textContent: string;
      style: Record<string, string>;
      classList: { add(): void; remove(): void };
    }
  >();
  const state = {
    URLSearchParams,
    Date,
    console,
    document: {
      getElementById: (id: string) => {
        if (!nodes.has(id))
          nodes.set(id, {
            textContent: "",
            style: {},
            classList: { add() {}, remove() {} },
          });
        return nodes.get(id);
      },
    },
    currentRange: "all",
    currentCountry: "all",
    currentSegment: "all",
    currentPathFilter: "all",
    searchQuery: "",
    currentPage: 1,
    currentLimit: 50,
    customFrom: "",
    customTo: "",
    lastSyncTimestamp: 123,
    isEs: false,
    renderDashboard() {},
    fetch: async (url: string, options?: RequestInit) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify({
          status: fail ? "unavailable" : "ok",
          timestamp: "2026-10-23T12:00:00Z",
          pageviews: [],
        }),
        { status: fail ? 503 : 200 },
      );
    },
  };
  const run = runInNewContext(
    fn + `; fetchDashboardData(false, ${pageOnly})`,
    state,
  );
  return { calls, state, nodes, run };
}

describe("admin refresh behavior", () => {
  it("requests fresh data and disables browser caching for every full-refresh endpoint, including polling", async () => {
    const f = dashboardFixture();
    await f.run;
    expect(f.calls).toHaveLength(4);
    for (const call of f.calls) {
      expect(
        new URL(call.url, "https://local.test").searchParams.get("fresh"),
      ).toBe("true");
      expect(call.options?.cache).toBe("no-store");
    }
    expect(f.state.lastSyncTimestamp).toBe(Date.parse("2026-10-23T12:00:00Z"));
  });
  it("preserves last successful synchronization on failed full refresh and pagination", async () => {
    for (const pageOnly of [false, true]) {
      const f = dashboardFixture(true, pageOnly);
      await f.run;
      expect(f.state.lastSyncTimestamp).toBe(123);
      expect(f.nodes.get("badge-cache-mode")?.textContent).toMatch(
        /unavailable|failed/i,
      );
    }
  });
});
