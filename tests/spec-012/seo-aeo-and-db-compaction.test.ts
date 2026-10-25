import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  PERSON_ENTITY_ID,
  WEBSITE_ENTITY_ID,
  buildArticleJsonLd,
  buildCoreGraphNodes,
  buildExperienceJsonLd,
  buildPersonJsonLd,
  buildProjectJsonLd,
  buildResumeJsonLd,
  buildServiceJsonLd,
  ensureUnifiedGraphJsonLd,
} from "../../src/lib/seo/schema-builder";
import {
  QuotaDegradationTier,
  edgeQuotaTracker,
  resolveDegradationTier,
  resolveQuotaConfig,
} from "../../src/lib/adapters/cloudflare/circuit-breaker.adapter";
import { verifyContentHydration } from "../../scripts/lib/r2-content.mjs";
import { notifyIndexNow } from "../../scripts/r2-push.mjs";
import {
  resolveVerifiedHreflang,
  sanitizeCanonicalUrl,
} from "../../src/utils/seo";

const ROOT_DIR = process.cwd();

describe("SPEC-012: D1 Database Compaction & Deterministic Reset Architecture", () => {
  it("initializes pristine unified schema on bun:sqlite from reset.sql and schema.sql", () => {
    const db = new Database(":memory:");

    const schemaSql = fs.readFileSync(
      path.join(ROOT_DIR, "cloudflare/d1/schema.sql"),
      "utf8",
    );
    const resetSql = fs.readFileSync(
      path.join(ROOT_DIR, "cloudflare/d1/reset.sql"),
      "utf8",
    );

    // 1. Execute full schema
    db.run(schemaSql);

    // Assert all tables exist
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
      )
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain("pageviews");
    expect(tables).toContain("telemetry_events");
    expect(tables).toContain("edge_telemetry_events");
    expect(tables).toContain("pageview_events");
    expect(tables).toContain("pageviews_daily_summary");
    expect(tables).toContain("analytics_rollups");
    expect(tables).toContain("contact_leads");
    expect(tables).toContain("prefetch_analytics_events");
    expect(tables).toContain("quota_state_daily");
    expect(tables).toContain("circuit_breaker_incidents");
    expect(tables).toContain("system_deployments");

    // Assert only pruned indexes exist on pageviews
    const pageviewIndexes = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='pageviews';",
      )
      .all()
      .map((r: any) => r.name);

    expect(pageviewIndexes).toContain("idx_pageviews_dedupe_key");
    expect(pageviewIndexes).toContain("idx_pageviews_analytics");
    expect(pageviewIndexes).toContain("idx_pageviews_visitor");
    expect(pageviewIndexes).toContain("idx_pageviews_attribution");
    expect(pageviewIndexes).toContain("idx_pageviews_created_at");

    // Redundant indexes must be absent
    expect(pageviewIndexes).not.toContain("idx_pageviews_perf_composite");
    expect(pageviewIndexes).not.toContain("idx_pageviews_path_created");
    expect(pageviewIndexes).not.toContain("idx_pageviews_country_created");

    // Initial deployment seed record
    const deployment = db
      .query("SELECT * FROM system_deployments WHERE id = 1;")
      .get() as any;
    expect(deployment).toBeDefined();
    expect(deployment.worker_name).toBe("personal-website");
    expect(deployment.status).toBe("active");

    // 2. Execute deterministic reset.sql and ensure clean re-creation
    db.run(resetSql);
    const postResetCount = db
      .query("SELECT count(*) as count FROM system_deployments;")
      .get() as any;
    expect(postResetCount.count).toBe(1);

    db.close();
  });

  it("keeps 0001 immutable while 0001+0011 matches fresh and reset aggregate columns", () => {
    const initialMigration = fs.readFileSync(
      path.join(ROOT_DIR, "cloudflare/d1/migrations/0001_initial_schema.sql"),
      "utf8",
    );
    const aggregateMigration = fs.readFileSync(
      path.join(
        ROOT_DIR,
        "cloudflare/d1/migrations/0011_aggregate_device_os.sql",
      ),
      "utf8",
    );
    const schemaSql = fs.readFileSync(
      path.join(ROOT_DIR, "cloudflare/d1/schema.sql"),
      "utf8",
    );
    const resetSql = fs.readFileSync(
      path.join(ROOT_DIR, "cloudflare/d1/reset.sql"),
      "utf8",
    );

    expect(initialMigration.length).toBeGreaterThan(1000);
    expect(schemaSql.length).toBeGreaterThan(1000);

    const aggregateNames = [
      "device_desktop",
      "device_mobile",
      "os_windows",
      "os_macos",
      "os_ios",
      "os_android",
      "os_linux",
      "os_other",
    ];
    const columns = (sql: string) => {
      const db = new Database(":memory:");
      try {
        db.exec(sql);
        const info = db.query("PRAGMA table_info(analytics_rollups)").all() as {
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
        }[];
        return aggregateNames.map((name) => {
          const column = info.find((entry) => entry.name === name);
          expect(column).toBeDefined();
          return {
            name: column?.name,
            type: column?.type,
            notnull: column?.notnull,
            dflt_value: column?.dflt_value,
          };
        });
      } finally {
        db.close();
      }
    };
    const expected = aggregateNames.map((name) => ({
      name,
      type: "INTEGER",
      notnull: 1,
      dflt_value: "0",
    }));
    expect(columns(initialMigration + "\n" + aggregateMigration)).toEqual(
      expected,
    );
    expect(columns(schemaSql)).toEqual(expected);
    expect(columns(resetSql)).toEqual(expected);
  });
});

