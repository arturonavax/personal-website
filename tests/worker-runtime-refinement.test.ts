import { describe, expect, it } from "bun:test";
import worker, { checkContactRateLimit, clearRecentPageviewsCache, handleAdminDashboardRequest, type Env } from "../cloudflare/worker";

const token = "local-only-test-admin-token-32-characters";
const auth = { Authorization: `Bearer ${token}` };
function fixture() {
  let reads = 0;
  let writes = 0;
  let assets = 0;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil(p: Promise<unknown>) { pending.push(p); } } as ExecutionContext;
  const env = {
    ADMIN_ACCESS_TOKEN: token,
    ASSETS: { async fetch() { assets++; return new Response("missing", { status: 404 }); } },
    DB: { prepare() { reads++; return { bind() { return this; }, async all() { return { results: [] }; }, async first() { return null; }, async run() { writes++; return { success: true }; } }; } },
  } as unknown as Env;
  async function send(path: string, init: RequestInit = {}) {
    const res = await worker.fetch(new Request(`https://arturonavax.dev${path}`, init), env, ctx);
    await Promise.all(pending.splice(0));
    return res;
  }
  return { send, env, ctx, get reads() { return reads; }, get writes() { return writes; }, get assets() { return assets; } };
}

describe("bounded Worker refinement", () => {
  it("streams R2 bodies and sliced chunks without buffering", async () => {
    const f = fixture();
    const bytes = new TextEncoder().encode("prefixPAYLOADsuffix");
    let gets = 0;
    f.env.STORAGE_BUCKET = { async get() {
      gets++;
      const body = gets === 1
        ? new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("STREAM")); controller.close(); } })
        : new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(6, 13)); controller.close(); } });
      return { body, size: gets === 1 ? 6 : 7, httpEtag: '"test-etag"', httpMetadata: { contentType: "text/plain" } };
    } } as never;
    const streamed = await f.send("/cdn-assets/stream/");
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get("content-length")).toBe("6");
    expect(await streamed.text()).toBe("STREAM");
    const sliced = await f.send("/cdn-assets/slice/");
    expect(sliced.status).toBe(200);
    expect(sliced.headers.get("content-length")).toBe("7");
    expect(await sliced.text()).toBe("PAYLOAD");
    expect(gets).toBe(2);
    expect(f.reads).toBe(0);
    expect(f.writes).toBe(0);
  });

  it("uses an available Workers cache and computes without one", async () => {
    const f = fixture();
    const original = Object.getOwnPropertyDescriptor(globalThis, "caches");
    const entries = new Map<string, Response>();
    let matches = 0;
    let puts = 0;
    try {
      Object.defineProperty(globalThis, "caches", { configurable: true, value: {
        default: {
          async match(request: Request) { matches++; return entries.get(request.url)?.clone(); },
          async put(request: Request, response: Response) { puts++; entries.set(request.url, response); },
        },
      } });
      const first = await f.send("/api/telemetry/views?path=%2Fcache-fixture");
      expect(first.status).toBe(200);
      expect(first.headers.get("X-Telemetry-Cache")).toBe("MISS");
      expect(await first.json()).toEqual({ path: "/cache-fixture", views: 0, cached: false });
      const second = await f.send("/api/telemetry/views?path=%2Fcache-fixture");
      expect(second.status).toBe(200);
      expect(second.headers.get("X-Telemetry-Cache")).toBe("HIT");
      expect(matches).toBe(2);
      expect(puts).toBe(1);
      Object.defineProperty(globalThis, "caches", { configurable: true, value: undefined });
      const without = await f.send("/api/telemetry/views?path=%2Fno-cache-fixture");
      expect(without.status).toBe(200);
      expect(without.headers.get("X-Telemetry-Cache")).toBe("MISS");
      expect(await without.json()).toEqual({ path: "/no-cache-fixture", views: 0, cached: false });
      expect(matches).toBe(2);
      expect(puts).toBe(1);
      expect(f.writes).toBe(0);
    } finally {
      if (original) Object.defineProperty(globalThis, "caches", original);
      else Reflect.deleteProperty(globalThis, "caches");
    }
  });

  it("retires legacy ingestion without queuing or storing even valid beacons", async () => {
    const f = fixture();
    for (const headers of [{ "sec-fetch-site": "same-origin" }, { purpose: "prefetch" }]) {
      const response = await f.send("/api/v1/telemetry", { method: "POST", headers, body: JSON.stringify({ path: "/blog/" }) });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(JSON.stringify({ error: "Not Found" }));
      expect(response.headers.get("content-type")).toBe("application/json");
    }
    expect(f.writes).toBe(0);
    expect(f.reads).toBe(0);
    expect(f.assets).toBe(0);
  });

  it("returns private 503 instead of an alternate dashboard when the vault is absent", async () => {
    const f = fixture();
    const response = await f.send("/admin/", { headers: { ...auth, accept: "text/html" } });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(await response.text()).not.toContain("Admin Management Surface");
    expect(f.assets).toBeGreaterThan(0);
    expect(f.writes).toBe(0);
  });

});
