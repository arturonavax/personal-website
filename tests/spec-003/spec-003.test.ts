import { describe, expect, it } from "bun:test";
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALES_REGISTRY,
  FALLBACK_CHAIN,
} from "../../src/i18n/locales";
import {
  LocalFileSystemStorageAdapter,
  StaticMemorySearchAdapter,
  SQLiteTelemetryAdapter,
  HoneypotCaptchaAdapter,
  MemoryCacheStorageAdapter,
  CloudflareR2StorageAdapter,
  S3CompatibleStorageAdapter,
  CloudflareVectorizeSearchAdapter,
  D1TelemetryAdapter,
  TurnstileCaptchaAdapter,
  CloudflareCacheApiAdapter,
  createStorageAdapter,
  createSearchAdapter,
  createTelemetryAdapter,
  createCaptchaAdapter,
} from "../../src/lib/adapters";
import {
  buildPersonJsonLd,
  buildArticleJsonLd,
} from "../../src/lib/seo/schema-builder";
import { handleAnalyticsRollup } from "../../cloudflare/cron-scheduler";
import { processIncomingEmail } from "../../cloudflare/email-worker";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("SPEC-003: Multi-Language Architecture & Locales Registry", () => {
  it("enforces EN as default locale and supports ES", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(SUPPORTED_LOCALES).toContain("en");
    expect(SUPPORTED_LOCALES).toContain("es");
  });

  it("provides complete locale metadata in LOCALES_REGISTRY", () => {
    expect(LOCALES_REGISTRY.en.isoCode).toBe("en-US");
    expect(LOCALES_REGISTRY.en.dir).toBe("ltr");
    expect(LOCALES_REGISTRY.es.isoCode).toBe("es-CO");
    expect(LOCALES_REGISTRY.es.dir).toBe("ltr");
  });

  it("defines robust fallback chains", () => {
    expect(FALLBACK_CHAIN.en).toEqual(["en"]);
    expect(FALLBACK_CHAIN.es).toEqual(["es", "en"]);
  });
});

