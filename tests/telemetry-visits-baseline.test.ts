import { beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import worker from "../cloudflare/entrypoint";
import { clearRecentPageviewsCache } from "../cloudflare/worker";
import { edgeQuotaTracker } from "../src/lib/adapters";

beforeEach(() => clearRecentPageviewsCache());

test("conservative committed visit is visible with its bounded dimensions, filters and no speculative duplicate", async () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(readFileSync("cloudflare/d1/migrations/0001_initial_schema.sql", "utf8"));
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...args: unknown[]) => statement(sql, args),
    run: async () => {
      const result = sqlite.prepare(sql).run(...(values as never[]));
      return { success: true, meta: { rows_written: result.changes, rows_read: 0 } };
    },
    all: async () => ({ results: sqlite.prepare(sql).all(...(values as never[])), meta: { rows_read: 1 } }),
    first: async () => sqlite.prepare(sql).get(...(values as never[])),
    sql, values,
  });
  const db = {
    prepare: statement,
    batch: async (statements: ReturnType<typeof statement>[]) => sqlite.transaction(() => statements.map(({ sql, values }) => {
      const result = sqlite.prepare(sql).run(...(values as never[]));
      return { success: true, meta: { rows_written: result.changes, rows_read: 0 } };
    }))(),
  } as unknown as D1Database;
  const token = "test-only-telemetry-visits-token";
  const env = { DB: db, ADMIN_ACCESS_TOKEN: token, ASSETS: { fetch: async () => new Response("<html>ok</html>", { headers: { "Content-Type": "text/html" } }) } } as never;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as ExecutionContext;
  const fetch = async (request: Request) => {
    const response = await worker.fetch(request, env, ctx);
    await Promise.all(pending.splice(0));
    return response;
  };
  const query = async (path: string) => {
    const response = await fetch(new Request(`https://arturonavax.dev/api/telemetry?fresh=true&segment=human&country=MX&path=${encodeURIComponent(path)}`, { headers: { Authorization: `Bearer ${token}` } }));
    return { status: response.status, body: await response.json() as any };
  };
  try {
    edgeQuotaTracker.setCountsForTesting(51_000, 0);
    const makeRequest = (prefetch = false) => {
      const request = new Request("https://arturonavax.dev/es/blog/?utm_source=search", { headers: {
        accept: "text/html", "sec-fetch-dest": "document", "cf-connecting-ip": "198.51.100.74",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
        "accept-language": "zh-Hant-TW;q=0.9", ...(prefetch ? { "x-astro-prefetch": "true" } : {}),
      } });
      Object.defineProperty(request, "cf", { value: { country: "MX", region: "Jalisco" } });
      return request;
    };
    const speculative = await fetch(makeRequest(true));
    expect(speculative.status).toBe(200);
    expect((await query("/es/blog/missing")).body.stats.total_pageviews).toBe(0);
    const committed = await fetch(makeRequest());
    expect(committed.status).toBe(200);
    expect(committed.headers.get("X-Edge-Visit-Logged")).toBe("1");
    const result = await query("/es/blog");
    expect(result.status).toBe(200);
    expect(result.body.stats).toMatchObject({ total_pageviews: 1, human_views: 1, bot_views: 0, unique_visitors: 1 });
    expect(result.body.pagination.total_filtered).toBe(1);
    expect(result.body.pageviews).toHaveLength(1);
    expect(result.body.pageviews[0]).toMatchObject({ path: "/es/blog/", country: "MX", region: "Jalisco", os_type: "windows", device_type: "desktop", browser: "chrome", browser_language: "zh-Hant-TW", utm_source: "search", is_bot: 0 });
    expect((await query("/other")).body.stats.total_pageviews).toBe(0);
    const rejected = await fetch(new Request("https://arturonavax.dev/api/telemetry/collect", {
      method: "POST", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
      body: JSON.stringify({ path: "/es/blog" }),
    }));
    expect(rejected.status).toBe(403);
    expect(await rejected.text()).toBe('{"error":"Forbidden: cross-origin telemetry rejected"}');
    await fetch(makeRequest());
    expect((await query("/es/blog")).body.stats.total_pageviews).toBe(1);
    const beacon = (path: string) => fetch(new Request("https://arturonavax.dev/api/telemetry/collect", {
      method: "POST", headers: {
        "Content-Type": "application/json", "cf-connecting-ip": "198.51.100.74",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
        "accept-language": "zh-Hant-TW;q=0.9",
      }, body: JSON.stringify({ path, type: "pageview", trigger: "spa_transition" }),
    }));
    const duplicate = await beacon("/es/blog");
    expect(duplicate.status).toBe(202);
    expect((await query("/es/blog")).body.stats.total_pageviews).toBe(1);
    const bare = await beacon("/es/plain");
    expect(bare.status).toBe(202);
    const bareResponse = await fetch(new Request(`https://arturonavax.dev/api/telemetry?fresh=true&segment=human&path=${encodeURIComponent("/es/plain")}`, { headers: { Authorization: `Bearer ${token}` } }));
    expect(bareResponse.status).toBe(200);
    const bareData = await bareResponse.json() as any;
    expect(bareData.stats.total_pageviews).toBe(1);
    expect(bareData.pageviews).toHaveLength(1);
    expect(bareData.pageviews[0].path).toBe("/es/plain");
  } finally {
    sqlite.close();
    clearRecentPageviewsCache();
  }
});
