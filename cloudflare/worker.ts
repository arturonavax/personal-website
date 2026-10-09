/// <reference types="@cloudflare/workers-types" />

import { handleAnalyticsRollup } from "./cron-scheduler";
import {
  processIncomingEmail,
  type ForwardableEmailMessage,
} from "./email-worker";
import {
  createSearchAdapter,
  createCaptchaAdapter,
  createStorageAdapter,
  CloudflareEdgeRoutingPolicy,
  FailOpenCircuitBreaker,
  PrefetchQuotaCircuitBreaker,
  StaticMemorySearchAdapter,
  DeploymentRegistry,
} from "../src/lib/adapters";
import type { SearchResultItem } from "../src/lib/ports/search.port";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  STORAGE_BUCKET?: R2Bucket;
  VECTORIZE_INDEX?: any;
  AI?: any;
  TURNSTILE_SECRET_KEY?: string;
  DISCORD_WEBHOOK_URL?: string;
  SLACK_WEBHOOK_URL?: string;
  APP_STORAGE_DRIVER?: string;
  APP_SEARCH_DRIVER?: string;
  APP_TELEMETRY_DRIVER?: string;
  APP_CAPTCHA_DRIVER?: string;
  ENABLE_PREFETCH_TELEMETRY?: string | boolean;
  D1_DAILY_WRITE_BUDGET?: string | number;
}

const STATIC_EXT_REGEX =
  /\.(?:css|js|mjs|map|json|png|jpg|jpeg|webp|avif|svg|ico|gif|woff|woff2|ttf|eot|xml|txt|pdf|webmanifest)$/i;

const BOT_REGEX =
  /bot|spider|crawl|slurp|semrush|ahrefs|yandex|bytespider|gptbot|claudebot|perplexity|anthropic|cohere|applebot/i;

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
];

const routingPolicy = new CloudflareEdgeRoutingPolicy();
const circuitBreaker = new FailOpenCircuitBreaker();
export const prefetchCircuitBreaker = new PrefetchQuotaCircuitBreaker();

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    const pathname = url.pathname;

    // -------------------------------------------------------------------------
    // 1. FAST-PATH: Subdomain Canonicalization & Apex Admin Surface Redirect (REQ-PCD-02, REQ-PCD-03)
    // -------------------------------------------------------------------------
    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (isLocal && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
      return handleAdminDashboardRequest(request, env, ctx);
    }

    const redirect = routingPolicy.resolveCanonicalRedirect(url);
    if (redirect.shouldRedirect && redirect.targetUrl) {
      return Response.redirect(redirect.targetUrl, redirect.statusCode);
    }

    // Isolated Admin Surface on Dedicated Subdomain (Cloudflare Access Zero Trust)
    if (host === "admin.arturonavax.dev" || host === "dash.arturonavax.dev") {
      return handleAdminDashboardRequest(request, env, ctx);
    }

    // -------------------------------------------------------------------------
    // 2. FAST-PATH: Immutable Static Assets & Typography (REQ-PCD-01, REQ-PCD-06)
    // -------------------------------------------------------------------------
    const isImmutableAsset =
      pathname.startsWith("/_astro/") || pathname.startsWith("/fonts/");

    if (isImmutableAsset) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      if (pathname.startsWith("/fonts/")) {
        headers.set("Access-Control-Allow-Origin", "*");
      }
      headers.set("X-Content-Type-Options", "nosniff");
      const body =
        response.status === 304 || response.status === 204
          ? null
          : response.body;
      return new Response(body, { status: response.status, headers });
    }

    // -------------------------------------------------------------------------
    // 3. Speculative Prefetch Detection (Bypass Telemetry)
    // -------------------------------------------------------------------------
    const secPurpose = request.headers.get("sec-purpose") || "";
    const purpose = request.headers.get("purpose") || "";
    const isPrefetch =
      purpose === "prefetch" ||
      secPurpose.includes("prefetch") ||
      secPurpose.includes("prerender") ||
      request.headers.get("x-astro-prefetch") !== null ||
      request.headers.get("X-Astro-Prefetch") !== null;

    // -------------------------------------------------------------------------
    // 4. Dedicated API Endpoints (Search, Captcha, Ingestion, Storage)
    // -------------------------------------------------------------------------
    if (pathname === "/api/search") {
      return handleSemanticSearch(request, env, ctx, url);
    }

    if (pathname === "/api/verify-captcha" && request.method === "POST") {
      return handleCaptchaVerification(request, env, ctx);
    }

    if (pathname === "/api/v1/telemetry" && request.method === "POST") {
      return handleTelemetryIngestion(request, env, ctx, isPrefetch);
    }

    if (pathname.startsWith("/cdn-assets/") && env.STORAGE_BUCKET) {
      return handleCdnStorageAsset(request, env, ctx, url);
    }

    if (pathname === "/api/status" || pathname === "/api/deployment") {
      const registry = new DeploymentRegistry(env.DB);
      const activeDeployment = await registry.getActiveDeployment();
      return new Response(
        JSON.stringify({
          status: "healthy",
          environment: "production",
          timestamp: new Date().toISOString(),
          deployment: activeDeployment,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, private",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }

    // -------------------------------------------------------------------------
    // 5. FAST-PATH: Public Document Delivery & Non-Blocking Telemetry (REQ-PCD-01, REQ-PCD-04)
    // -------------------------------------------------------------------------
    // Start asset fetching immediately with zero pre-fetch compute overhead
    const assetResponsePromise = env.ASSETS.fetch(request);

    // Asynchronous decoupled telemetry in background via ctx.waitUntil
    if (request.method === "GET" && env.DB) {
      const isStatic = STATIC_EXT_REGEX.test(pathname);
      const acceptHeader = request.headers.get("accept") || "";
      const isHtml = acceptHeader.includes("text/html");
      const secFetchDest = request.headers.get("sec-fetch-dest");
      const isDocumentNavigation = !secFetchDest || secFetchDest === "document";

      if (
        !isStatic &&
        (isHtml || isDocumentNavigation || !pathname.includes("."))
      ) {
        if (isPrefetch) {
          // Secondary Priority (P1): Prefetch telemetry protected by dynamic circuit breaker
          if (
            prefetchCircuitBreaker.canRecordPrefetch(
              env as unknown as Record<string, unknown>,
            )
          ) {
            prefetchCircuitBreaker.recordPrefetch();
            const purposeHeader = (
              purpose ||
              secPurpose ||
              "astro-prefetch"
            ).slice(0, 50);
            ctx.waitUntil(
              recordPrefetchAnalyticsNonBlocking(
                request,
                pathname,
                env.DB,
                purposeHeader,
              ),
            );
          } else {
            // Circuit Breaker tripped or kill-switch: log incident once per date in background
            const today = new Date().toISOString().slice(0, 10);
            if (prefetchCircuitBreaker.shouldLogIncident(today)) {
              prefetchCircuitBreaker.markIncidentLogged(today);
              const tripReason = prefetchCircuitBreaker.getTripReason();
              ctx.waitUntil(
                recordCircuitBreakerIncident(
                  env.DB,
                  "prefetch_telemetry",
                  today,
                  tripReason,
                ),
              );
            }
          }
        } else {
          // Primary Priority (P0): Real human pageview (100% server-side, anti-adblocker)
          if (
            !prefetchCircuitBreaker.canRecordVisit ||
            prefetchCircuitBreaker.canRecordVisit(
              env as unknown as Record<string, unknown>,
            )
          ) {
            prefetchCircuitBreaker.recordVisit();
            ctx.waitUntil(
              recordAnalyticsNonBlocking(request, pathname, env.DB),
            );
          }
        }
      }
    }

    const response = await assetResponsePromise;

    // Apply deterministic RFC 9111 cache & edge security directives based on asset type
    const headers = new Headers(response.headers);
    let shouldWrapResponse = false;

    if (pathname.endsWith(".pdf")) {
      headers.set(
        "Cache-Control",
        "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      );
      shouldWrapResponse = true;
    } else if (/\.(?:png|jpg|jpeg|webp|avif|svg|ico)$/i.test(pathname)) {
      headers.set(
        "Cache-Control",
        "public, max-age=604800, stale-while-revalidate=86400",
      );
      headers.set("X-Content-Type-Options", "nosniff");
      shouldWrapResponse = true;
    } else if (pathname.startsWith("/search-index")) {
      headers.set(
        "Cache-Control",
        "public, max-age=3600, stale-while-revalidate=86400",
      );
      headers.set("Access-Control-Allow-Origin", "*");
      shouldWrapResponse = true;
    } else if (
      pathname.endsWith("sitemap-index.xml") ||
      pathname.endsWith("sitemap-0.xml") ||
      pathname === "/rss.xml" ||
      pathname === "/robots.txt" ||
      pathname.startsWith("/llms")
    ) {
      headers.set("Cache-Control", "public, max-age=3600, must-revalidate");
      shouldWrapResponse = true;
    } else {
      const contentType = headers.get("content-type") || "";
      if (
        contentType.includes("text/html") ||
        pathname.endsWith("/") ||
        !pathname.includes(".")
      ) {
        if (!headers.has("Cache-Control")) {
          headers.set("Cache-Control", "public, max-age=0, must-revalidate");
        }
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("X-Frame-Options", "DENY");
        headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        headers.set(
          "Strict-Transport-Security",
          "max-age=63072000; includeSubDomains; preload",
        );
        headers.set("Alt-Svc", 'h3=":443"; ma=86400');
        shouldWrapResponse = true;
      }
    }

    if (shouldWrapResponse) {
      const body =
        response.status === 304 || response.status === 204
          ? null
          : response.body;
      return new Response(body, { status: response.status, headers });
    }

    return response;
  },

  // Cron Trigger Engine for Daily Analytics Rollups (SPEC-003 Section 2.3.2)
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(handleAnalyticsRollup(env));
  },

  // Serverless Corporate Email Ingestion (SPEC-003 Section 2.4)
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    await processIncomingEmail(message, env, ctx);
  },
};

/**
 * Generic Edge Cache Wrapper with Stale-While-Revalidate & Cache-Tag (SPEC-010 Subsystem B.1)
 */
export async function handleCachedGet(
  request: Request,
  computeFn: () => Promise<Response>,
  cacheTags: string[],
  ctx?: ExecutionContext,
): Promise<Response> {
  const cache =
    typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheUrl = new URL(request.url);
  const cacheKey = new Request(cacheUrl.toString(), {
    method: "GET",
    headers: request.headers,
  });

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // Fail-open on cache lookup error
    }
  }

  const computedResponse = await computeFn();

  const headers = new Headers(computedResponse.headers);
  headers.set(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
  );
  if (cacheTags.length > 0) {
    headers.set("Cache-Tag", cacheTags.join(","));
  }

  const responseToCache = new Response(computedResponse.body, {
    status: computedResponse.status,
    headers,
  });

  if (cache && ctx && computedResponse.status === 200) {
    try {
      ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
    } catch {
      // Fail-open on cache storage error
    }
  }

  return responseToCache;
}

