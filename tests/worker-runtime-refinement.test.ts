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
    const redirected = await f.send("/admin", { headers: { ...auth, accept: "text/html" } });
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get("location")).toBe("https://arturonavax.dev/admin/");
    expect(f.assets).toBe(0);
    const response = await worker.fetch(
      new Request("https://arturonavax.dev/admin/", { headers: { ...auth, accept: "text/html" } }),
      f.env,
      f.ctx,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(await response.text()).not.toContain("Admin Management Surface");
    expect(f.assets).toBeGreaterThan(0);
    expect(f.writes).toBe(0);
  });

  it("rejects oversized contact JSON before rate limit or storage, including untrusted lengths", async () => {
    const f = fixture();
    const ip = `oversize-${crypto.randomUUID()}`;
    const oversized = "x".repeat(64_000);
    for (const headers of [{}, { "content-length": "1" }]) {
      const response = await f.send("/api/contact", { method: "POST", headers: { ...headers, "cf-connecting-ip": ip }, body: oversized });
      expect(response.status).toBe(413);
      expect(await response.text()).toBe(JSON.stringify({ status: "error", error: "Payload too large" }));
      expect(response.headers.get("cache-control")).toBe("no-store, private");
    }
    const declared = await f.send("/api/contact", { method: "POST", headers: { "cf-connecting-ip": ip, "content-length": "999999" }, body: "{}" });
    expect(declared.status).toBe(413);
    expect(await declared.text()).toBe(JSON.stringify({ status: "error", error: "Payload too large" }));
    expect(f.reads).toBe(0);
    expect(f.writes).toBe(0);
    for (let n = 0; n < 5; n++) expect(checkContactRateLimit(ip)).toBe(true);
    expect(checkContactRateLimit(ip)).toBe(false);
  });

  it("returns 413 promptly when an oversized contact stream cannot finish cancellation", async () => {
    const f = fixture();
    const ip = `hung-cancel-${crypto.randomUUID()}`;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(32_769)); },
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    });
    const response = await Promise.race([
      f.send("/api/contact", { method: "POST", headers: { "cf-connecting-ip": ip }, body: stream, duplex: "half" } as RequestInit),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("oversize response hung")), 300)),
    ]);
    expect(cancelled).toBe(true);
    expect(response.status).toBe(413);
    expect(await response.text()).toBe(JSON.stringify({ status: "error", error: "Payload too large" }));
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(f.reads).toBe(0);
    expect(f.writes).toBe(0);
    for (let n = 0; n < 5; n++) expect(checkContactRateLimit(ip)).toBe(true);
    expect(checkContactRateLimit(ip)).toBe(false);
  });

  it("attempts the compact lead insert once before spilling a failed D1 write to WAL", async () => {
    const f = fixture();
    const statements: string[] = [];
    const keys: string[] = [];
    f.env.DB = { prepare(sql: string) {
      statements.push(sql);
      return { bind() { return { async run() { throw new Error("D1 unavailable"); } }; } };
    } } as never;
    f.env.R2_BUCKET = { async put(key: string) { keys.push(key); } } as never;
    const response = await f.send("/api/contact", {
      method: "POST", headers: { "cf-connecting-ip": `lead-${crypto.randomUUID()}` },
      body: JSON.stringify({ name: "Test", email: "test@example.test", subject: "Inquiry", message: "A sufficiently long inquiry message" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe("ok");
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("INSERT INTO contact_leads");
    expect(statements[0]).toContain("turnstile_verified");
    expect(keys).toHaveLength(1);
    expect(keys[0]).toStartWith("wal/leads/");
  });

  it("still requires direct admin handler authentication and permits verified token fetch", async () => {
    const f = fixture();
    const denied = await handleAdminDashboardRequest(new Request("https://arturonavax.dev/api/telemetry"), f.env, f.ctx);
    expect(denied.status).toBe(401);
    expect(f.reads).toBe(0);
    const response = await f.send("/api/telemetry?page_only=1", { headers: auth });
    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe("ok");
  });

  it("verifies the configured credential once on fetch, but again on a separate direct invocation", async () => {
    const f = fixture();
    let accesses = 0;
    Object.defineProperty(f.env, "ADMIN_ACCESS_TOKEN", { get() { accesses++; return token; } });
    const response = await f.send("/api/telemetry?page_only=1", { headers: auth });
    expect(response.status).toBe(200);
    expect(accesses).toBe(1);
    const direct = await handleAdminDashboardRequest(new Request("https://arturonavax.dev/api/telemetry?page_only=1", { headers: auth }), f.env, f.ctx);
    expect(direct.status).toBe(200);
    expect(accesses).toBe(2);
  });

  it("evicts old telemetry filter snapshots while recent filters retain resolved cache hits", async () => {
    clearRecentPageviewsCache();
    const f = fixture();
    const url = (n: number) => `/api/telemetry?page_only=1&path=%2Ffilter-${n}`;
    const read = (n: number) => f.send(url(n), { headers: auth });
    const initial = await read(0);
    expect(initial.status).toBe(200);
    expect(initial.headers.get("X-Telemetry-Source")).toBe("edge-d1-fresh");
    for (let n = 1; n <= 129; n++) expect((await read(n)).status).toBe(200);
    expect((await read(129)).headers.get("X-Telemetry-Source")).toBe("edge-memory-cache");
    expect((await read(0)).headers.get("X-Telemetry-Source")).toBe("edge-d1-fresh");
  });

  it("honors fresh on a cached key even when 128 other cooldown keys are live", async () => {
    clearRecentPageviewsCache();
    const f = fixture();
    const path = (n: number) => `/api/telemetry?page_only=1&path=%2Ffresh-${n}`;
    const send = (n: number, fresh = false) => f.send(path(n) + (fresh ? "&fresh=true" : ""), { headers: auth });
    await send(0);
    for (let n = 1; n <= 128; n++) await send(n, true);
    await send(0); // Re-cache the original after snapshot capacity eviction.
    const cached = await send(0);
    expect(cached.headers.get("X-Telemetry-Source")).toBe("edge-memory-cache");
    const before = f.reads;
    const refreshed = await send(0, true);
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get("X-Telemetry-Source")).toBe("edge-d1-fresh");
    expect(f.reads).toBeGreaterThan(before);
    const after = f.reads;
    expect((await send(0, true)).headers.get("X-Telemetry-Source")).toBe("edge-memory-cache");
    expect(f.reads).toBe(after);
  });

  it("serves exact raw storage views through the public Worker", async () => {
    const { CloudflareR2StorageAdapter } = await import("../src/lib/adapters/cloudflare/r2-storage.adapter");
    const original = CloudflareR2StorageAdapter.prototype.get;
    const bytes = new TextEncoder().encode("prefixPAYLOADsuffix");
    let data: Uint8Array = bytes.subarray(6, 13);
    CloudflareR2StorageAdapter.prototype.get = async () => ({
      data,
      metadata: { contentType: "application/octet-stream", sizeBytes: 7 },
    });
    try {
      const send = () => worker.fetch(
        new Request("https://arturonavax.dev/cdn-assets/raw/"),
        { STORAGE_BUCKET: {} } as Env,
        { waitUntil() {} } as ExecutionContext,
      );
      const assertPayload = async () => {
        const response = await send();
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/octet-stream");
        expect(response.headers.get("content-length")).toBe("7");
        expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...new TextEncoder().encode("PAYLOAD")]);
      };
      await assertPayload();
      if (typeof SharedArrayBuffer !== "undefined") {
        const shared = new SharedArrayBuffer(bytes.length);
        new Uint8Array(shared).set(bytes);
        data = new Uint8Array(shared, 6, 7);
        await assertPayload();
      }
    } finally {
      CloudflareR2StorageAdapter.prototype.get = original;
    }
  });

  it("retains the active collector method guard and five-per-window contact limit", async () => {
    const f = fixture();
    const response = await f.send("/api/telemetry/collect", { method: "GET" });
    expect(response.status).toBe(401);
    expect((await response.json() as { error: string }).error).toBe("Unauthorized");
    const ip = `rate-${crypto.randomUUID()}`;
    for (let n = 0; n < 5; n++) expect(checkContactRateLimit(ip)).toBe(true);
    expect(checkContactRateLimit(ip)).toBe(false);
    clearRecentPageviewsCache();
  });
});