describe("SPEC-012: Configurable Edge Quota Engine (Free Tier to Paid Plan Migration)", () => {
  it("resolves default Free Tier budgets and ratios when unconfigured", () => {
    const cfg = resolveQuotaConfig();
    expect(cfg.planTier).toBe("free");
    expect(cfg.dailyWriteBudget).toBe(100_000);
    expect(cfg.dailyReadBudget).toBe(5_000_000);
    expect(cfg.workersDailyBudget).toBe(100_000);
    expect(cfg.conservativeRatio).toBe(0.5);
    expect(cfg.compactRatio).toBe(0.7);
    expect(cfg.survivalRatio).toBe(0.85);
    expect(cfg.walRatio).toBe(0.95);
    expect(cfg.prefetchSampleRate).toBe(0.1);
  });

  it("dynamically shifts to Paid Tier limits via CLOUDFLARE_PLAN_TIER without code changes", () => {
    const paidCfg = resolveQuotaConfig({
      CLOUDFLARE_PLAN_TIER: "paid",
    });
    expect(paidCfg.planTier).toBe("paid");
    expect(paidCfg.dailyWriteBudget).toBe(50_000_000);
    expect(paidCfg.dailyReadBudget).toBe(250_000_000);
    expect(paidCfg.workersDailyBudget).toBe(10_000_000);
    expect(paidCfg.prefetchSampleRate).toBe(1.0);
  });

  it("accepts custom environment variable overrides for custom quotas", () => {
    const customCfg = resolveQuotaConfig({
      CLOUDFLARE_PLAN_TIER: "free",
      D1_DAILY_WRITE_BUDGET: "250000",
      D1_DAILY_READ_BUDGET: "10000000",
      D1_TIER_CONSERVATIVE_RATIO: "0.40",
      D1_TIER_WAL_RATIO: "0.98",
      D1_PREFETCH_SAMPLE_RATE: "0.25",
    });

    expect(customCfg.dailyWriteBudget).toBe(250_000);
    expect(customCfg.dailyReadBudget).toBe(10_000_000);
    expect(customCfg.conservativeRatio).toBe(0.4);
    expect(customCfg.walRatio).toBe(0.98);
    expect(customCfg.prefetchSampleRate).toBe(0.25);
  });

  it("calculates degradation tiers based on active configuration", () => {
    const freeCfg = resolveQuotaConfig({ CLOUDFLARE_PLAN_TIER: "free" });

    // Under 50%
    expect(resolveDegradationTier(40_000, 1_000_000, false, freeCfg)).toBe(
      QuotaDegradationTier.NOMINAL,
    );
    // 50% - 70%
    expect(resolveDegradationTier(60_000, 1_000_000, false, freeCfg)).toBe(
      QuotaDegradationTier.CONSERVATIVE,
    );
    // 70% - 85%
    expect(resolveDegradationTier(75_000, 1_000_000, false, freeCfg)).toBe(
      QuotaDegradationTier.COMPACT_ROLLUP,
    );
    // 85% - 95%
    expect(resolveDegradationTier(90_000, 1_000_000, false, freeCfg)).toBe(
      QuotaDegradationTier.CRITICAL_SURVIVAL,
    );
    // >= 95% or hard blocked
    expect(resolveDegradationTier(96_000, 1_000_000, false, freeCfg)).toBe(
      QuotaDegradationTier.R2_WAL_FALLBACK,
    );
    expect(resolveDegradationTier(10_000, 100_000, true, freeCfg)).toBe(
      QuotaDegradationTier.R2_WAL_FALLBACK,
    );
  });
});

