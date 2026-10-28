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
  sqlite.exec(readFileSync("cloudflare/d1/migrations/0001_initial_schema.sql", "utf8"));
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
        expect(f.count("telemetry_events")).toBe(0);
        delete headers[marker];
        await f.fetch("/blog/", { headers });
        expect(f.count("telemetry_events")).toBe(1);
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
      expect(f.count("telemetry_events")).toBe(0);
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
    expect(f.count("telemetry_events")).toBe(0);
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
    expect(data.quotas.provider_usage).toBeNull();
    expect(data.quotas.strategy.daily_write_budget).toBe(100000);
    expect(data.quotas.d1_storage).toBeUndefined();
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

describe("bounded admin telemetry coverage", () => {
  it("reports recent device/OS and AI/bot subsets separately from raw visit totals", async () => {
    const f = fixture();
    const today = new Date().toISOString().slice(0, 10);
    f.sqlite
      .prepare(
        `INSERT INTO analytics_rollups (date, path, views, human_views, bot_views,
       device_desktop, device_mobile, os_windows, os_ios)
       VALUES (?, '/experience/latam', 3, 2, 1, 2, 1, 2, 1)`,
      )
      .run(today);
    const event = f.sqlite.prepare(
      `INSERT INTO telemetry_events (dedupe_key, path, visitor_hash, is_bot, bot_category, created_at)
       VALUES (?, '/experience/latam', 'hash', 1, ?, ?)`,
    );
    const recent = new Date().toISOString().replace("T", " ").slice(0, 19);
    event.run("ai", "ai_scraper", recent);
    event.run("crawler", "search_crawler", recent);
    event.run("unknown", null, recent);
    event.run("old", "ai_scraper", "2020-01-01 00:00:00");
    f.env.ENABLE_BOT_TELEMETRY = "false";
    const response = await f.admin("path=/unrelated/&segment=human");
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stats.total_pageviews).toBe(0);
    expect(data.coverage).toEqual({
      device_os: {
        status: "subset",
        source: "analytics_rollups",
        window_days: 30,
        classified_views: 3,
        device: { desktop: 2, mobile: 1 },
        os: { windows: 2, macos: 0, ios: 1, android: 0, linux: 0, other: 0 },
      },
      bots: {
        status: "subset",
        source: "telemetry_events",
        window_days: 7,
        collection_enabled: false,
        sample_rate: 0.01,
        observed: 3,
        ai: 1,
        other: 1,
        unknown: 1,
      },
    });
    const page = await (await f.admin("path=/unrelated/&page_only=1")).json();
    expect(page.coverage).toBeNull();
    f.sqlite.close();
  });

  it("falls back to a 1% bot sample when the configured rate is empty", async () => {
    const f = fixture();
    f.env.ENABLE_BOT_TELEMETRY = "true";
    f.env.BOT_TELEMETRY_SAMPLE_RATE = "";
    const response = await f.admin("path=/empty-rate/");
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.coverage.bots.sample_rate).toBe(0.01);
    f.sqlite.close();
  });

  it("uses the same 1% bot rate when the optional setting is absent", async () => {
    const f = fixture();
    delete f.env.BOT_TELEMETRY_SAMPLE_RATE;
    const response = await f.admin("path=/unset-rate/");
    expect(response.status).toBe(200);
    expect((await response.json()).coverage.bots.sample_rate).toBe(0.01);
    f.sqlite.close();
  });

});

function coverageFixture(isEs: boolean, coverage: unknown) {
  const source = readFileSync("src/pages/[...lang]/admin/index.astro", "utf8");
  const fn = source.slice(
    source.indexOf("    function renderCoverage()"),
    source.indexOf("    function renderDashboard()"),
  );
  const nodes = new Map<string, { textContent: string }>();
  const state = {
    isEs,
    cachedTelemetryData: { coverage },
    document: {
      getElementById: (id: string) => {
        if (!nodes.has(id)) nodes.set(id, { textContent: "" });
        return nodes.get(id);
      },
    },
  };
  runInNewContext(fn + "; renderCoverage()", state);
  return nodes;
}

