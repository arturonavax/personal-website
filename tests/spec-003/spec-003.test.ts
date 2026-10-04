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