describe("SPEC-012: Build-Time Content Integrity Gate (TASK SEO-1)", () => {
  it("verifies that all production collections and locales are hydrated", async () => {
    const res = await verifyContentHydration();
    expect(res.valid).toBe(true);
    expect(res.missing.length).toBe(0);
    expect(res.counts.posts.en).toBeGreaterThanOrEqual(1);
    expect(res.counts.posts.es).toBeGreaterThanOrEqual(1);
    expect(res.counts.projects.en).toBeGreaterThanOrEqual(1);
    expect(res.counts.projects.es).toBeGreaterThanOrEqual(1);
    expect(res.counts.experience.en).toBeGreaterThanOrEqual(1);
    expect(res.counts.experience.es).toBeGreaterThanOrEqual(1);
    expect(res.counts.services.en).toBeGreaterThanOrEqual(1);
    expect(res.counts.services.es).toBeGreaterThanOrEqual(1);
    expect(res.counts.resume.en).toBeGreaterThanOrEqual(1);
    expect(res.counts.resume.es).toBeGreaterThanOrEqual(1);
  });

  it("throws a descriptive fatal Error when required collections are missing and allowEmpty is false", async () => {
    const tempEmptyDir = path.join(ROOT_DIR, "tmp-test-empty-content");
    fs.mkdirSync(tempEmptyDir, { recursive: true });

    let thrownError: Error | null = null;
    try {
      await verifyContentHydration({
        contentRoot: tempEmptyDir,
        allowEmpty: false,
      });
    } catch (err: any) {
      thrownError = err;
    } finally {
      fs.rmSync(tempEmptyDir, { recursive: true, force: true });
    }

    expect(thrownError).toBeDefined();
    expect(thrownError?.message).toContain("[ContentHydrationError]");
  });
});