it("renders the visit dimensions from the API row without mixing route locale and browser language", () => {
  const source = readFileSync("src/pages/[...lang]/admin/index.astro", "utf8");
  const render = source.slice(source.indexOf("    function renderTable(items)"), source.indexOf("    function renderPanes()"));
  for (const isEs of [false, true]) {
    const nodes = new Map<string, { innerHTML: string; textContent: string }>();
    runInNewContext(`${render}; renderTable([visit])`, {
      visit: { path: "/es/blog", country: "MX", region: "Jalisco", device_type: "desktop", os_type: "windows", browser: "chrome", browser_language: "zh-Hant-TW<script>", is_bot: 0, created_at: "2026-10-27T10:00:00Z", visitor_hash: "hashed" },
      isEs, totalFiltered: 1,
      escapeHtml: (value: string) => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
      formatDateTime: (value: string) => value,
      getCountryFullName: () => "Mexico",
      attachCountryTooltipEvents: () => {},
      document: { getElementById: (id: string) => {
        if (!nodes.has(id)) nodes.set(id, { innerHTML: "", textContent: "" });
        return nodes.get(id);
      } },
    });
    const html = nodes.get("telemetry-tbody")?.innerHTML || "";
    for (const value of ["MX", "Jalisco", "desktop", "windows", "chrome", "zh-Hant-TW&lt;script&gt;"]) expect(html).toContain(value);
    expect(html).not.toContain("<script>");
  }
});

describe("truthful bilingual coverage rendering", () => {
  it("does not present fabricated D1 storage usage or the account cap as a per-database limit", () => {
    const source = readFileSync(
      "src/pages/[...lang]/admin/index.astro",
      "utf8",
    );
    const fn = source.slice(
      source.indexOf("    function renderQuotas()"),
      source.indexOf("    function renderCoverage()"),
    );
    for (const isEs of [false, true]) {
      for (const d1Storage of [
        { used: null, status: "unavailable", source: "D1 binding meta.size_after", scope: "selected database", period: "current read-only query", retrieved_at: "2026-10-28T00:00:00Z", accuracy: "Not account usage" },
        { used: 12_400_000, status: "observed", source: "D1 binding meta.size_after", scope: "selected database", period: "current read-only query", retrieved_at: "2026-10-28T00:00:00Z", accuracy: "Not account usage" },
      ]) {
        const nodes = new Map<
          string,
          { textContent: string; style: { width: string }; classList: { toggle(): void } }
        >();
        runInNewContext(fn + "; renderQuotas()", {
          isEs,
          fmtK: (n: number) => String(n),
          cachedQuotas: { provider_usage: { d1_storage: d1Storage }, strategy: {} },
          document: {
            getElementById: (id: string) => {
              if (!nodes.has(id))
                nodes.set(id, { textContent: "", style: { width: "" }, classList: { toggle() {} } });
              return nodes.get(id);
            },
          },
        });
        expect(nodes.get("quota-d1-storage")?.textContent).toContain("D1 binding meta.size_after");
        expect(nodes.get("quota-d1-storage")?.textContent).not.toContain("5 GB");
        expect(nodes.get("quota-d1-storage-bar")?.style.width).toBe(d1Storage.used === null ? "0%" : "2%");
      }
    }
  });
  it("shows source, independent window and observed subsets without extrapolating bots", () => {
    const coverage = {
      device_os: {
        status: "subset",
        window_days: 30,
        classified_views: 3,
        device: { desktop: 2, mobile: 1 },
        os: { windows: 2, macos: 0, ios: 1, android: 0, linux: 0, other: 0 },
      },
      bots: {
        status: "subset",
        window_days: 7,
        collection_enabled: false,
        sample_rate: 0.01,
        observed: 3,
        ai: 1,
        other: 1,
        unknown: 1,
      },
    };
    const en = coverageFixture(false, coverage);
    expect(en.get("coverage-device-status")?.textContent).toMatch(
      /30.*analytics_rollups.*subset/i,
    );
    expect(en.get("coverage-bot-status")?.textContent).toMatch(
      /off.*1%.*7.*sampled telemetry_events.*subset/i,
    );
    expect(en.get("coverage-desktop")?.textContent).toBe("2");
    expect(en.get("coverage-ai")?.textContent).toBe("1");
    expect(en.get("coverage-unknown")?.textContent).toBe("1");
    const es = coverageFixture(true, coverage);
    expect(es.get("coverage-device-status")?.textContent).toMatch(
      /30.*analytics_rollups.*subconjunto/i,
    );
    expect(es.get("coverage-bot-status")?.textContent).toMatch(
      /desactivada.*1%.*7.*telemetry_events muestreados.*subconjunto/i,
    );
  });

  it("marks missing coverage as unavailable, not zero events", () => {
    for (const isEs of [false, true]) {
      const nodes = coverageFixture(isEs, {
        device_os: { status: "unavailable", device: null, os: null },
        bots: { status: "unavailable", observed: null },
      });
      expect(nodes.get("coverage-desktop")?.textContent).toBe("—");
      expect(nodes.get("coverage-ai")?.textContent).toBe("—");
      expect(nodes.get("coverage-device-status")?.textContent).toMatch(
        /unavailable|no disponible/i,
      );
      expect(nodes.get("coverage-bot-status")?.textContent).toMatch(
        /unavailable|no disponible/i,
      );
    }
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
    "var active = true; var requestVersion = 0;" +
      fn +
      `; fetchDashboardData(false, ${pageOnly})`,
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
