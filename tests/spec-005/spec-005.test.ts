import { describe, expect, it } from "bun:test";
import worker, {
  type Env,
  handleAdminDashboardRequest,
  recordAnalyticsNonBlocking,
} from "../../cloudflare/worker";
import {
  CloudflareEdgeRoutingPolicy,
  resolveSubdomainPath,
  FailOpenCircuitBreaker,
  StaticMemorySearchAdapter,
} from "../../src/lib/adapters";

const dummyAssets: Fetcher = {
  fetch: async (req: Request | string) => {
    const url = typeof req === "string" ? req : req.url;
    if (url.includes("/404")) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response("<html><body>Fast-Path Content</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
} as unknown as Fetcher;

const createMockCtx = () => {
  const promises: Promise<any>[] = [];
  return {
    waitUntil: (p: Promise<any>) => promises.push(p),
    passThroughOnException: () => {},
    promises,
  } as unknown as ExecutionContext & { promises: Promise<any>[] };
};

const createMockDb = (shouldThrow = false) => {
  const executedQueries: { sql: string; params: any[] }[] = [];
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        run: async () => {
          if (shouldThrow) {
            throw new Error("D1 Catastrophic Database Failure Simulation");
          }
          executedQueries.push({ sql, params });
          return { success: true };
        },
        all: async () => {
          if (shouldThrow) {
            throw new Error("D1 Catastrophic Query Failure Simulation");
          }
          return {
            results: [{ id: "mock-rollup", date: "2026-10-04", views: 42 }],
          };
        },
      }),
    }),
    executedQueries,
  } as unknown as D1Database & {
    executedQueries: { sql: string; params: any[] }[];
  };
};

describe("SPEC-005 SDD: Edge Routing Policy Port & Adapter", () => {
  const policy = new CloudflareEdgeRoutingPolicy();

  it("classifies static assets, public documents, APIs, and admin surfaces accurately", () => {
    expect(
      policy.classify(
        new URL("https://arturonavax.dev/_astro/client.mjs"),
        new Request("https://arturonavax.dev/_astro/client.mjs"),
      ),
    ).toBe("STATIC_ASSET");

    expect(
      policy.classify(
        new URL("https://arturonavax.dev/fonts/geist-sans.woff2"),
        new Request("https://arturonavax.dev/fonts/geist-sans.woff2"),
      ),
    ).toBe("STATIC_ASSET");

    expect(
      policy.classify(
        new URL("https://arturonavax.dev/blog/"),
        new Request("https://arturonavax.dev/blog/", {
          headers: { accept: "text/html,application/xhtml+xml" },
        }),
      ),
    ).toBe("PUBLIC_DOCUMENT");

    expect(
      policy.classify(
        new URL("https://arturonavax.dev/admin/metrics"),
        new Request("https://arturonavax.dev/admin/metrics"),
      ),
    ).toBe("ADMIN_SURFACE");

    expect(
      policy.classify(
        new URL("https://admin.arturonavax.dev/"),
        new Request("https://admin.arturonavax.dev/"),
      ),
    ).toBe("ADMIN_SURFACE");

    expect(
      policy.classify(
        new URL("https://blog.arturonavax.dev/sub-50ms"),
        new Request("https://blog.arturonavax.dev/sub-50ms"),
      ),
    ).toBe("SUBDOMAIN_ALIAS");

    expect(
      policy.classify(
        new URL("https://arturonavax.dev/api/search"),
        new Request("https://arturonavax.dev/api/search"),
      ),
    ).toBe("DYNAMIC_API");

    expect(
      policy.classify(
        new URL("https://arturonavax.dev/api/v1/telemetry"),
        new Request("https://arturonavax.dev/api/v1/telemetry", {
          method: "POST",
        }),
      ),
    ).toBe("TELEMETRY_INGESTION");
  });

  it("identifies Fast-Path candidates without blocking overhead", () => {
    expect(policy.isFastPathCandidate("STATIC_ASSET")).toBe(true);
    expect(policy.isFastPathCandidate("PUBLIC_DOCUMENT")).toBe(true);
    expect(policy.isFastPathCandidate("DYNAMIC_API")).toBe(false);
    expect(policy.isFastPathCandidate("ADMIN_SURFACE")).toBe(false);
  });
});