/**
 * Semantic Search Handler with Fail-Open Circuit Breaker & L1/L2 Edge Cache (REQ-PCD-05, SPEC-010)
 */
async function handleSemanticSearch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const cleanUrl = new URL(request.url);
  for (const param of TRACKING_PARAMS) {
    cleanUrl.searchParams.delete(param);
  }

  const q = cleanUrl.searchParams.get("q") || "";
  const locale = cleanUrl.searchParams.get("locale") || "en";
  const limit = Number(cleanUrl.searchParams.get("limit") || 8);
  const threshold = cleanUrl.searchParams.get("threshold")
    ? Number(cleanUrl.searchParams.get("threshold"))
    : undefined;

  if (!q.trim()) {
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
        "Cache-Tag": "search,search-empty",
      },
    });
  }

  return handleCachedGet(
    request,
    async () => {
      let results: SearchResultItem[] = [];

      try {
        results = await circuitBreaker.executeWithFallback(
          async () => {
            const searchAdapter = createSearchAdapter({
              env: {
                APP_SEARCH_DRIVER: env.APP_SEARCH_DRIVER,
                AI: env.AI,
                VECTORIZE_INDEX: env.VECTORIZE_INDEX,
              },
              executionCtx: ctx,
            });

            return await searchAdapter.search({
              query: q,
              locale,
              limit,
              threshold,
            });
          },
          () =>
            new StaticMemorySearchAdapter().search({
              query: q,
              locale,
              limit,
              threshold,
            }),
          350,
          "semantic-search",
        );
      } catch {
        results = await new StaticMemorySearchAdapter().search({
          query: q,
          locale,
          limit,
          threshold,
        });
      }

      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    },
    ["search", `search-${locale}`, "search-semantic"],
    ctx,
  );
}

/**
 * Captcha Verification with Fail-Open Circuit Breaker (REQ-PCD-05)
 */