describe("SPEC-012: Unified @graph Knowledge Graph & Schema.org Rich Entities (TASK SEO-2)", () => {
  it("generates connected @graph with #person, #website, #webpage, and #breadcrumb on Person schema", () => {
    const personLd = buildPersonJsonLd({
      locale: "en",
      canonicalUrl: "https://arturonavax.dev/",
      jobTitle: "Senior Software / AI Engineer",
      description: "Distributed Systems and Security Architect",
    });

    expect(personLd["@context"]).toBe("https://schema.org");
    expect(personLd["@id"]).toBe(PERSON_ENTITY_ID);
    expect(personLd["inLanguage"]).toBe("en");

    const graph = personLd["@graph"] as Array<Record<string, unknown>>;
    expect(Array.isArray(graph)).toBe(true);

    const personNode = graph.find((n) => n["@id"] === PERSON_ENTITY_ID);
    const websiteNode = graph.find((n) => n["@id"] === WEBSITE_ENTITY_ID);
    const webpageNode = graph.find(
      (n) => n["@id"] === "https://arturonavax.dev/#webpage",
    );
    const breadcrumbNode = graph.find(
      (n) => n["@id"] === "https://arturonavax.dev/#breadcrumb",
    );

    expect(personNode).toBeDefined();
    expect(personNode?.name).toBe("Arturo Nava");
    expect(personNode?.worksFor).toEqual({
      "@type": "Organization",
      name: "LATAM Airlines",
      url: "https://www.latamairlines.com",
    });

    expect(websiteNode).toBeDefined();
    expect(websiteNode?.publisher).toEqual({ "@id": PERSON_ENTITY_ID });

    expect(webpageNode).toBeDefined();
    expect(webpageNode?.isPartOf).toEqual({ "@id": WEBSITE_ENTITY_ID });
    expect(webpageNode?.about).toEqual({ "@id": PERSON_ENTITY_ID });

    expect(breadcrumbNode).toBeDefined();
    expect(breadcrumbNode?.["@type"]).toBe("BreadcrumbList");
  });

  it("generates TechArticle + BlogPosting with speakable and metrics for Articles", () => {
    const articleLd = buildArticleJsonLd({
      locale: "en",
      canonicalUrl: "https://arturonavax.dev/blog/sub-50ms-fraud-engine-go/",
      headline: "Designing Sub-50ms Fraud Detection in Go",
      description: "Low-latency zero-allocation rule evaluation.",
      publishedAt: "2026-02-15T00:00:00Z",
      bodyText: "Sample text with multiple words for reading calculation...",
      tags: ["Go", "Distributed Systems"],
    });

    expect(articleLd["@type"]).toBe("TechArticle");
    expect(articleLd["headline"]).toBe(
      "Designing Sub-50ms Fraud Detection in Go",
    );
    expect(articleLd["wordCount"]).toBeGreaterThan(0);
    expect(articleLd["timeRequired"]).toMatch(/^PT\d+M$/);
    expect(articleLd["speakable"]).toEqual({
      "@type": "SpeakableSpecification",
      cssSelector: ["h1", "article > p:first-of-type"],
    });

    const graph = articleLd["@graph"] as Array<Record<string, unknown>>;
    const articleNode = graph.find(
      (n) =>
        n["@type"] &&
        Array.isArray(n["@type"]) &&
        n["@type"].includes("TechArticle"),
    );
    expect(articleNode).toBeDefined();
    expect(articleNode?.author).toEqual({
      "@type": "Person",
      "@id": PERSON_ENTITY_ID,
      name: "Arturo Nava",
      url: "https://arturonavax.dev/",
    });
  });

  it("generates SoftwareSourceCode + SoftwareApplication for Projects", () => {
    const projectLd = buildProjectJsonLd({
      locale: "en",
      canonicalUrl: "https://arturonavax.dev/projects/fyld/",
      title: "FYLD: Cryptographic Data Witnessing",
      description: "Enterprise UTXO data anchoring.",
      techStack: ["Go", "gRPC", "Bitcoin", "SIMD"],
      repoUrl: "https://github.com/arturonavax/fyld",
    });

    expect(projectLd["@type"]).toBe("SoftwareSourceCode");
    const graph = projectLd["@graph"] as Array<Record<string, unknown>>;
    const softwareNode = graph.find(
      (n) => n["@id"] === "https://arturonavax.dev/projects/fyld/#software",
    );
    expect(softwareNode).toBeDefined();
    expect(softwareNode?.programmingLanguage).toContain("Go");
    expect(softwareNode?.runtimePlatform).toBe(
      "Cloudflare Edge / Linux Containers",
    );
  });

  it("generates Service + ProfessionalService for Services", () => {
    const serviceLd = buildServiceJsonLd({
      locale: "en",
      canonicalUrl:
        "https://arturonavax.dev/services/backend-performance-audit/",
      title: "Backend Performance Audit",
      description: "In-depth diagnostic of backend services.",
      serviceType: "Technical Advisory",
    });

    expect(serviceLd["@type"]).toBe("Service");
    const graph = serviceLd["@graph"] as Array<Record<string, unknown>>;
    const serviceNode = graph.find(
      (n) =>
        n["@id"] ===
        "https://arturonavax.dev/services/backend-performance-audit/#service",
    );
    expect(serviceNode).toBeDefined();
    expect(serviceNode?.provider).toEqual({
      "@type": "Person",
      "@id": PERSON_ENTITY_ID,
      name: "Arturo Nava",
      url: "https://arturonavax.dev/",
    });
    expect(serviceNode?.areaServed).toBe("Worldwide");
  });

  it("generates ProfilePage for Resume", () => {
    const resumeLd = buildResumeJsonLd({
      locale: "en",
      canonicalUrl: "https://arturonavax.dev/resume/",
      title: "Arturo Nava - Resume",
      description: "Senior Software Engineer Resume",
    });

    expect(resumeLd["@type"]).toBe("ProfilePage");
    expect(resumeLd["@id"]).toBe("https://arturonavax.dev/resume/#webpage");
    expect(resumeLd["@id"]).not.toBe(PERSON_ENTITY_ID);
    expect(resumeLd["mainEntity"]).toEqual({ "@id": PERSON_ENTITY_ID });
    expect(resumeLd["hasOccupation"]).toBeDefined();
  });

  it("ensures ensureUnifiedGraphJsonLd injects connected @graph on raw inputs", () => {
    const unified = ensureUnifiedGraphJsonLd(undefined, {
      locale: "en",
      canonicalUrl: "https://arturonavax.dev/test/",
      title: "Test Page",
      description: "Test Description",
    });

    const graph = unified["@graph"] as Array<Record<string, unknown>>;
    expect(graph.length).toBe(4);
    expect(graph.some((n) => n["@id"] === PERSON_ENTITY_ID)).toBe(true);
    expect(graph.some((n) => n["@id"] === WEBSITE_ENTITY_ID)).toBe(true);
  });
});