describe("SPEC-005 REQ-PCD-03: Subdomain Canonicalization Engine", () => {
  const policy = new CloudflareEdgeRoutingPolicy();

  it("resolves subdomain canonical paths preserving subpaths and slashes", () => {
    expect(resolveSubdomainPath("blog.arturonavax.dev", "/")).toBe("/blog/");
    expect(resolveSubdomainPath("blog.arturonavax.dev", "/test-post")).toBe(
      "/blog/test-post",
    );
    expect(
      resolveSubdomainPath("blog.arturonavax.dev", "/blog/test-post"),
    ).toBe("/blog/test-post");
    expect(
      resolveSubdomainPath("services.arturonavax.dev", "/consulting"),
    ).toBe("/services/consulting");
    expect(resolveSubdomainPath("projects.arturonavax.dev", "/go-raft")).toBe(
      "/projects/go-raft",
    );
    expect(resolveSubdomainPath("experience.arturonavax.dev", "/staff")).toBe(
      "/experience/staff",
    );
    expect(resolveSubdomainPath("resume.arturonavax.dev", "/")).toBe(
      "/resume/",
    );
    expect(resolveSubdomainPath("maker.arturonavax.dev", "/")).toBe(
      "/resume/maker/",
    );
    expect(resolveSubdomainPath("maker.arturonavax.dev", "/designer")).toBe(
      "/resume/maker/designer",
    );
    expect(resolveSubdomainPath("arturonavax.dev", "/blog/")).toBeNull();
  });

  it("returns HTTP 308 redirect from thematic subdomains preserving query strings", async () => {
    const ctx = createMockCtx();
    const env: Env = { ASSETS: dummyAssets, DB: createMockDb() };

    const req = new Request(
      "https://blog.arturonavax.dev/sub-50ms-fraud?utm_source=twitter&ref=hackernews",
    );
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe(
      "https://arturonavax.dev/blog/sub-50ms-fraud?utm_source=twitter&ref=hackernews",
    );
  });

  it("normalizes maker.arturonavax.dev to /resume/maker/ with 308", async () => {
    const ctx = createMockCtx();
    const env: Env = { ASSETS: dummyAssets, DB: createMockDb() };

    const req = new Request("https://maker.arturonavax.dev/?utm_campaign=hire");
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe(
      "https://arturonavax.dev/resume/maker/?utm_campaign=hire",
    );
  });
});