async function handleCaptchaVerification(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  try {
    const body = (await request.json()) as { token?: string };
    const clientIp = request.headers.get("cf-connecting-ip") || undefined;
    const captchaAdapter = createCaptchaAdapter({
      env: {
        APP_CAPTCHA_DRIVER: env.APP_CAPTCHA_DRIVER,
        TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY,
      },
      executionCtx: ctx,
    });

    const result = await circuitBreaker.executeWithFallback(
      () =>
        captchaAdapter.verify({
          token: body.token || "",
          remoteIp: clientIp,
        }),
      { success: false, error: "Verification timeout" },
      500,
      "captcha-verify",
    );

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 403,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid request" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * Telemetry Ingestion Handler with Immediate 202 Queued Response (REQ-PCD-04)
 */
async function handleTelemetryIngestion(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  isPrefetch: boolean,
): Promise<Response> {
  if (isPrefetch) {
    return new Response(null, { status: 204 });
  }

  const userAgent = request.headers.get("user-agent") || "";
  if (BOT_REGEX.test(userAgent)) {
    return new Response(JSON.stringify({ status: "bypassed", reason: "bot" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (
    prefetchCircuitBreaker.canRecordVisit &&
    !prefetchCircuitBreaker.canRecordVisit(
      env as unknown as Record<string, unknown>,
    )
  ) {
    return new Response(
      JSON.stringify({ status: "bypassed", reason: "budget_limit" }),
      {
        status: 202,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  ctx.waitUntil(
    (async () => {
      try {
        const payload = (await request.json()) as Record<string, unknown>;
        const userAgent =
          request.headers.get("user-agent")?.slice(0, 512) || "unknown";
        const country =
          (request as unknown as { cf?: { country?: string } }).cf?.country ||
          request.headers.get("cf-ipcountry") ||
          "XX";

        const now = Date.now();
        const path = String(payload.path || "").slice(0, 255);
        const locale = String(payload.locale || "en").slice(0, 10);
        const visitorHash = String(payload.visitorHash || "").slice(0, 32);

        if (!env.DB) return;

        const telemetryPromise = env.DB.prepare(
          `INSERT INTO edge_telemetry_events (
            id, timestamp, path, locale, country, user_agent, visitor_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            crypto.randomUUID(),
            now,
            path,
            locale,
            country,
            userAgent,
            visitorHash,
          )
          .run();

        const rollupEventPromise = env.DB.prepare(
          `INSERT INTO pageview_events (path, locale, country, referrer, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(
            path,
            locale,
            country,
            String(payload.referrer || "Direct").slice(0, 255),
            now,
          )
          .run();

        await Promise.all([telemetryPromise, rollupEventPromise]);
      } catch {
        // Fail-open: Telemetry errors discarded defensively
      }
    })(),
  );

  return new Response(JSON.stringify({ status: "queued", queued: true }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * R2 Storage Asset Handler via Workers Cache API (SPEC-003, SPEC-004 REQ-EDG-03)
 */
async function handleCdnStorageAsset(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const key = url.pathname.replace(/^\/cdn-assets\//, "");
  const storageAdapter = createStorageAdapter({
    env: {
      APP_STORAGE_DRIVER: env.APP_STORAGE_DRIVER,
      STORAGE_BUCKET: env.STORAGE_BUCKET,
    },
    executionCtx: ctx,
  });

  const item = await storageAdapter.get(key);
  if (!item) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(item.data, {
    status: 200,
    headers: {
      "Content-Type": item.metadata.contentType,
      "Content-Length": String(item.metadata.sizeBytes),
      ...(item.metadata.etag ? { ETag: item.metadata.etag } : {}),
      "Cache-Control":
        "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
}

/**
 * Isolated Cloudflare Access Admin Surface Handler (REQ-PCD-02)
 */
export async function handleAdminDashboardRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/status" || url.pathname === "/api/status") {
    const registry = new DeploymentRegistry(env.DB);
    const activeDeployment = await registry.getActiveDeployment();
    return new Response(
      JSON.stringify({
        status: "healthy",
        surface: "admin-isolated",
        environment: "production",
        timestamp: new Date().toISOString(),
        deployment: activeDeployment,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, private",
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  if (url.pathname === "/api/deployments") {
    const registry = new DeploymentRegistry(env.DB);
    const deployments = await registry.listDeployments(20);
    return new Response(
      JSON.stringify({
        deployments,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, private",
        },
      },
    );
  }

  if (url.pathname === "/api/metrics") {
    let rollups: unknown[] = [];
    let incidents: unknown[] = [];
    if (env.DB) {
      try {
        const stmt = env.DB.prepare(
          "SELECT * FROM daily_analytics_rollups ORDER BY date DESC LIMIT 30",
        );
        const query =
          typeof (stmt as any).all === "function"
            ? await (stmt as any).all()
            : await stmt.bind().all();
        rollups = query.results || [];
      } catch {
        // Fail-open
      }

      try {
        const incStmt = env.DB.prepare(
          "SELECT * FROM circuit_breaker_incidents ORDER BY date DESC LIMIT 30",
        );
        const incQuery =
          typeof (incStmt as any).all === "function"
            ? await (incStmt as any).all()
            : await incStmt.bind().all();
        incidents = incQuery.results || [];
      } catch {
        // Fail-open
      }
    }
    return new Response(
      JSON.stringify({
        metrics: rollups,
        data_quality_warnings: incidents.map((inc: any) => ({
          date: inc.date,
          subsystem: inc.subsystem,
          warning: `Data is partial: circuit breaker tripped due to ${inc.reason}`,
          shed_count: inc.shed_count,
          data_completeness: inc.data_completeness,
        })),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, private",
        },
      },
    );
  }

  if (url.pathname === "/api/leads") {
    let leads: any[] = [];
    if (env.DB) {
      try {
        const stmt = env.DB.prepare(
          "SELECT id, from_email, subject, body, created_at FROM contact_leads ORDER BY created_at DESC LIMIT 50",
        );
        const q =
          typeof (stmt as any).all === "function"
            ? await (stmt as any).all()
            : await stmt.bind().all();
        leads = q.results || [];
      } catch {
        // Fail-open
      }
    }
    return new Response(
      JSON.stringify({
        status: "ok",
        leads,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, private",
        },
      },
    );
  }

  if (url.pathname === "/api/telemetry") {
    let pageviews: any[] = [];
    let edgeEvents: any[] = [];
    let prefetches: any[] = [];
    let dailySummaries: any[] = [];

    if (env.DB) {
      try {
        const stmt = env.DB.prepare(
          "SELECT id, path, visitor_hash, referrer, country, utm_source, utm_medium, utm_campaign, utm_content, utm_term, is_bot, created_at FROM pageviews ORDER BY id DESC LIMIT 50",
        );
        const q =
          typeof (stmt as any).all === "function"
            ? await (stmt as any).all()
            : await stmt.bind().all();
        pageviews = q.results || [];
      } catch {
        // Fail-open
      }

      try {
        const stmt = env.DB.prepare(
          "SELECT id, timestamp, path, locale, country, user_agent, visitor_hash, referrer FROM edge_telemetry_events ORDER BY timestamp DESC LIMIT 50",
        );
        const q =
          typeof (stmt as any).all === "function"
            ? await (stmt as any).all()
            : await stmt.bind().all();
        edgeEvents = q.results || [];
      } catch {
        // Fail-open
      }

      try {
        const stmt = env.DB.prepare(
          "SELECT id, path, visitor_hash, referrer, country, purpose, created_at FROM prefetch_analytics_events ORDER BY id DESC LIMIT 50",
        );
        const q =
          typeof (stmt as any).all === "function"
            ? await (stmt as any).all()
            : await stmt.bind().all();
        prefetches = q.results || [];
      } catch {
        // Fail-open
      }

      try {
        const stmt = env.DB.prepare(
          "SELECT summary_date, path, locale, country, total_views FROM pageviews_daily_summary ORDER BY summary_date DESC LIMIT 100",
        );
        const q =
          typeof (stmt as any).all === "function"
            ? await (stmt as any).all()
            : await stmt.bind().all();
        dailySummaries = q.results || [];
      } catch {
        // Fail-open
      }
    }

    const totalViews = pageviews.length;
    const humanViews = pageviews.filter((p: any) => !p.is_bot).length;
    const botViews = pageviews.filter((p: any) => p.is_bot).length;
    const uniqueVisitors = new Set(pageviews.map((p: any) => p.visitor_hash))
      .size;

    return new Response(
      JSON.stringify({
        status: "ok",
        surface: "admin-isolated",
        timestamp: new Date().toISOString(),
        stats: {
          total_pageviews: totalViews,
          human_views: humanViews,
          bot_views: botViews,
          unique_visitors: uniqueVisitors,
          prefetches_count: prefetches.length,
        },
        pageviews,
        edge_events: edgeEvents,
        prefetches,
        daily_summaries: dailySummaries,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, private",
        },
      },
    );
  }

  const adminHtml = `<!doctype html>
<html lang="es" data-theme="dark" class="dark">
<head>
  <meta charset="utf-8" />
  <title>Admin Management Surface // Telemetría Edge - arturonavax.dev</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <style>
    :root {
      --bg: #0a0203;
      --bg-surface: #120305;
      --card: #180406;
      --card-subtle: #1e0508;
      --border: #521317;
      --border-subtle: #3a0d10;
      --border-hover: #d48b38;
      --gold: #d48b38;
      --gold-light: #e5a352;
      --gold-subtle: rgba(212, 139, 56, 0.15);
      --text: #ffffff;
      --text-muted: #e2d5d5;
      --text-dim: #a39292;
      --green: #10b981;
      --cyan: #22d3ee;
      --red: #ef4444;
      --amber: #f59e0b;
      --header-bg: rgba(24, 4, 6, 0.95);
    }
    html[data-theme="light"] {
      --bg: #f5f4ef;
      --bg-surface: #edeae4;
      --card: #ffffff;
      --card-subtle: #f8f7f4;
      --border: #cbd3da;
      --border-subtle: #dee2e6;
      --border-hover: #7a1c16;
      --gold: #7a1c16;
      --gold-light: #5a120e;
      --gold-subtle: rgba(122, 28, 22, 0.12);
      --text: #111315;
      --text-muted: #1f2429;
      --text-dim: #3d444e;
      --green: #064e3b;
      --cyan: #0e7490;
      --red: #b91c1c;
      --amber: #b45309;
      --header-bg: rgba(255, 255, 255, 0.95);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      scrollbar-gutter: stable;
    }
    a { color: inherit; text-decoration: none; }
    
    /* Site Header */
    .site-header {
      position: sticky;
      top: 0;
      z-index: 50;
      width: 100%;
      border-bottom: 1px solid var(--border);
      background: var(--header-bg);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .header-inner {
      max-width: 1500px;
      margin: 0 auto;
      height: 3.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1.25rem;
      gap: 1rem;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-weight: 700;
      font-size: 0.9rem;
      letter-spacing: -0.5px;
      color: var(--text);
    }
    .brand-logo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1.85rem;
      height: 1.85rem;
      border-radius: 4px;
      background: var(--gold-subtle);
      border: 1px solid var(--gold);
      color: var(--gold);
      font-size: 0.75rem;
      font-weight: 800;
    }
    .nav-links {
      display: none;
      align-items: center;
      gap: 1.25rem;
      font-size: 0.75rem;
      color: var(--text-dim);
    }
    @media (min-width: 768px) {
      .nav-links { display: flex; }
    }
    .nav-links a:hover { color: var(--gold); }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .lang-switcher {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--bg-surface);
      padding: 0.25rem 0.5rem;
      font-size: 0.7rem;
      gap: 0.4rem;
      color: var(--text-dim);
    }
    .lang-switcher a:hover { color: var(--gold); }
    .theme-toggle-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: var(--bg-surface);
      color: var(--text-dim);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .theme-toggle-btn:hover {
      border-color: var(--gold);
      color: var(--gold);
    }
    
    /* Main Content */
    .main-wrap {
      flex: 1;
      max-width: 1500px;
      width: 100%;
      margin: 0 auto;
      padding: 1.5rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    
    /* Surface Title Box */
    .surface-banner {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1.25rem 1.5rem;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }
    .surface-title-group h1 {
      font-size: 1.25rem;
      color: var(--gold);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      letter-spacing: -0.5px;
    }
    .surface-sub {
      font-size: 0.75rem;
      color: var(--text-dim);
      margin-top: 0.25rem;
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      font-size: 0.7rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.6rem;
      border-radius: 3px;
      background: var(--card-subtle);
      border: 1px solid var(--border);
      font-weight: 600;
    }
    .badge.live {
      border-color: rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.12);
      color: var(--green);
    }
    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
    
    /* KPIs Grid */
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 0.85rem;
    }
    .kpi-card {
      background: var(--card);
      border: 1px solid var(--border);
      padding: 1rem 1.2rem;
      border-radius: 4px;
      position: relative;
    }
    .kpi-card::before {
      content: "";
      position: absolute;
      top: 0; left: 0; width: 3px; height: 100%;
      background: var(--gold);
    }
    .kpi-title {
      font-size: 0.7rem;
      text-transform: uppercase;
      color: var(--text-dim);
      letter-spacing: 0.5px;
    }
    .kpi-value {
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--text);
      margin-top: 0.25rem;
    }
    .kpi-sub {
      font-size: 0.7rem;
      color: var(--text-dim);
      margin-top: 0.2rem;
    }
    
    /* Controls Toolbar */
    .toolbar {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .toolbar-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
    }
    .btn-group {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
    button, select, input[type="text"] {
      background: var(--bg-surface);
      color: var(--text);
      border: 1px solid var(--border);
      padding: 0.35rem 0.65rem;
      border-radius: 3px;
      font-family: inherit;
      font-size: 0.75rem;
      transition: all 0.15s ease;
    }
    button { cursor: pointer; }
    button:hover, select:hover, input[type="text"]:focus {
      border-color: var(--gold);
      outline: none;
    }
    button.active {
      background: var(--gold);
      color: #000;
      font-weight: 700;
      border-color: var(--gold);
    }
    .checks-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1.25rem;
      font-size: 0.75rem;
      color: var(--text-dim);
    }
    .checks-row label {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      cursor: pointer;
    }
    
    /* Chart and Panels */
    .grid-12 {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.25rem;
    }
    @media (min-width: 1024px) {
      .grid-12 {
        grid-template-columns: 8fr 4fr;
      }
    }
    .panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 4px;
      overflow: hidden;
    }
    .panel-header {
      padding: 0.75rem 1.25rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--card-subtle);
    }
    .panel-title {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--gold);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .panel-body {
      padding: 1.25rem;
    }
    
    /* SVG Chart */
    .chart-container {
      position: relative;
      width: 100%;
      height: 220px;
    }
    .chart-svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .chart-tooltip {
      position: absolute;
      display: none;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.4rem 0.6rem;
      font-size: 0.7rem;
      pointer-events: none;
      z-index: 10;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }
    
    /* Tables & Lists */
    .table-responsive {
      overflow-x: auto;
      width: 100%;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.75rem;
    }
    th {
      background: var(--bg-surface);
      color: var(--text-dim);
      font-weight: 600;
      padding: 0.6rem 0.85rem;
      border-bottom: 1px solid var(--border);
      text-transform: uppercase;
      font-size: 0.68rem;
    }
    td {
      padding: 0.6rem 0.85rem;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-muted);
    }
    tr:hover td {
      background: rgba(212, 139, 56, 0.04);
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      font-size: 0.68rem;
      font-weight: 600;
    }
    .tag-human { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); }
    .tag-bot { background: rgba(239, 68, 68, 0.15); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3); }
    .tag-prefetch { background: rgba(34, 211, 238, 0.15); color: var(--cyan); border: 1px solid rgba(34, 211, 238, 0.3); }
    .tag-path { color: var(--gold); font-weight: 600; }
    .tag-country { background: var(--bg-surface); color: var(--gold); border: 1px solid var(--border); }
    
    /* Footer */
    .site-footer {
      margin-top: auto;
      border-top: 1px solid var(--border);
      background: var(--card);
      padding: 1.5rem 1.25rem;
      font-size: 0.75rem;
      color: var(--text-dim);
    }
    .footer-inner {
      max-width: 1500px;
      margin: 0 auto;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }
  </style>
</head>
<body>
  <!-- Standard Site Header with Theme and Language Switch -->
  <header class="site-header">
    <div class="header-inner">
      <div style="display: flex; align-items: center; gap: 1.5rem;">
        <a href="/" class="brand">
          <span class="brand-logo">AN</span>
          <span>Arturo Nava</span>
        </a>
        <nav class="nav-links">
          <a href="/#about">About</a>
          <a href="/projects/">Projects</a>
          <a href="/experience/">Experience</a>
          <a href="/services/">Services</a>
          <a href="/blog/">Blog</a>
          <a href="/resume/">Resume</a>
        </nav>
      </div>

      <div class="header-actions">
        <div class="lang-switcher">
          <a href="/admin" style="font-weight: 700; color: var(--gold);">ES</a>
          <span>/</span>
          <a href="/admin">EN</a>
        </div>

        <button type="button" id="theme-btn" class="theme-toggle-btn" aria-label="Toggle theme" title="Cambiar tema">
          <svg id="theme-sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
          <svg id="theme-moon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: none;">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        </button>
      </div>
    </div>
  </header>

  <!-- Main Dashboard Surface -->
  <main class="main-wrap">
    <!-- Surface Identity Banner -->
    <div class="surface-banner">
      <div class="surface-title-group">
        <h1>⚡ Admin Management Surface // Telemetría</h1>
        <p class="surface-sub">
          Host: <code>admin.arturonavax.dev</code> &bull; Isolated Zero Trust Surface &bull; Cloudflare Access &bull; D1 Distributed Database
        </p>
      </div>

      <div class="badges">
        <span class="badge live"><span class="pulse-dot"></span> EN VIVO</span>
        <span class="badge">Zero Trust Surface</span>
        <span class="badge" style="color: var(--gold-light);">Cloudflare Access</span>
        <span class="badge" id="badge-rel">Rel: v1.4.2 (edge)</span>
      </div>
    </div>

    <!-- Metrics Counters (6 KPIs) -->
    <div class="kpis">
      <div class="kpi-card">
        <div class="kpi-title">Eventos Recientes (D1)</div>
        <div class="kpi-value" id="kpi-total">--</div>
        <div class="kpi-sub" id="kpi-total-sub">Búfer perimetral D1</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Visitas Humanas (P0)</div>
        <div class="kpi-value" id="kpi-human" style="color: var(--green);">--</div>
        <div class="kpi-sub" id="kpi-human-sub">Tráfico real validado</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Bots &amp; Crawlers</div>
        <div class="kpi-value" id="kpi-bot" style="color: var(--gold-light);">--</div>
        <div class="kpi-sub" id="kpi-bot-sub">Indexadores &amp; IA</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Visitantes Únicos</div>
        <div class="kpi-value" id="kpi-unique">--</div>
        <div class="kpi-sub">Hashes GDPR anonimizados</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Prefetches (P1)</div>
        <div class="kpi-value" id="kpi-prefetch" style="color: var(--cyan);">--</div>
        <div class="kpi-sub">Circuit Breaker: OK</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Contact Leads</div>
        <div class="kpi-value" id="kpi-leads" style="color: var(--amber);">--</div>
        <div class="kpi-sub">Inbound pipeline</div>
      </div>
    </div>

    <!-- Master Controls Toolbar -->
    <div class="toolbar">
      <div class="toolbar-row">
        <div class="btn-group">
          <button type="button" id="btn-filter-all" class="active" onclick="setSegmentFilter('all')">Todos los Eventos</button>
          <button type="button" id="btn-filter-human" onclick="setSegmentFilter('human')">Solo Humanos (P0)</button>
          <button type="button" id="btn-filter-bot" onclick="setSegmentFilter('bot')">Bots &amp; Indexers</button>
          <button type="button" id="btn-filter-prefetch" onclick="setSegmentFilter('prefetch')">Prefetches (P1)</button>
        </div>

        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
          <select id="select-range" onchange="onRangeChange(this.value)">
            <option value="24h">Últimas 24h</option>
            <option value="7d" selected>Últimos 7 días</option>
            <option value="30d">Últimos 30 días</option>
            <option value="all">Histórico total</option>
          </select>

          <select id="select-path" onchange="onPathFilterChange(this.value)">
            <option value="all">Todas las rutas</option>
            <option value="/">Portada (/)</option>
            <option value="/blog/">/blog/*</option>
            <option value="/projects/">/projects/*</option>
            <option value="/services/">/services/*</option>
            <option value="/resume/">/resume/*</option>
          </select>

          <select id="select-poll" onchange="onPollIntervalChange(this.value)">
            <option value="5000">Auto: 5s</option>
            <option value="15000" selected>Auto: 15s</option>
            <option value="0">Pausado</option>
          </select>

          <button type="button" onclick="fetchTelemetry(true)">↻ Refrescar</button>
        </div>
      </div>

      <div class="toolbar-row" style="border-top: 1px solid var(--border); padding-top: 0.5rem;">
        <div class="checks-row">
          <label>
            <input type="checkbox" id="chk-exclude-bots" onchange="toggleExcludeBots(this.checked)" />
            <span>Excluir Bots de Gráficos</span>
          </label>
          <label>
            <input type="checkbox" id="chk-include-prefetch" checked onchange="toggleIncludePrefetch(this.checked)" />
            <span>Incluir Prefetch Especulativo</span>
          </label>
        </div>

        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <input type="text" id="input-search" placeholder="Filtrar por ruta, país, UTM..." oninput="onSearchInput(this.value)" style="width: 240px;" />
          <span id="search-counter" style="font-size: 0.7rem; color: var(--text-dim);">--</span>
        </div>
      </div>
    </div>

    <!-- Visualization Grid -->
    <div class="grid-12">
      <!-- High-Performance Native SVG Time-Series Chart -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Distribución Temporal de Eventos Edge (0 KB JS Chart)</div>
          <span style="font-size: 0.7rem; color: var(--text-dim);" id="chart-legend">Verde: Humanos | Oro: Bots | Cian: Prefetch</span>
        </div>
        <div class="panel-body">
          <div class="chart-container">
            <svg id="chart-svg" class="chart-svg" viewBox="0 0 700 220">
              <text x="350" y="110" text-anchor="middle" fill="var(--text-dim)">Conectando con motor de telemetría...</text>
            </svg>
            <div id="chart-tooltip" class="chart-tooltip"></div>
          </div>
        </div>
      </div>

      <!-- Countries Distribution -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Distribución Geográfica (Países)</div>
          <span style="font-size: 0.7rem; color: var(--text-dim);">Top Orígenes</span>
        </div>
        <div class="panel-body" id="countries-list">
          <p style="color: var(--text-dim); text-align: center; font-style: italic;">Cargando geolocalización...</p>
        </div>
      </div>
    </div>

    <!-- Secondary Insights Grid -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem;">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Fuentes de Atribución &amp; UTMs</div>
        </div>
        <div class="panel-body" id="top-referrers">
          <p style="color: var(--text-dim); text-align: center; font-style: italic;">Cargando canales...</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Rutas Más Demandadas</div>
        </div>
        <div class="panel-body" id="top-paths">
          <p style="color: var(--text-dim); text-align: center; font-style: italic;">Cargando rutas...</p>
        </div>
      </div>
    </div>

    <!-- Live Event Feed Table -->
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Registro Perimetral de Telemetría en Tiempo Real</div>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <span style="font-size: 0.7rem; color: var(--text-dim);" id="table-count">0 eventos</span>
          <button type="button" onclick="exportData('json')">JSON</button>
          <button type="button" onclick="exportData('csv')">CSV</button>
        </div>
      </div>
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th>Hora (UTC)</th>
              <th>Ruta</th>
              <th>País</th>
              <th>Referente / Canal</th>
              <th>Campaña UTM</th>
              <th>Clasificación</th>
              <th>Hash Visitante</th>
            </tr>
          </thead>
          <tbody id="telemetry-tbody">
            <tr>
              <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-dim); font-style: italic;">
                Conectando con el router perimetral D1...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <!-- Standard Site Footer -->
  <footer class="site-footer">
    <div class="footer-inner">
      <div>
        <p>&copy; 2026 Arturo Nava. High-Performance Edge Architecture &bull; 0 KB Baseline Client JS</p>
        <p style="margin-top: 0.2rem; color: var(--text-dim); font-size: 0.7rem;">Scroll navigation: <kbd>j</kbd> <kbd>k</kbd></p>
      </div>
      <div style="display: flex; gap: 1rem; align-items: center;">
        <a href="https://github.com/arturonavax" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://linkedin.com/in/arturonava" target="_blank" rel="noopener noreferrer">LinkedIn</a>
        <a href="/rss.xml">RSS</a>
      </div>
    </div>
  </footer>

  <script>
    let pollInterval = null;
    let pollDelay = 15000;
    let currentSegment = 'all';
    let currentPathFilter = 'all';
    let excludeBots = false;
    let includePrefetch = true;
    let searchQuery = '';

    let cachedPageviews = [];
    let cachedPrefetches = [];
    let cachedDaily = [];
    let cachedDeployments = [];
    let cachedLeads = [];

    // Theme Toggle Controller
    const themeBtn = document.getElementById('theme-btn');
    const sunIcon = document.getElementById('theme-sun');
    const moonIcon = document.getElementById('theme-moon');

    function initTheme() {
      const saved = localStorage.getItem('theme') || 'dark';
      applyTheme(saved);
    }

    function applyTheme(t) {
      document.documentElement.setAttribute('data-theme', t);
      if (t === 'light') {
        document.documentElement.classList.remove('dark');
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      } else {
        document.documentElement.classList.add('dark');
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      }
      localStorage.setItem('theme', t);
    }

    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme') || 'dark';
        applyTheme(cur === 'dark' ? 'light' : 'dark');
      });
    }
    initTheme();

    function setSegmentFilter(seg) {
      currentSegment = seg;
      ['all', 'human', 'bot', 'prefetch'].forEach(k => {
        const btn = document.getElementById('btn-filter-' + k);
        if (btn) btn.classList.toggle('active', k === seg);
      });
      renderAll();
    }

    function onRangeChange() {
      fetchTelemetry(true);
    }

    function onPathFilterChange(val) {
      currentPathFilter = val;
      renderAll();
    }

    function toggleExcludeBots(val) {
      excludeBots = val;
      renderAll();
    }

    function toggleIncludePrefetch(val) {
      includePrefetch = val;
      renderAll();
    }

    function onSearchInput(val) {
      searchQuery = val;
      renderAll();
    }

    function onPollIntervalChange(val) {
      pollDelay = parseInt(val, 10);
      if (pollInterval) clearInterval(pollInterval);
      if (pollDelay > 0) {
        pollInterval = setInterval(fetchTelemetry, pollDelay);
      }
    }

    function getFiltered() {
      let items = [...cachedPageviews];
      if (currentSegment === 'human') items = items.filter(i => !i.is_bot);
      if (currentSegment === 'bot') items = items.filter(i => i.is_bot);
      if (currentSegment === 'prefetch') {
        items = cachedPrefetches.map(p => ({ ...p, is_prefetch: true, is_bot: 0 }));
      }
      if (currentPathFilter !== 'all') {
        items = items.filter(i => i.path && i.path.startsWith(currentPathFilter));
      }
      if (excludeBots && currentSegment !== 'bot') {
        items = items.filter(i => !i.is_bot);
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        items = items.filter(i =>
          (i.path && i.path.toLowerCase().includes(q)) ||
          (i.country && i.country.toLowerCase().includes(q)) ||
          (i.referrer && i.referrer.toLowerCase().includes(q)) ||
          (i.utm_source && i.utm_source.toLowerCase().includes(q)) ||
          (i.visitor_hash && i.visitor_hash.toLowerCase().includes(q))
        );
      }
      return items;
    }

    function renderAll() {
      const filtered = getFiltered();
      const total = cachedPageviews.length;
      const human = cachedPageviews.filter(p => !p.is_bot).length;
      const bot = cachedPageviews.filter(p => p.is_bot).length;
      const unique = new Set(cachedPageviews.map(p => p.visitor_hash)).size;

      document.getElementById('kpi-total').textContent = total.toLocaleString();
      document.getElementById('kpi-total-sub').textContent = human + ' H · ' + bot + ' B';
      document.getElementById('kpi-human').textContent = human.toLocaleString();
      document.getElementById('kpi-human-sub').textContent = (total > 0 ? Math.round((human/total)*100) : 0) + '% del total';
      document.getElementById('kpi-bot').textContent = bot.toLocaleString();
      document.getElementById('kpi-bot-sub').textContent = (total > 0 ? Math.round((bot/total)*100) : 0) + '% del total';
      document.getElementById('kpi-unique').textContent = unique.toLocaleString();
      document.getElementById('kpi-prefetch').textContent = cachedPrefetches.length.toLocaleString();
      document.getElementById('kpi-leads').textContent = cachedLeads.length.toLocaleString();

      document.getElementById('table-count').textContent = 'Mostrando ' + filtered.length + ' de ' + total + ' eventos';
      document.getElementById('search-counter').textContent = filtered.length + ' items';

      renderChart();
      renderCountries();
      renderAggregates();
      renderTable(filtered);
    }

    function renderChart() {
      const svg = document.getElementById('chart-svg');
      if (!svg) return;

      const days = cachedDaily.slice(-7);
      if (!days.length) {
        svg.innerHTML = '<text x="350" y="110" text-anchor="middle" fill="var(--text-dim)">Sin datos agregados diarios</text>';
        return;
      }

      const w = 700;
      const h = 220;
      const pL = 40;
      const pR = 20;
      const pT = 20;
      const pB = 30;
      const cW = w - pL - pR;
      const cH = h - pT - pB;

      const maxVal = Math.max(...days.map(d => (d.human_views || d.total_views || 0) + (excludeBots ? 0 : (d.bot_views || 0)) + (includePrefetch ? (d.prefetch_views || 0) : 0)), 10);
      const slot = cW / days.length;
      const bW = Math.max(16, slot * 0.45);

      let grid = '';
      for (let g = 0; g <= 4; g++) {
        const y = pT + cH - (cH * (g / 4));
        const val = Math.round(maxVal * (g / 4));
        grid += '<line x1="' + pL + '" y1="' + y + '" x2="' + (w - pR) + '" y2="' + y + '" stroke="var(--border)" stroke-dasharray="2,2" stroke-opacity="0.6"/>';
        grid += '<text x="' + (pL - 6) + '" y="' + (y + 3) + '" text-anchor="end" fill="var(--text-dim)" font-size="9">' + val + '</text>';
      }

      let bars = '';
      days.forEach((d, i) => {
        const x = pL + i * slot + (slot - bW) / 2;
        const hV = d.human_views || Math.round((d.total_views || 0) * 0.7);
        const bV = excludeBots ? 0 : (d.bot_views || Math.round((d.total_views || 0) * 0.3));
        const pV = includePrefetch ? (d.prefetch_views || 0) : 0;

        const hH = (hV / maxVal) * cH;
        const bH = (bV / maxVal) * cH;
        const pH = (pV / maxVal) * cH;

        const yH = pT + cH - hH;
        const yB = yH - bH;
        const yP = yB - pH;

        bars += '<g class="chart-group" data-d="' + (d.summary_date || '') + '" data-h="' + hV + '" data-b="' + bV + '" data-p="' + pV + '">';
        bars += '<rect x="' + x + '" y="' + yH + '" width="' + bW + '" height="' + hH + '" fill="#10b981" rx="1"/>';
        if (bV > 0) bars += '<rect x="' + x + '" y="' + yB + '" width="' + bW + '" height="' + bH + '" fill="var(--gold)" rx="1"/>';
        if (pV > 0) bars += '<rect x="' + x + '" y="' + yP + '" width="' + bW + '" height="' + pH + '" fill="#22d3ee" rx="1"/>';
        bars += '<text x="' + (x + bW / 2) + '" y="' + (h - 10) + '" text-anchor="middle" fill="var(--text-dim)" font-size="9">' + (d.summary_date || '').slice(5) + '</text>';
        bars += '</g>';
      });

      svg.innerHTML = grid + bars;

      const tt = document.getElementById('chart-tooltip');
      svg.querySelectorAll('.chart-group').forEach(el => {
        el.addEventListener('mouseenter', e => {
          tt.innerHTML = '<strong>' + el.getAttribute('data-d') + '</strong><br/>' +
            '<span style="color:#10b981">Humanos: ' + el.getAttribute('data-h') + '</span><br/>' +
            '<span style="color:var(--gold)">Bots: ' + el.getAttribute('data-b') + '</span><br/>' +
            '<span style="color:#22d3ee">Prefetch: ' + el.getAttribute('data-p') + '</span>';
          tt.style.display = 'block';
        });
        el.addEventListener('mousemove', e => {
          const r = svg.getBoundingClientRect();
          tt.style.left = (e.clientX - r.left + 15) + 'px';
          tt.style.top = (e.clientY - r.top - 10) + 'px';
        });
        el.addEventListener('mouseleave', () => { tt.style.display = 'none'; });
      });
    }

    function renderCountries() {
      const container = document.getElementById('countries-list');
      const counts = {};
      cachedPageviews.forEach(p => {
        const c = p.country || 'XX';
        counts[c] = (counts[c] || 0) + 1;
      });
      const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 5);
      const total = cachedPageviews.length || 1;

      if (!sorted.length) {
        container.innerHTML = '<p style="color: var(--text-dim); text-align: center; font-style: italic;">Sin datos geográficos</p>';
        return;
      }
      container.innerHTML = sorted.map(([c, count]) => {
        const pct = Math.round((count / total) * 100);
        return '<div style="margin-bottom: 0.5rem;">' +
          '<div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom: 0.15rem;">' +
            '<strong>' + c + '</strong>' +
            '<span style="color:var(--text-dim)">' + count + ' visitas (' + pct + '%)</span>' +
          '</div>' +
          '<div style="width:100%; height:4px; background:var(--bg-surface); border-radius:2px; overflow:hidden;">' +
            '<div style="width:' + pct + '%; height:100%; background:var(--gold); border-radius:2px;"></div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderAggregates() {
      const pathsEl = document.getElementById('top-paths');
      const refsEl = document.getElementById('top-referrers');

      const pathCounts = {};
      const refCounts = {};
      cachedPageviews.forEach(p => {
        if (!p.is_bot && p.path) pathCounts[p.path] = (pathCounts[p.path] || 0) + 1;
        const ref = p.utm_source !== 'direct' && p.utm_source ? p.utm_source : (p.referrer || 'Direct');
        if (ref) refCounts[ref] = (refCounts[ref] || 0) + 1;
      });

      const sPaths = Object.entries(pathCounts).sort((a,b) => b[1] - a[1]).slice(0, 5);
      if (pathsEl) {
        pathsEl.innerHTML = sPaths.map(([pth, count]) =>
          '<div style="display:flex; justify-content:space-between; padding:0.35rem 0; border-bottom:1px solid var(--border-subtle);">' +
            '<span class="tag-path" style="max-width:200px; overflow:hidden; text-overflow:ellipsis;">' + escapeHtml(pth) + '</span>' +
            '<strong>' + count + '</strong>' +
          '</div>'
        ).join('') || '<p style="color: var(--text-dim); font-style: italic;">Sin datos</p>';
      }

      const sRefs = Object.entries(refCounts).sort((a,b) => b[1] - a[1]).slice(0, 5);
      if (refsEl) {
        refsEl.innerHTML = sRefs.map(([rf, count]) =>
          '<div style="display:flex; justify-content:space-between; padding:0.35rem 0; border-bottom:1px solid var(--border-subtle);">' +
            '<span style="max-width:200px; overflow:hidden; text-overflow:ellipsis;">' + escapeHtml(rf) + '</span>' +
            '<strong style="color:var(--gold);">' + count + '</strong>' +
          '</div>'
        ).join('') || '<p style="color: var(--text-dim); font-style: italic;">Sin datos</p>';
      }
    }

    function renderTable(items) {
      const tbody = document.getElementById('telemetry-tbody');
      if (!tbody) return;

      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-dim); font-style: italic;">No se registraron eventos para este filtro.</td></tr>';
        return;
      }

      tbody.innerHTML = items.slice(0, 35).map(item => {
        const isBot = Boolean(item.is_bot);
        const isPrefetch = Boolean(item.is_prefetch || item.purpose);
        let tagClass = 'tag-human';
        let tagLabel = 'HUMAN';

        if (isPrefetch) {
          tagClass = 'tag-prefetch';
          tagLabel = 'PREFETCH';
        } else if (isBot) {
          tagClass = 'tag-bot';
          tagLabel = 'BOT';
        }

        const country = item.country || 'XX';
        const ref = item.utm_source !== 'direct' && item.utm_source ? item.utm_source : (item.referrer || 'Direct');
        const campaign = item.utm_campaign ? escapeHtml(item.utm_campaign) : '--';
        const hash = item.visitor_hash ? item.visitor_hash.slice(0, 10) + '...' : '--';

        return '<tr>' +
          '<td>' + formatTime(item.created_at) + '</td>' +
          '<td><span class="tag-path">' + escapeHtml(item.path) + '</span></td>' +
          '<td><span class="tag tag-country">' + escapeHtml(country) + '</span></td>' +
          '<td>' + escapeHtml(ref) + '</td>' +
          '<td>' + campaign + '</td>' +
          '<td><span class="tag ' + tagClass + '">' + tagLabel + '</span></td>' +
          '<td><span style="color:var(--text-dim)">' + escapeHtml(hash) + '</span></td>' +
        '</tr>';
      }).join('');
    }

    window.exportData = function(fmt) {
      const items = getFiltered();
      if (!items.length) return;
      if (fmt === 'json') {
        const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'telemetry-' + Date.now() + '.json';
        a.click();
      } else {
        const rows = items.map(i => [i.id, i.created_at, i.path, i.country, i.referrer, i.is_bot].join(','));
        const blob = new Blob([['id,created_at,path,country,referrer,is_bot', ...rows].join('\\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'telemetry-' + Date.now() + '.csv';
        a.click();
      }
    };

    function formatTime(isoStr) {
      if (!isoStr) return '--';
      try {
        const d = new Date(isoStr);
        return d.toISOString().replace('T', ' ').slice(11, 19);
      } catch (_) {
        return isoStr;
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
      });
    }

    async function fetchTelemetry(isManual) {
      try {
        const [telRes, leadsRes] = await Promise.allSettled([
          fetch('/api/telemetry', { cache: 'no-store' }),
          fetch('/api/leads', { cache: 'no-store' }),
        ]);

        if (telRes.status === 'fulfilled' && telRes.value.ok) {
          const data = await telRes.value.json();
          cachedPageviews = data.pageviews || [];
          cachedPrefetches = data.prefetches || [];
          cachedDaily = data.daily_summaries || [];
        }

        if (leadsRes.status === 'fulfilled' && leadsRes.value.ok) {
          const lData = await leadsRes.value.json();
          cachedLeads = lData.leads || [];
        }

        if (!cachedDaily.length && cachedPageviews.length) {
          // Generate aggregate days from pageviews
          const daysMap = {};
          cachedPageviews.forEach(p => {
            const dt = (p.created_at || '').slice(0, 10);
            if (!daysMap[dt]) daysMap[dt] = { summary_date: dt, total_views: 0, human_views: 0, bot_views: 0, prefetch_views: 0 };
            daysMap[dt].total_views++;
            if (p.is_bot) daysMap[dt].bot_views++;
            else daysMap[dt].human_views++;
          });
          cachedDaily = Object.values(daysMap);
        }

        renderAll();
      } catch (err) {
        console.warn('Telemetry poll error', err);
      }
    }

    fetchTelemetry();
    pollInterval = setInterval(fetchTelemetry, pollDelay);
  </script>
</body>
</html>`;

  return new Response(adminHtml, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * Asynchronous Non-Blocking Analytics Logger (REQ-PCD-04, REQ-PCD-05)
 * Runs strictly within ctx.waitUntil without adding any latency to the critical response path.
 */
export async function recordAnalyticsNonBlocking(
  request: Request,
  path: string,
  db: D1Database,
): Promise<void> {
  try {
    const url = new URL(request.url);
    const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    const userAgent = request.headers.get("user-agent") || "";
    const referrerHeader = request.headers.get("referer") || "";

    const cf = (request as unknown as { cf?: { country?: string } }).cf;
    const country = cf?.country || "XX";

    // 1. Extraer Parámetros de Atribución
    let utmSource =
      url.searchParams.get("utm_source") || url.searchParams.get("ref");
    let utmMedium = url.searchParams.get("utm_medium");
    let utmCampaign = url.searchParams.get("utm_campaign");
    const utmContent = url.searchParams.get("utm_content") || "";
    const utmTerm = url.searchParams.get("utm_term") || "";

    // 2. Normalizar Referrer HTTP
    let referrer = "Direct";
    if (referrerHeader) {
      try {
        const refUrl = new URL(referrerHeader);
        const reqUrl = new URL(request.url);
        const cleanRefHost = refUrl.hostname.replace(/^www\./, "");
        const cleanReqHost = reqUrl.hostname.replace(/^www\./, "");

        if (cleanRefHost !== cleanReqHost) {
          referrer = cleanRefHost;
        }
      } catch {
        referrer = "Invalid";
      }
    }

    // 3. Fallback exhaustivo de Plataformas y Buscadores
    if (!utmSource) {
      const ref = referrer.toLowerCase();

      if (
        ref.includes("google.") ||
        ref.includes("bing.") ||
        ref.includes("duckduckgo.") ||
        ref.includes("yahoo.") ||
        ref.includes("ecosia.") ||
        ref.includes("baidu.") ||
        ref.includes("yandex.")
      ) {
        utmSource = ref.split(".")[0];
        utmMedium = utmMedium || "organic";
      } else if (ref.includes("linkedin.com") || ref.includes("lnkd.in")) {
        utmSource = "linkedin";
        utmMedium = utmMedium || "social";
      } else if (ref.includes("github.com")) {
        utmSource = "github";
        utmMedium = utmMedium || "social";
      } else if (ref.includes("gitlab.com")) {
        utmSource = "gitlab";
        utmMedium = utmMedium || "social";
      } else if (ref.includes("huggingface.co")) {
        utmSource = "huggingface";
        utmMedium = utmMedium || "community";
      } else if (ref.includes("leetcode.com")) {
        utmSource = "leetcode";
        utmMedium = utmMedium || "referral";
      } else if (ref.includes("kaggle.com")) {
        utmSource = "kaggle";
        utmMedium = utmMedium || "community";
      } else if (
        ref.includes("t.co") ||
        ref.includes("x.com") ||
        ref.includes("twitter.com")
      ) {
        utmSource = "x";
        utmMedium = utmMedium || "social";
      } else if (ref.includes("facebook.com") || ref.includes("fb.com")) {
        utmSource = "facebook";
        utmMedium = utmMedium || "social";
      } else if (ref.includes("instagram.com")) {
        utmSource = "instagram";
        utmMedium = utmMedium || "social";
      } else if (ref.includes("youtube.com") || ref.includes("youtu.be")) {
        utmSource = "youtube";
        utmMedium = utmMedium || "social";
      } else if (ref.includes("tiktok.com")) {
        utmSource = "tiktok";
        utmMedium = utmMedium || "social";
      } else if (ref.includes("twitch.tv")) {
        utmSource = "twitch";
        utmMedium = utmMedium || "social";
      } else if (ref.includes("reddit.com") || ref.includes("redd.it")) {
        utmSource = "reddit";
        utmMedium = utmMedium || "social";
      } else if (ref.includes("news.ycombinator.com")) {
        utmSource = "hackernews";
        utmMedium = utmMedium || "community";
      } else if (ref.includes("medium.com")) {
        utmSource = "medium";
        utmMedium = utmMedium || "article";
      } else if (ref.includes("notion.so") || ref.includes("notion.site")) {
        utmSource = "notion";
        utmMedium = utmMedium || "referral";
      } else if (ref.includes("whatsapp.com") || ref.includes("wa.me")) {
        utmSource = "whatsapp";
        utmMedium = utmMedium || "chat";
      } else if (ref.includes("telegram.org") || ref.includes("t.me")) {
        utmSource = "telegram";
        utmMedium = utmMedium || "chat";
      } else if (ref.includes("discord.com") || ref.includes("discord.gg")) {
        utmSource = "discord";
        utmMedium = utmMedium || "chat";
      } else if (ref.includes("slack.com")) {
        utmSource = "slack";
        utmMedium = utmMedium || "chat";
      } else if (ref.includes("teams.microsoft.com")) {
        utmSource = "teams";
        utmMedium = utmMedium || "chat";
      } else if (ref.includes("chat.google.com")) {
        utmSource = "google-chat";
        utmMedium = utmMedium || "chat";
      } else if (referrer !== "Direct" && referrer !== "Invalid") {
        utmSource = referrer;
        utmMedium = utmMedium || "referral";
      } else {
        utmSource = "direct";
        utmMedium = utmMedium || "none";
      }
    }

    const isBot = BOT_REGEX.test(userAgent) ? 1 : 0;
    if (isBot) {
      // Zero D1 writes consumed by scrapers, crawlers or automated bots
      return;
    }

    // Hash diario anonimizado (GDPR compliant)
    const today = new Date().toISOString().slice(0, 10);
    const signature = `${ip}-${userAgent}-${today}`;
    const encoder = new TextEncoder();
    const digestBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(signature),
    );
    const visitorHash = Array.from(new Uint8Array(digestBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);

    const locale = path.startsWith("/es") ? "es" : "en";
    const now = Date.now();

    // 1. Inserción en D1 pageviews
    const pageviewsInsert = db
      .prepare(
        `INSERT INTO pageviews (
           path, visitor_hash, referrer, country, 
           utm_source, utm_medium, utm_campaign, utm_content, utm_term,
           is_bot, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .bind(
        path.slice(0, 200),
        visitorHash,
        referrer.slice(0, 100),
        country.slice(0, 10),
        (utmSource || "direct").slice(0, 50),
        (utmMedium || "none").slice(0, 50),
        (utmCampaign || "").slice(0, 100),
        utmContent.slice(0, 100),
        utmTerm.slice(0, 100),
        isBot,
      )
      .run();

    // 2. Inserción en pageview_events para Daily Rollups si no es bot
    if (!isBot) {
      const rollupInsert = db
        .prepare(
          `INSERT INTO pageview_events (path, locale, country, referrer, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          path.slice(0, 200),
          locale,
          country.slice(0, 10),
          referrer.slice(0, 100),
          now,
        )
        .run();

      await Promise.all([pageviewsInsert, rollupInsert]);
    } else {
      await pageviewsInsert;
    }
  } catch (err) {
    // Fail-open resilience: Never bubble database errors to client
    console.error("[Analytics Background Error - Fail-Open]:", err);
  }
}

/**
 * Asynchronous Non-Blocking Prefetch Analytics Logger
 * Isolated in prefetch_analytics_events and controlled by PrefetchQuotaCircuitBreaker.
 */
export async function recordPrefetchAnalyticsNonBlocking(
  request: Request,
  path: string,
  db: D1Database,
  purpose: string,
): Promise<void> {
  try {
    const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    const userAgent = request.headers.get("user-agent") || "";
    const referrerHeader = request.headers.get("referer") || "";

    const cf = (request as unknown as { cf?: { country?: string } }).cf;
    const country = cf?.country || "XX";

    let referrer = "Direct";
    if (referrerHeader) {
      try {
        const refUrl = new URL(referrerHeader);
        const reqUrl = new URL(request.url);
        const cleanRefHost = refUrl.hostname.replace(/^www\./, "");
        const cleanReqHost = reqUrl.hostname.replace(/^www\./, "");
        if (cleanRefHost !== cleanReqHost) {
          referrer = cleanRefHost;
        }
      } catch {
        referrer = "Invalid";
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const signature = `${ip}-${userAgent}-${today}`;
    const encoder = new TextEncoder();
    const digestBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(signature),
    );
    const visitorHash = Array.from(new Uint8Array(digestBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);

    await db
      .prepare(
        `INSERT INTO prefetch_analytics_events (
           path, visitor_hash, referrer, country, purpose, created_at
         ) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      )
      .bind(
        path.slice(0, 200),
        visitorHash,
        referrer.slice(0, 100),
        country.slice(0, 10),
        purpose.slice(0, 50),
      )
      .run();
  } catch (err) {
    // Fail-open resilience: Never bubble database errors to client
    console.warn("[Prefetch Analytics Background Error - Fail-Open]:", err);
  }
}

/**
 * Asynchronous Non-Blocking Circuit Breaker Incident Logger
 * Warns downstream analytics consumers that telemetry data for this date is partial/incomplete.
 */
export async function recordCircuitBreakerIncident(
  db: D1Database,
  subsystem: string,
  date: string,
  reason: string,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO circuit_breaker_incidents (
           subsystem, date, reason, shed_count, data_completeness, notes
         ) VALUES (?, ?, ?, 1, 'partial', 'Prefetch telemetry shed to protect P0 quota')
         ON CONFLICT(subsystem, date) DO UPDATE SET
           shed_count = circuit_breaker_incidents.shed_count + 1`,
      )
      .bind(subsystem, date, reason)
      .run();
  } catch (err) {
    console.warn("[Circuit Breaker Incident Log Error - Fail-Open]:", err);
  }
}
