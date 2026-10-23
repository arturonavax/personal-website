import { describe, expect, it } from "bun:test";
import worker, {
  type Env,
  handleAdminDashboardRequest,
  recordAnalyticsNonBlocking,
  clearRecentPageviewsCache,
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
    if (url.includes("/__admin_vault__") || url.includes("/admin")) {
      return new Response(
        "<html><head><title>Admin Management Surface</title></head><body><h1>Admin Management Surface // Zero Trust</h1></body></html>",
        {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      );
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
        sql,
        params,
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
    batch: async (stmts: { sql: string; params: any[] }[]) => {
      if (shouldThrow) {
        throw new Error("D1 Catastrophic Database Failure Simulation");
      }
      for (const s of stmts)
        executedQueries.push({ sql: s.sql, params: s.params });
      return stmts.map(() => ({ success: true }));
    },
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
      "/tools/resume-maker/",
    );
    expect(resolveSubdomainPath("maker.arturonavax.dev", "/designer")).toBe(
      "/tools/resume-maker/designer",
    );
    expect(resolveSubdomainPath("blog.arturonavax.dev", "/es")).toBe(
      "/es/blog/",
    );
    expect(resolveSubdomainPath("blog.arturonavax.dev", "/es/")).toBe(
      "/es/blog/",
    );
    expect(
      resolveSubdomainPath("blog.arturonavax.dev", "/es/sub-50ms-fraud"),
    ).toBe("/es/blog/sub-50ms-fraud");
    expect(
      resolveSubdomainPath("blog.arturonavax.dev", "/es/blog/sub-50ms-fraud"),
    ).toBe("/es/blog/sub-50ms-fraud");
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

  it("normalizes maker.arturonavax.dev to /tools/resume-maker/ with 308", async () => {
    const ctx = createMockCtx();
    const env: Env = { ASSETS: dummyAssets, DB: createMockDb() };

    const req = new Request("https://maker.arturonavax.dev/?utm_campaign=hire");
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe(
      "https://arturonavax.dev/tools/resume-maker/?utm_campaign=hire",
    );
  });
});