describe("SPEC-005 REQ-PCD-02: Cloudflare Access & Dashboard Dual-Surface Isolation", () => {
  it("redirects apex /admin immediately to isolated admin.arturonavax.dev with HTTP 308", async () => {
    const ctx = createMockCtx();
    const env: Env = { ASSETS: dummyAssets, DB: createMockDb() };

    const req = new Request("https://arturonavax.dev/admin");
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://admin.arturonavax.dev/");
  });

  it("redirects nested /admin paths and query parameters to the isolated subdomain", async () => {
    const ctx = createMockCtx();
    const env: Env = { ASSETS: dummyAssets, DB: createMockDb() };

    const req = new Request(
      "https://arturonavax.dev/admin/analytics?range=30d&format=json",
    );
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe(
      "https://admin.arturonavax.dev/analytics?range=30d&format=json",
    );
  });

  it("serves isolated admin UI on admin.arturonavax.dev without redirecting to apex", async () => {
    const ctx = createMockCtx();
    const env: Env = { ASSETS: dummyAssets, DB: createMockDb() };

    const req = new Request("https://admin.arturonavax.dev/");
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Admin Management Surface");
    expect(html).toContain("Zero Trust");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("serves isolated admin status API on admin.arturonavax.dev", async () => {
    const ctx = createMockCtx();
    const env: Env = { ASSETS: dummyAssets, DB: createMockDb() };

    const req = new Request("https://admin.arturonavax.dev/api/status");
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.status).toBe("healthy");
    expect(data.surface).toBe("admin-isolated");
  });
});

describe("SPEC-005 REQ-PCD-01 & REQ-PCD-06: Zero-Compute Static Fast-Path & Cache Invariants", () => {
  it("streams immutable assets with 1-year cache headers without database lookups", async () => {
    const ctx = createMockCtx();
    const db = createMockDb();
    const env: Env = { ASSETS: dummyAssets, DB: db };

    const req = new Request("https://arturonavax.dev/_astro/entry.mjs");
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    // Verified: No background queries triggered for static fingerprinted assets
    expect(db.executedQueries.length).toBe(0);
    expect(ctx.promises.length).toBe(0);
  });

  it("applies stale-while-revalidate caching to compiled resume PDFs", async () => {
    const ctx = createMockCtx();
    const env: Env = { ASSETS: dummyAssets, DB: createMockDb() };

    const req = new Request("https://arturonavax.dev/ArturoNava-Resume-EN.pdf");
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain(
      "stale-while-revalidate=86400",
    );
  });
});

describe("SPEC-005 REQ-PCD-04 & REQ-PCD-05: Non-Blocking Telemetry & Fail-Open Resilience", () => {
  it("D1 Blackhole Test: Catastrophic D1 database failure does not break public content delivery", async () => {
    const ctx = createMockCtx();
    const failingDb = createMockDb(true); // Always throws errors
    const env: Env = { ASSETS: dummyAssets, DB: failingDb };

    const req = new Request("https://arturonavax.dev/blog/", {
      headers: { accept: "text/html" },
    });
    const res = await worker.fetch(req, env, ctx);

    // Inviolable Invariant: Content delivered successfully despite DB outage
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Fast-Path Content");

    // Telemetry fails open inside ctx.waitUntil without crashing or throwing
    expect(ctx.promises.length).toBe(1);
    await expect(Promise.all(ctx.promises)).resolves.toBeDefined();
  });

  it("Prefetch requests bypass telemetry collection completely with HTTP 204", async () => {
    const ctx = createMockCtx();
    const db = createMockDb();
    const env: Env = { ASSETS: dummyAssets, DB: db };

    const req = new Request("https://arturonavax.dev/api/v1/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        purpose: "prefetch",
      },
      body: JSON.stringify({ path: "/blog" }),
    });

    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(204);
    expect(ctx.promises.length).toBe(0);
    expect(db.executedQueries.length).toBe(0);
  });

  it("Non-speculative telemetry returns HTTP 202 queued immediately", async () => {
    const ctx = createMockCtx();
    const db = createMockDb();
    const env: Env = { ASSETS: dummyAssets, DB: db };

    const req = new Request("https://arturonavax.dev/api/v1/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "/projects",
        locale: "en",
        visitorHash: "hash-1234",
      }),
    });

    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(202);
    const data = (await res.json()) as any;
    expect(data.status).toBe("queued");
    expect(data.queued).toBe(true);

    await Promise.all(ctx.promises);
    expect(db.executedQueries.length).toBe(2);
  });
});

describe("SPEC-005 REQ-PCD-05: Semantic Search Circuit Breaker & Fail-Open Invariant", () => {
  it("FailOpenCircuitBreaker recovers gracefully on timeout without throwing", async () => {
    const breaker = new FailOpenCircuitBreaker();

    const slowOperation = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return ["never-reached"];
    };

    const fallback = ["fallback-result"];
    const result = await breaker.executeWithFallback(
      slowOperation,
      fallback,
      30, // 30ms timeout
      "slow-test-op",
    );

    expect(result).toEqual(fallback);
  });

  it("FailOpenCircuitBreaker executes fast operations without triggering fallback", async () => {
    const breaker = new FailOpenCircuitBreaker();

    const fastOperation = async () => {
      return ["success-result"];
    };

    const result = await breaker.executeWithFallback(
      fastOperation,
      ["fallback"],
      100,
      "fast-test-op",
    );

    expect(result).toEqual(["success-result"]);
  });

  it("/api/search degrades to static memory search and returns HTTP 200 when AI throws", async () => {
    const ctx = createMockCtx();
    const envWithFailingAI: Env = {
      ASSETS: dummyAssets,
      DB: createMockDb(),
      APP_SEARCH_DRIVER: "cloudflare-vectorize",
      AI: {
        run: async () => {
          throw new Error("Cloudflare Workers AI Gateway Timeout (504)");
        },
      },
      VECTORIZE_INDEX: {
        query: async () => {
          throw new Error("Vectorize Index Unavailable");
        },
      },
    };

    const req = new Request(
      "https://arturonavax.dev/api/search?q=systems&locale=en&utm_source=google",
    );
    const res = await worker.fetch(req, envWithFailingAI, ctx);

    // Invariant: Must return HTTP 200 (never 500) under AI failure
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.results)).toBe(true);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });

  it("/api/search returns empty results immediately for whitespace or empty queries", async () => {
    const ctx = createMockCtx();
    const env: Env = { ASSETS: dummyAssets, DB: createMockDb() };

    const req = new Request("https://arturonavax.dev/api/search?q=%20%20");
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results).toEqual([]);
  });
});