describe("SPEC-012: Verified Multilingual Hreflang & Clean Canonicals (TASK SEO-3)", () => {
  it("strictly suppresses missing locale hreflang tags when availableLocales is provided", () => {
    const res = resolveVerifiedHreflang({
      locale: "en",
      canonicalUrl: "https://arturonavax.dev/blog/english-only-post/",
      alternateEsUrl: "/es/blog/english-only-post/",
      availableLocales: ["en"], // Only exists in EN
    });

    expect(res.enUrl).toBe("https://arturonavax.dev/blog/english-only-post/");
    expect(res.esUrl).toBeUndefined();
    expect(res.xDefaultUrl).toBe(
      "https://arturonavax.dev/blog/english-only-post/",
    );

    const hreflangs = res.links.map((l) => l.hreflang);
    expect(hreflangs).toContain("en");
    expect(hreflangs).toContain("x-default");
    expect(hreflangs).not.toContain("es"); // Zero 404 hreflangs
  });

  it("emits bidirectional hreflangs when both locales exist", () => {
    const res = resolveVerifiedHreflang({
      locale: "es",
      canonicalUrl: "https://arturonavax.dev/es/projects/fyld/",
      alternateEnUrl: "/projects/fyld/",
      availableLocales: ["en", "es"],
    });

    expect(res.esUrl).toBe("https://arturonavax.dev/es/projects/fyld/");
    expect(res.enUrl).toBe("https://arturonavax.dev/projects/fyld/");
    expect(res.xDefaultUrl).toBe("https://arturonavax.dev/projects/fyld/");

    const hreflangs = res.links.map((l) => l.hreflang);
    expect(hreflangs).toContain("en");
    expect(hreflangs).toContain("es");
    expect(hreflangs).toContain("x-default");
  });

  it("sanitizes canonical URLs by stripping tracking parameters and standardizing trailing slash", () => {
    const clean = sanitizeCanonicalUrl(
      "https://arturonavax.dev/projects/fyld?utm_source=twitter&utm_medium=social&ref=ai-engine#heading",
    );
    expect(clean).toBe("https://arturonavax.dev/projects/fyld/#heading");
  });
});