describe("SPEC-003: Hexagonal Adapters & Storage Port", () => {
  it("LocalFileSystemStorageAdapter can put, get, delete, and getPublicUrl", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "spec-003-storage-"),
    );
    const adapter = new LocalFileSystemStorageAdapter(
      tmpDir,
      "https://arturonavax.dev/assets",
    );

    const key = "test-doc.txt";
    const content = "Hello Hexagonal Storage";
    await adapter.put(key, content);

    const retrieved = await adapter.get(key);
    expect(retrieved).not.toBeNull();
    const text = Buffer.from(retrieved!.data as Uint8Array).toString("utf-8");
    expect(text).toBe(content);
    expect(adapter.getPublicUrl(key)).toBe(
      "https://arturonavax.dev/assets/test-doc.txt",
    );

    await adapter.delete(key);
    const afterDelete = await adapter.get(key);
    expect(afterDelete).toBeNull();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

describe("SPEC-003: Semantic Search Port & Static Memory Adapter", () => {
  it("indexes documents and performs token-based search with locale filtering", async () => {
    const searchAdapter = new StaticMemorySearchAdapter();

    await searchAdapter.indexDocument(
      {
        id: "doc-1",
        title: "Sub-50ms Fraud Detection in Go",
        description: "Low-latency streaming anti-fraud evaluation",
        url: "/blog/sub-50ms-fraud-engine-go/",
        locale: "en",
        score: 0,
      },
      "Distributed systems zero allocation memory Redis sliding windows Go",
    );

    await searchAdapter.indexDocument(
      {
        id: "doc-2",
        title: "Detección de Fraude en Tiempo Real en Go",
        description: "Evaluación de antifraude de baja latencia",
        url: "/es/blog/sub-50ms-fraud-engine-go/",
        locale: "es",
        score: 0,
      },
      "Sistemas distribuidos baja latencia Redis Go",
    );

    const enResults = await searchAdapter.search({
      query: "fraud detection Go",
      locale: "en",
    });
    expect(enResults.length).toBeGreaterThan(0);
    expect(enResults[0].id).toBe("doc-1");

    const esResults = await searchAdapter.search({
      query: "fraude latencia",
      locale: "es",
    });
    expect(esResults.length).toBeGreaterThan(0);
    expect(esResults[0].id).toBe("doc-2");
  });
});

describe("SPEC-003: Telemetry Port & SQLite Adapter Fallback", () => {
  it("records pageviews and computes daily aggregations", async () => {
    const telemetry = new SQLiteTelemetryAdapter();

    const timestamp = Date.now();
    const dateStr = new Date(timestamp).toISOString().slice(0, 10);

    await telemetry.recordPageview({
      path: "/blog/post-1",
      locale: "en",
      country: "US",
      timestamp,
    });

    await telemetry.recordPageview({
      path: "/blog/post-1",
      locale: "en",
      country: "US",
      timestamp,
    });

    const metrics = await telemetry.getAggregatedMetrics(dateStr, dateStr);
    expect(metrics.length).toBe(1);
    expect(metrics[0].views).toBe(2);
    expect(metrics[0].path).toBe("/blog/post-1");
  });
});

describe("SPEC-003: Captcha Verifier Port & Honeypot Adapter Fallback", () => {
  it("accepts human submissions when honeypot is empty and flags bots when filled", async () => {
    const honeypot = new HoneypotCaptchaAdapter();

    const humanResult = await honeypot.verify({ token: "" });
    expect(humanResult.success).toBe(true);

    const botResult = await honeypot.verify({
      token: "spam-bot-inserted-text",
    });
    expect(botResult.success).toBe(false);
  });
});

describe("SPEC-003: Memory Cache Storage Adapter", () => {
  it("stores, retrieves, and deletes responses", async () => {
    const cache = new MemoryCacheStorageAdapter();
    const res = new Response("Cached payload", {
      headers: { "Content-Type": "text/plain" },
    });

    await cache.put("https://arturonavax.dev/test", res);
    const cached = await cache.get("https://arturonavax.dev/test");
    expect(cached).not.toBeNull();
    expect(await cached!.text()).toBe("Cached payload");

    const deleted = await cache.delete("https://arturonavax.dev/test");
    expect(deleted).toBe(true);
    expect(await cache.get("https://arturonavax.dev/test")).toBeNull();
  });
});

describe("SPEC-003: Hexagonal Adapter Factory Driver Selection", () => {
  it("defaults to fallback drivers in non-Cloudflare environments", () => {
    const storage = createStorageAdapter();
    expect(storage).toBeInstanceOf(LocalFileSystemStorageAdapter);

    const search = createSearchAdapter();
    expect(search).toBeInstanceOf(StaticMemorySearchAdapter);

    const telemetry = createTelemetryAdapter();
    expect(telemetry).toBeInstanceOf(SQLiteTelemetryAdapter);

    const captcha = createCaptchaAdapter();
    expect(captcha).toBeInstanceOf(HoneypotCaptchaAdapter);
  });
});

describe("SPEC-003: Canonical SEO & JSON-LD Isolation", () => {
  it("builds Person JSON-LD with stable global @id and localized fields", () => {
    const jsonLd = buildPersonJsonLd({
      locale: "es",
      canonicalUrl: "https://arturonavax.dev/es/",
      jobTitle: "Ingeniero Senior de Backend",
      description: "Especialista en sistemas distribuidos",
    });

    expect(jsonLd["@id"]).toBe("https://arturonavax.dev/#person");
    expect(jsonLd["inLanguage"]).toBe("es");
    expect(jsonLd["jobTitle"]).toBe("Ingeniero Senior de Backend");
  });

  it("builds Article JSON-LD with attribution and metadata", () => {
    const articleLd = buildArticleJsonLd({
      locale: "en",
      canonicalUrl: "https://arturonavax.dev/blog/sub-50ms-fraud-engine-go/",
      headline: "Designing Sub-50ms Fraud Detection in Go",
      description: "Low latency streaming fraud engine",
      publishedAt: "2026-02-15T00:00:00Z",
      tags: ["Go", "Distributed Systems"],
    });

    expect(articleLd["@type"]).toBe("TechArticle");
    expect(articleLd["inLanguage"]).toBe("en");
    expect(articleLd["headline"]).toBe(
      "Designing Sub-50ms Fraud Detection in Go",
    );
  });
});

describe("SPEC-003: Cron Scheduler & Email Worker", () => {
  it("handleAnalyticsRollup executes aggregation and prune queries on D1", async () => {
    const executedQueries: string[] = [];
    const mockDb = {
      exec: async (query: string) => {
        executedQueries.push(query);
      },
    } as unknown as D1Database;

    await handleAnalyticsRollup({ DB: mockDb });
    expect(executedQueries.length).toBe(2);
    expect(executedQueries[0]).toContain("INSERT INTO pageviews_daily_summary");
    expect(executedQueries[1]).toContain("DELETE FROM pageview_events");
  });

  it("processIncomingEmail inserts lead into D1 contact_leads", async () => {
    let boundParams: unknown[] = [];
    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => {
          boundParams = params;
          return {
            run: async () => {},
          };
        },
      }),
    } as unknown as D1Database;

    const mockMessage = {
      from: "recruiter@techcorp.com",
      to: "arturo@arturonavax.dev",
      headers: new Headers({ subject: "Staff Backend Role Opportunity" }),
      raw: new Response("Hello Arturo, we loved your distributed systems work.")
        .body!,
      setReject: () => {},
      forward: async () => {},
    };

    const mockCtx = {
      waitUntil: (promise: Promise<unknown>) => {},
    } as unknown as ExecutionContext;

    await processIncomingEmail(mockMessage, { DB: mockDb }, mockCtx);
    expect(boundParams[0]).toBe("recruiter@techcorp.com");
    expect(boundParams[1]).toBe("Staff Backend Role Opportunity");
    expect(boundParams[2]).toBe(
      "Hello Arturo, we loved your distributed systems work.",
    );
  });
});