describe("SPEC-005 REQ-PCD-02: Cloudflare Access & Dashboard Dual-Surface Isolation", () => {
  it("blocks unauthenticated apex /admin with fail-closed Zero Trust (HTTP 401/403)", async () => {
    const ctx = createMockCtx();
    const env: Env = { ASSETS: dummyAssets, DB: createMockDb() };

    const req = new Request("https://arturonavax.dev/admin");
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("blocks unauthenticated nested /admin paths and query parameters with fail-closed Zero Trust", async () => {
    const ctx = createMockCtx();
    const env: Env = { ASSETS: dummyAssets, DB: createMockDb() };

    const req = new Request(
      "https://arturonavax.dev/admin/analytics?range=30d&format=json",
    );
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("serves isolated admin UI on admin.arturonavax.dev when authenticated", async () => {
    const ctx = createMockCtx();
    const env: Env = {
      ASSETS: dummyAssets,
      DB: createMockDb(),
      ADMIN_ACCESS_TOKEN: "super-secret-admin-token-min-32-chars-long",
    };

    const req = new Request("https://admin.arturonavax.dev/", {
      headers: {
        Authorization: "Bearer super-secret-admin-token-min-32-chars-long",
      },
    });
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Admin Management Surface");
    expect(html).toContain("Zero Trust");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("serves isolated admin status API on admin.arturonavax.dev when authenticated", async () => {
    const ctx = createMockCtx();
    const env: Env = {
      ASSETS: dummyAssets,
      DB: createMockDb(),
      ADMIN_ACCESS_TOKEN: "super-secret-admin-token-min-32-chars-long",
    };

    const req = new Request("https://admin.arturonavax.dev/api/status", {
      headers: {
        Authorization: "Bearer super-secret-admin-token-min-32-chars-long",
      },
    });
    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.status).toBe("healthy");
    expect(data.surface).toBe("admin-isolated");
  });

  it("serves admin APIs on both apex domain and admin subdomain when authenticated", async () => {
    const ctx = createMockCtx();
    const env: Env = {
      ASSETS: dummyAssets,
      DB: createMockDb(),
      ADMIN_ACCESS_TOKEN: "super-secret-admin-token-min-32-chars-long",
    };
    const authHeaders = {
      Authorization: "Bearer super-secret-admin-token-min-32-chars-long",
    };

    const apexTelReq = new Request(
      "https://arturonavax.dev/api/telemetry?range=all",
      {
        headers: authHeaders,
      },
    );
    const apexTelRes = await worker.fetch(apexTelReq, env, ctx);
    expect(apexTelRes.status).toBe(200);
    const telData = (await apexTelRes.json()) as any;
    expect(telData.status).toBe("ok");

    const apexMetricsReq = new Request("https://arturonavax.dev/api/metrics", {
      headers: authHeaders,
    });
    const apexMetricsRes = await worker.fetch(apexMetricsReq, env, ctx);
    expect(apexMetricsRes.status).toBe(200);

    const apexLeadsReq = new Request("https://arturonavax.dev/api/leads", {
      headers: authHeaders,
    });
    const apexLeadsRes = await worker.fetch(apexLeadsReq, env, ctx);
    expect(apexLeadsRes.status).toBe(200);

    const apexDeployReq = new Request(
      "https://arturonavax.dev/api/deployments",
      {
        headers: authHeaders,
      },
    );
    const apexDeployRes = await worker.fetch(apexDeployReq, env, ctx);
    expect(apexDeployRes.status).toBe(200);
  });

  it("strictly blocks unauthenticated access to admin UI and APIs when REQUIRE_CF_ACCESS is true", async () => {
    const ctx = createMockCtx();
    const env: Env = {
      ASSETS: dummyAssets,
      DB: createMockDb(),
      REQUIRE_CF_ACCESS: "true",
      REQUIRE_ADMIN_AUTH: "true",
      ADMIN_ACCESS_TOKEN: "test-only-admin-bearer-at-least-20",
      ADMIN_AUTHORIZED_EMAILS: "arturonavax@gmail.com,contact@arturonava.com",
    };

    // 1. Unauthenticated HTML request to admin subdomain returns HTTP 401 with challenge HTML
    const htmlReq = new Request("https://admin.arturonavax.dev/", {
      headers: { Accept: "text/html" },
    });
    const htmlRes = await worker.fetch(htmlReq, env, ctx);
    expect(htmlRes.status).toBe(401);
    const html = await htmlRes.text();
    expect(html).toContain("401 UNAUTHORIZED // ZERO TRUST ENFORCED");
    expect(html).toContain("Acceso Restringido");
    expect(htmlRes.headers.get("X-Robots-Tag")).toBe(
      "noindex, nofollow, noarchive",
    );

    // 2. Unauthenticated API request returns HTTP 401 JSON
    const telReq = new Request("https://admin.arturonavax.dev/api/telemetry");
    const telRes = await worker.fetch(telReq, env, ctx);
    expect(telRes.status).toBe(401);
    const telData = (await telRes.json()) as any;
    expect(telData.error).toBe("Unauthorized");
    expect(telData.message).toContain(
      "Cloudflare Access Zero Trust authentication required",
    );

    // 3. Unauthenticated API request on apex domain returns HTTP 401 JSON
    const apexReq = new Request("https://arturonavax.dev/api/telemetry");
    const apexRes = await worker.fetch(apexReq, env, ctx);
    expect(apexRes.status).toBe(401);

    // 4. Request with unauthorized email returns HTTP 401
    const unauthEmailReq = new Request(
      "https://admin.arturonavax.dev/api/telemetry",
      {
        headers: {
          "cf-access-authenticated-user-email": "malicious@attacker.com",
        },
      },
    );
    const unauthEmailRes = await worker.fetch(unauthEmailReq, env, ctx);
    expect(unauthEmailRes.status).toBe(401);

    // 5. Verified bearer authorization succeeds; identity headers alone never grant access.
    const authEmailReq = new Request(
      "https://admin.arturonavax.dev/api/telemetry",
      {
        headers: {
          "cf-access-authenticated-user-email": "arturonavax@gmail.com",
          Authorization: "Bearer test-only-admin-bearer-at-least-20",
        },
      },
    );
    const authEmailRes = await worker.fetch(authEmailReq, env, ctx);
    expect(authEmailRes.status).toBe(200);
    const authTelData = (await authEmailRes.json()) as any;
    expect(authTelData.status).toBe("ok");
    expect(authTelData.quotas.d1_writes_daily).toBeDefined();
    expect(authTelData.quotas.d1_writes_daily.limit).toBe(100000);
    expect(authTelData.quotas.workers_ai_daily).toBeDefined();
    expect(authTelData.quotas.vectorize_monthly).toBeDefined();

    // 6. Another protected endpoint preserves configured bearer authentication.
    const authEmail2Req = new Request(
      "https://admin.arturonavax.dev/api/metrics",
      {
        headers: {
          "cf-access-authenticated-user-email": "contact@arturonava.com",
          Authorization: "Bearer test-only-admin-bearer-at-least-20",
        },
      },
    );
    const authEmail2Res = await worker.fetch(authEmail2Req, env, ctx);
    expect(authEmail2Res.status).toBe(200);
  });

  it("authenticates via ADMIN_API_KEY (Bearer header, query parameter, or session cookie)", async () => {
    const ctx = createMockCtx();
    const env: Env = {
      ASSETS: dummyAssets,
      DB: createMockDb(),
      REQUIRE_CF_ACCESS: "true",
      REQUIRE_ADMIN_AUTH: "true",
      ADMIN_API_KEY: "super-secret-admin-token-xyz",
    };

    // Bearer header
    const bearerReq = new Request("https://admin.arturonavax.dev/api/status", {
      headers: { Authorization: "Bearer super-secret-admin-token-xyz" },
    });
    const bearerRes = await worker.fetch(bearerReq, env, ctx);
    expect(bearerRes.status).toBe(200);

    // Query token on document request sets cookie and returns 200
    const queryReq = new Request(
      "https://admin.arturonavax.dev/?token=super-secret-admin-token-xyz",
    );
    const queryRes = await worker.fetch(queryReq, env, ctx);
    expect(queryRes.status).toBe(200);
    expect(queryRes.headers.get("Set-Cookie")).toContain(
      "admin_session=super-secret-admin-token-xyz",
    );

    // Cookie session
    const cookieReq = new Request(
      "https://admin.arturonavax.dev/api/telemetry",
      {
        headers: { Cookie: "admin_session=super-secret-admin-token-xyz" },
      },
    );
    const cookieRes = await worker.fetch(cookieReq, env, ctx);
    expect(cookieRes.status).toBe(200);

    // Invalid token rejected
    const invalidTokenReq = new Request(
      "https://admin.arturonavax.dev/api/telemetry",
      {
        headers: { Authorization: "Bearer wrong-token" },
      },
    );
    const invalidTokenRes = await worker.fetch(invalidTokenReq, env, ctx);
    expect(invalidTokenRes.status).toBe(401);
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

  it("handles 304 Not Modified cleanly for immutable assets and PDFs without body conflict", async () => {
    const ctx = createMockCtx();
    const assetsWith304: Fetcher = {
      fetch: async () =>
        new Response(null, {
          status: 304,
          headers: { ETag: '"304-tag"' },
        }),
    } as unknown as Fetcher;
    const env: Env = { ASSETS: assetsWith304, DB: createMockDb() };

    const reqAsset = new Request("https://arturonavax.dev/_astro/entry.mjs", {
      headers: { "if-none-match": '"304-tag"' },
    });
    const resAsset = await worker.fetch(reqAsset, env, ctx);
    expect(resAsset.status).toBe(304);
    expect(resAsset.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );

    const reqPdf = new Request(
      "https://arturonavax.dev/ArturoNava-Resume-EN.pdf",
      {
        headers: { "if-none-match": '"304-tag"' },
      },
    );
    const resPdf = await worker.fetch(reqPdf, env, ctx);
    expect(resPdf.status).toBe(304);
    expect(resPdf.headers.get("Cache-Control")).toContain(
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

    clearRecentPageviewsCache();
    const req = new Request("https://arturonavax.dev/api/v1/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        path: "/projects",
        locale: "en",
        visitorHash: "client-supplied-hash-must-be-ignored",
      }),
    });

    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(202);
    const data = (await res.json()) as any;
    expect(data.status).toBe("queued");
    expect(data.queued).toBe(true);

    await Promise.all(ctx.promises);
    // Only edge_telemetry_events: pageview_events rollups belong exclusively to the server-side pipeline.
    expect(db.executedQueries.length).toBe(1);
    expect(db.executedQueries[0].sql).toContain("edge_telemetry_events");
    expect(db.executedQueries[0].params).not.toContain(
      "client-supplied-hash-must-be-ignored",
    );
  });

  it("rejects cross-origin telemetry beacons with 403 and never touches D1", async () => {
    const ctx = createMockCtx();
    const db = createMockDb();
    const env: Env = { ASSETS: dummyAssets, DB: db };

    const res = await worker.fetch(
      new Request("https://arturonavax.dev/api/v1/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({ path: "/blog" }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(403);
    expect(ctx.promises.length).toBe(0);
    expect(db.executedQueries.length).toBe(0);
  });

  it("rejects oversized telemetry payloads with 413", async () => {
    const ctx = createMockCtx();
    const db = createMockDb();
    const env: Env = { ASSETS: dummyAssets, DB: db };

    const res = await worker.fetch(
      new Request("https://arturonavax.dev/api/v1/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
          "Content-Length": "999999",
        },
        body: JSON.stringify({ path: "/blog" }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(413);
    expect(db.executedQueries.length).toBe(0);
  });

  it("silently drops beacons with scanner, static-asset or malformed paths (no D1 writes)", async () => {
    for (const badPath of [
      "/.env",
      "/wp-login.php",
      "/_astro/app.js",
      "no-leading-slash",
      "/blog/<script>",
    ]) {
      clearRecentPageviewsCache();
      const ctx = createMockCtx();
      const db = createMockDb();
      const env: Env = { ASSETS: dummyAssets, DB: db };
      const res = await worker.fetch(
        new Request("https://arturonavax.dev/api/v1/telemetry", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Sec-Fetch-Site": "same-origin",
          },
          body: JSON.stringify({ path: badPath }),
        }),
        env,
        ctx,
      );
      expect(res.status).toBe(202);
      await Promise.all(ctx.promises);
      expect(db.executedQueries.length).toBe(0);
    }
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

    let fallbackCalled = false;
    const lazyFallback = () => {
      fallbackCalled = true;
      return ["lazy-fallback"];
    };

    const result = await breaker.executeWithFallback(
      fastOperation,
      lazyFallback,
      100,
      "fast-test-op",
    );

    expect(result).toEqual(["success-result"]);
    expect(fallbackCalled).toBe(false);
  });

  it("FailOpenCircuitBreaker evaluates lazy fallback function only when operation times out", async () => {
    const breaker = new FailOpenCircuitBreaker();

    const slowOperation = async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return ["slow-result"];
    };

    let fallbackCalled = false;
    const lazyFallback = async () => {
      fallbackCalled = true;
      return ["lazy-fallback-recovered"];
    };

    const result = await breaker.executeWithFallback(
      slowOperation,
      lazyFallback,
      20,
      "slow-lazy-op",
    );

    expect(result).toEqual(["lazy-fallback-recovered"]);
    expect(fallbackCalled).toBe(true);
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