describe("SPEC-012: Edge AEO, AI Content Negotiation & Automated IndexNow (TASK SEO-4 & SEO-5)", () => {
  it("notifies IndexNow with mapped canonical URLs on content changes", async () => {
    let capturedPayload: any = null;
    const mockFetch = async (_url: string, init: any) => {
      capturedPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const changed = [
      "src/content/posts/en/sub-50ms-fraud-engine-go.md",
      "src/content/projects/en/fyld.md",
      "src/content/services/en/backend-performance-audit.md",
      "src/content/experience/en/latam.md",
      "src/content/resume/ArturoNava-Resume-en.md",
    ];

    const res = await notifyIndexNow(changed, {
      key: "test-indexnow-key-12345",
      host: "arturonavax.dev",
      fetchFn: mockFetch as any,
    });

    expect(res.ok).toBe(true);
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.host).toBe("arturonavax.dev");
    expect(capturedPayload.key).toBe("test-indexnow-key-12345");
    expect(capturedPayload.keyLocation).toBe(
      "https://arturonavax.dev/indexnow-key.txt",
    );

    const urls = capturedPayload.urlList;
    expect(urls).toContain("https://arturonavax.dev/");
    expect(urls).toContain("https://arturonavax.dev/es/");
    expect(urls).toContain(
      "https://arturonavax.dev/blog/sub-50ms-fraud-engine-go/",
    );
    expect(urls).toContain("https://arturonavax.dev/projects/fyld/");
    expect(urls).toContain(
      "https://arturonavax.dev/services/backend-performance-audit/",
    );
    expect(urls).toContain("https://arturonavax.dev/experience/latam/");
    expect(urls).toContain("https://arturonavax.dev/resume/");

    // Verify skipping when key is the placeholder hash
    const skippedRes = await notifyIndexNow(changed, {
      key: "e3b0c44298fc1c149afbf4c8996fb924",
      host: "arturonavax.dev",
      fetchFn: mockFetch as any,
    });
    expect(skippedRes.ok).toBe(false);
    expect((skippedRes as any).skipped).toBe(true);
  });

  it("verifies public/_headers contains required AEO headers, Vary: Accept and security invariants", () => {
    const headers = fs.readFileSync(
      path.join(ROOT_DIR, "public/_headers"),
      "utf8",
    );

    expect(headers).toContain("X-Robots-Tag: noindex, nofollow");
    expect(headers).toContain("X-Robots-Tag: noindex, nofollow, noarchive");
    expect(headers).toContain("Vary: Accept");
    expect(headers).toContain(
      'Link: <https://arturonavax.dev/llms.txt>; rel="llms-txt"',
    );
    expect(headers).toContain(
      '<https://arturonavax.dev/llms-full.txt>; rel="alternate"',
    );
  });

  it("serves dynamic IndexNow key at /indexnow-key.txt and emits Vary: Accept on Markdown content negotiation", async () => {
    const workerModule = await import("../../cloudflare/worker");
    const worker = workerModule.default;

    const mockEnv = {
      INDEXNOW_KEY: "prod-dynamic-indexnow-secret-999",
      ASSETS: {
        fetch: async () =>
          new Response(
            "<!doctype html><html><body><h1>Blog Post</h1></body></html>",
            {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          ),
      } as unknown as Fetcher,
    };

    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    // Test dynamic indexnow-key.txt
    const keyReq = new Request("https://arturonavax.dev/indexnow-key.txt");
    const keyRes = await worker.fetch(keyReq, mockEnv, mockCtx);
    expect(keyRes.status).toBe(200);
    expect(await keyRes.text()).toBe("prod-dynamic-indexnow-secret-999");
    expect(keyRes.headers.get("Content-Type")).toContain("text/plain");
    expect(keyRes.headers.get("Cache-Control")).toContain("max-age=86400");

    // Test Vary: Accept on HTML response
    const htmlReq = new Request("https://arturonavax.dev/blog/test/", {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
    });
    const htmlRes = await worker.fetch(htmlReq, mockEnv, mockCtx);
    expect(htmlRes.headers.get("Vary")).toContain("Accept");
  });

  it("verifies public/robots.txt explicitly welcomes leading AI crawlers and disallows internal query paths", () => {
    const robots = fs.readFileSync(
      path.join(ROOT_DIR, "public/robots.txt"),
      "utf8",
    );

    expect(robots).toContain("User-agent: Googlebot");
    expect(robots).toContain("User-agent: Bingbot");
    expect(robots).toContain("User-agent: GPTBot");
    expect(robots).toContain("User-agent: OAI-SearchBot");
    expect(robots).toContain("User-agent: ChatGPT-User");
    expect(robots).toContain("User-agent: ClaudeBot");
    expect(robots).toContain("User-agent: PerplexityBot");
    expect(robots).toContain("User-agent: Applebot-Extended");
    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Disallow: /search?");
    expect(robots).toContain(
      "Sitemap: https://arturonavax.dev/sitemap-index.xml",
    );
  });
});

describe("TASK 5: Zero-Trust Admin & Selective Asset Bypass Security Invariants", () => {
  it("1. wrangler.jsonc sets workers_dev to false and configures selective run_worker_first glob array", async () => {
    const wranglerRaw = fs.readFileSync(
      path.join(ROOT_DIR, "wrangler.jsonc"),
      "utf8",
    );
    const cleaned = wranglerRaw
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")
      .replace(/,(\s*[}\]])/g, "$1");
    const wrangler = JSON.parse(cleaned);

    expect(wrangler.workers_dev).toBe(false);
    expect(wrangler.main).toBe("./cloudflare/entrypoint.ts");
    const entrypointModule = await import("../../cloudflare/entrypoint");
    expect(typeof entrypointModule.default?.fetch).toBe("function");
    const namedExports = Object.keys(entrypointModule).filter(
      (k) => k !== "default",
    );
    expect(namedExports).toHaveLength(0);
    expect(Array.isArray(wrangler.assets.run_worker_first)).toBe(true);
    expect(wrangler.assets.run_worker_first).toContain("/*");
    expect(wrangler.assets.run_worker_first).toContain("!/_astro/*");
    expect(wrangler.assets.run_worker_first).toContain("!/fonts/*");
  });

  it("2. Unauthenticated requests to /admin, /es/admin, /en/admin, /ADMIN, /es//admin, /%61dmin, https://admin.arturonavax.dev/, and /__admin_vault__/default/index.html all return 401, 403, or 404 and never invoke env.ASSETS.fetch for the admin HTML shell", async () => {
    const workerModule = await import("../../cloudflare/worker");
    const worker = workerModule.default;

    let assetsFetchCalledForAdmin = false;
    const mockEnv = {
      ASSETS: {
        fetch: async (req: Request | string) => {
          const u = typeof req === "string" ? req : req.url;
          if (u.includes("admin") || u.includes("__admin_vault__")) {
            assetsFetchCalledForAdmin = true;
          }
          return new Response("Not Found", { status: 404 });
        },
      } as unknown as Fetcher,
    };

    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    const testUrls = [
      "https://arturonavax.dev/admin",
      "https://arturonavax.dev/es/admin",
      "https://arturonavax.dev/en/admin",
      "https://arturonavax.dev/ADMIN",
      "https://arturonavax.dev/es//admin",
      "https://arturonavax.dev/%61dmin",
      "https://admin.arturonavax.dev/",
      "https://arturonavax.dev/__admin_vault__/default/index.html",
    ];

    for (const testUrl of testUrls) {
      assetsFetchCalledForAdmin = false;
      const req = new Request(testUrl, {
        headers: { Accept: "text/html" },
      });
      const res = await worker.fetch(req, mockEnv as any, mockCtx);
      expect([401, 403, 404]).toContain(res.status);
      expect(assetsFetchCalledForAdmin).toBe(false);
    }
  });

  it("3. Unauthenticated requests to protected admin APIs return 401 or 403 with Cache-Control: private, no-store", async () => {
    const workerModule = await import("../../cloudflare/worker");
    const worker = workerModule.default;

    const mockEnv = {
      ASSETS: {
        fetch: async () => new Response("Not Found", { status: 404 }),
      } as unknown as Fetcher,
    };

    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    const apiUrls = [
      "https://arturonavax.dev/api/admin/metrics",
      "https://arturonavax.dev/api/telemetry/summary",
      "https://arturonavax.dev/api/telemetry",
      "https://arturonavax.dev/api/metrics",
      "https://arturonavax.dev/api/leads",
      "https://arturonavax.dev/api/deployments",
    ];

    for (const apiUrl of apiUrls) {
      const req = new Request(apiUrl);
      const res = await worker.fetch(req, mockEnv as any, mockCtx);
      expect([401, 403]).toContain(res.status);
      const cacheControl = res.headers.get("Cache-Control") || "";
      expect(cacheControl).toContain("private");
      expect(cacheControl).toContain("no-store");
    }
  });

  it("4. Authenticated requests to /admin and /es/admin succeed (200 OK) and serve the isolated admin shell with Cache-Control: private, no-store", async () => {
    const workerModule = await import("../../cloudflare/worker");
    const worker = workerModule.default;

    const token = "super-secret-admin-token-min-32-chars-long";
    const mockEnv = {
      ADMIN_ACCESS_TOKEN: token,
      ASSETS: {
        fetch: async (req: Request | string) => {
          const u = typeof req === "string" ? req : req.url;
          if (u.includes("__admin_vault__") || u.includes("admin")) {
            return new Response(
              "<html><head><title>Admin Vault Shell</title></head><body><h1>Vault Dashboard</h1></body></html>",
              {
                status: 200,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              },
            );
          }
          return new Response("Not Found", { status: 404 });
        },
      } as unknown as Fetcher,
    };

    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    for (const adminUrl of [
      "https://arturonavax.dev/admin",
      "https://arturonavax.dev/es/admin",
    ]) {
      const req = new Request(adminUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/html",
        },
      });
      const res = await worker.fetch(req, mockEnv as any, mockCtx);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Vault Dashboard");
      const cacheControl = res.headers.get("Cache-Control") || "";
      expect(cacheControl).toContain("private");
      expect(cacheControl).toContain("no-store");
    }
  });
});