describe("SPEC-003: Cloudflare Edge Storage (R2 + Cache API) & S3 Fallback", () => {
  it("CloudflareR2StorageAdapter interacts with Cache API and R2 bucket", async () => {
    const originalCaches = (globalThis as any).caches;
    const cacheMap = new Map<string, Response>();
    (globalThis as any).caches = {
      default: {
        match: async (req: Request) => {
          const found = cacheMap.get(req.url);
          return found ? found.clone() : null;
        },
        put: async (req: Request, res: Response) => {
          cacheMap.set(req.url, res.clone());
        },
        delete: async (req: Request) => cacheMap.delete(req.url),
      },
    };

    const r2Store = new Map<string, { body: Uint8Array; size: number; contentType?: string; etag: string }>();
    const mockBucket = {
      get: async (key: string) => {
        const item = r2Store.get(key);
        if (!item) return null;
        return {
          body: item.body,
          size: item.size,
          httpMetadata: { contentType: item.contentType },
          httpEtag: item.etag,
        };
      },
      put: async (key: string, data: any, options?: any) => {
        const bytes = typeof data === "string" ? Buffer.from(data) : data;
        r2Store.set(key, {
          body: bytes,
          size: bytes.length,
          contentType: options?.httpMetadata?.contentType || "application/octet-stream",
          etag: '"mock-r2-etag"',
        });
      },
      delete: async (key: string) => {
        r2Store.delete(key);
      },
    } as unknown as R2Bucket;

    const waitUntils: Promise<any>[] = [];
    const mockCtx = {
      waitUntil: (p: Promise<any>) => waitUntils.push(p),
    } as ExecutionContext;

    const r2Adapter = new CloudflareR2StorageAdapter(mockBucket, "arturonavax.dev", mockCtx);

    // 1. Put document into R2
    await r2Adapter.put("doc.pdf", Buffer.from("PDF DATA"), { contentType: "application/pdf" });

    // 2. First get: Cache miss -> loads from R2 and stores into Cache API via waitUntil
    const res1 = await r2Adapter.get("doc.pdf");
    expect(res1).not.toBeNull();
    expect(res1!.metadata.contentType).toBe("application/pdf");
    expect(res1!.metadata.etag).toBe('"mock-r2-etag"');
    await Promise.all(waitUntils);

    // 3. Second get: Cache hit
    const res2 = await r2Adapter.get("doc.pdf");
    expect(res2).not.toBeNull();
    expect(res2!.metadata.contentType).toBe("application/pdf");

    // 4. Public URL check
    expect(r2Adapter.getPublicUrl("doc.pdf")).toBe("https://arturonavax.dev/doc.pdf");

    // 5. Delete
    await r2Adapter.delete("doc.pdf");

    (globalThis as any).caches = originalCaches;
  });

  it("S3CompatibleStorageAdapter operates against S3-compatible endpoints", async () => {
    const originalFetch = globalThis.fetch;
    const store = new Map<string, { body: string; headers: Headers }>();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";

      if (method === "PUT") {
        const headers = new Headers(init?.headers);
        store.set(url, { body: String(init?.body || ""), headers });
        return new Response(null, { status: 200 });
      }

      if (method === "GET") {
        const item = store.get(url);
        if (!item) return new Response(null, { status: 404 });
        return new Response(item.body, {
          status: 200,
          headers: {
            "content-type": item.headers.get("Content-Type") || "application/octet-stream",
            "content-length": String(item.body.length),
            etag: '"s3-etag"',
          },
        });
      }

      if (method === "DELETE") {
        store.delete(url);
        return new Response(null, { status: 204 });
      }

      return new Response(null, { status: 400 });
    }) as typeof fetch;

    const s3Adapter = new S3CompatibleStorageAdapter({
      endpoint: "https://s3.example.com",
      bucket: "assets",
      publicUrl: "https://cdn.example.com",
    });

    await s3Adapter.put("resume.pdf", "S3 CONTENT", { contentType: "application/pdf" });
    const item = await s3Adapter.get("resume.pdf");
    expect(item).not.toBeNull();
    expect(item!.metadata.contentType).toBe("application/pdf");
    expect(s3Adapter.getPublicUrl("resume.pdf")).toBe("https://cdn.example.com/resume.pdf");

    await s3Adapter.delete("resume.pdf");
    const afterDelete = await s3Adapter.get("resume.pdf");
    expect(afterDelete).toBeNull();

    globalThis.fetch = originalFetch;
  });
});

describe("SPEC-003: Cloudflare Vectorize + Workers AI Search Adapter", () => {
  it("generates embeddings and performs semantic search via Vectorize index", async () => {
    const mockAi = {
      run: async (model: string, input: { text: string | string[] }) => {
        expect(model).toBe("@cf/baai/bge-small-en-v1.5");
        return { data: [[0.1, 0.2, 0.3, 0.4]] };
      },
    };

    let insertedRecords: any[] = [];
    const mockVectorize = {
      query: async (vector: number[], options?: any) => {
        expect(vector).toEqual([0.1, 0.2, 0.3, 0.4]);
        expect(options.filter.locale).toBe("en");
        return {
          matches: [
            {
              id: "blog-1",
              score: 0.92,
              metadata: {
                title: "Distributed Systems in Go",
                description: "High concurrency architecture",
                url: "/blog/distributed-systems-go/",
                locale: "en",
              },
            },
          ],
        };
      },
      insert: async (vectors: any[]) => {
        insertedRecords = vectors;
        return { count: vectors.length };
      },
    };

    const adapter = new CloudflareVectorizeSearchAdapter(mockAi, mockVectorize);

    // Test Search
    const results = await adapter.search({
      query: "distributed systems Go",
      locale: "en",
      limit: 5,
      threshold: 0.8,
    });

    expect(results.length).toBe(1);
    expect(results[0].id).toBe("blog-1");
    expect(results[0].title).toBe("Distributed Systems in Go");

    // Test Indexing
    await adapter.indexDocument(
      {
        id: "blog-2",
        title: "Rust SIMD Performance",
        description: "Vectorized processing",
        url: "/blog/rust-simd/",
        locale: "en",
        score: 0,
      },
      "AVX2 instructions in Rust for streaming analytics",
    );

    expect(insertedRecords.length).toBe(1);
    expect(insertedRecords[0].id).toBe("blog-2");
    expect(insertedRecords[0].values).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});

describe("SPEC-003: Cloudflare D1 Telemetry Adapter & Turnstile Captcha", () => {
  it("D1TelemetryAdapter records pageviews and queries aggregated rollups", async () => {
    const executedD1Calls: { sql: string; params: any[] }[] = [];
    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...params: any[]) => {
          executedD1Calls.push({ sql, params });
          return {
            run: async () => {},
            all: async () => ({
              results: [
                {
                  date: "2026-10-03",
                  path: "/blog",
                  locale: "en",
                  country: "US",
                  views: 10,
                },
              ],
            }),
          };
        },
      }),
    } as unknown as D1Database;

    const adapter = new D1TelemetryAdapter(mockDb);

    await adapter.recordPageview({
      path: "/experience",
      locale: "en",
      country: "US",
      referrer: "https://google.com",
      timestamp: 1727999999000,
    });

    expect(executedD1Calls.length).toBe(1);
    expect(executedD1Calls[0].sql).toContain("INSERT INTO pageview_events");
    expect(executedD1Calls[0].params[0]).toBe("/experience");

    const metrics = await adapter.getAggregatedMetrics("2026-10-01", "2026-10-03");
    expect(metrics.length).toBe(1);
    expect(metrics[0].views).toBe(10);
  });

  it("TurnstileCaptchaAdapter verifies human challenge against Cloudflare API", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      return new Response(
        JSON.stringify({
          success: true,
          challenge_ts: "2026-10-03T20:00:00Z",
          hostname: "arturonavax.dev",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const turnstile = new TurnstileCaptchaAdapter("0x4AAAAAAAMockSecret");
    const result = await turnstile.verify({ token: "valid-turnstile-token", remoteIp: "1.2.3.4" });

    expect(result.success).toBe(true);
    expect(result.hostname).toBe("arturonavax.dev");

    globalThis.fetch = originalFetch;
  });

  it("CloudflareCacheApiAdapter provides standard get, put, delete via caches.default", async () => {
    const originalCaches = (globalThis as any).caches;
    const cacheMap = new Map<string, Response>();
    (globalThis as any).caches = {
      default: {
        match: async (req: Request) => {
          const res = cacheMap.get(req.url);
          return res ? res.clone() : null;
        },
        put: async (req: Request, res: Response) => {
          cacheMap.set(req.url, res.clone());
        },
        delete: async (req: Request) => cacheMap.delete(req.url),
      },
    };

    const cacheAdapter = new CloudflareCacheApiAdapter();
    const testReq = new Request("https://arturonavax.dev/cached-page");
    const testRes = new Response("Cached HTML content", { headers: { "Content-Type": "text/html" } });

    await cacheAdapter.put(testReq, testRes);
    const cached = await cacheAdapter.get(testReq);
    expect(cached).not.toBeNull();
    expect(await cached!.text()).toBe("Cached HTML content");

    const deleted = await cacheAdapter.delete(testReq);
    expect(deleted).toBe(true);
    expect(await cacheAdapter.get(testReq)).toBeNull();

    (globalThis as any).caches = originalCaches;
  });
});
