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
          prefetchCircuitBreaker.recordVisit();
          ctx.waitUntil(recordAnalyticsNonBlocking(request, pathname, env.DB));
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

  if (url.pathname === "/api/telemetry") {
    let pageviews: any[] = [];
    let edgeEvents: any[] = [];
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
        },
        pageviews,
        edge_events: edgeEvents,
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
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Admin Dashboard & Telemetría en Tiempo Real - arturonavax.dev</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <style>
    :root {
      --bg: #0a0203;
      --card: #120305;
      --card-subtle: #180406;
      --border: #3b1014;
      --border-gold: #d48b38;
      --gold: #d48b38;
      --gold-light: #e5a352;
      --text: #ffffff;
      --text-muted: #e2d5d5;
      --text-dim: #a39292;
      --green: #10b981;
      --red: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--bg);
      color: var(--text);
      padding: 1.5rem;
      line-height: 1.5;
    }
    .header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.25rem;
      margin-bottom: 1.5rem;
    }
    h1 {
      font-size: 1.35rem;
      color: var(--gold);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      letter-spacing: -0.5px;
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      background: var(--card-subtle);
      color: var(--green);
      font-size: 0.75rem;
      border: 1px solid var(--border);
      font-weight: 600;
    }
    .badge.live {
      border-color: rgba(16, 185, 129, 0.4);
      background: rgba(16, 185, 129, 0.1);
    }
    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 8px var(--green);
      display: inline-block;
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .kpi-card {
      background: var(--card);
      border: 1px solid var(--border);
      padding: 1rem 1.25rem;
      border-radius: 6px;
      position: relative;
    }
    .kpi-card::before {
      content: "";
      position: absolute;
      top: 0; left: 0; width: 3px; height: 100%;
      background: var(--gold);
    }
    .kpi-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--text-dim);
      letter-spacing: 0.5px;
    }
    .kpi-value {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--text);
      margin-top: 0.25rem;
    }
    .kpi-sub {
      font-size: 0.7rem;
      color: var(--text-dim);
      margin-top: 0.2rem;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      background: var(--card);
      border: 1px solid var(--border);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      margin-bottom: 1.25rem;
    }
    .btn-group {
      display: flex;
      gap: 0.5rem;
    }
    button, select {
      background: var(--card-subtle);
      color: var(--gold-light);
      border: 1px solid var(--border);
      padding: 0.35rem 0.75rem;
      border-radius: 4px;
      font-family: inherit;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    button:hover, select:hover {
      border-color: var(--gold);
      background: #25070a;
    }
    button.active {
      background: var(--gold);
      color: #000;
      font-weight: 700;
      border-color: var(--gold);
    }
    .panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 1.5rem;
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
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--gold-light);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .table-responsive {
      overflow-x: auto;
      width: 100%;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.8rem;
    }
    th {
      background: #0f0204;
      color: var(--text-dim);
      font-weight: 600;
      padding: 0.6rem 1rem;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
      text-transform: uppercase;
      font-size: 0.7rem;
    }
    td {
      padding: 0.65rem 1rem;
      border-bottom: 1px solid rgba(59, 16, 20, 0.4);
      white-space: nowrap;
      color: var(--text-muted);
    }
    tr:hover td {
      background: rgba(212, 139, 56, 0.05);
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      font-size: 0.7rem;
      font-weight: 600;
    }
    .tag-human { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3); }
    .tag-bot { background: rgba(239, 68, 68, 0.15); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3); }
    .tag-path { color: var(--gold-light); font-weight: 600; }
    .tag-country { background: #25070a; color: var(--gold); border: 1px solid var(--border); }
    .hash { color: var(--text-dim); font-size: 0.75rem; }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.5rem;
    }
    .info-list {
      list-style: none;
      padding: 0.5rem 0;
    }
    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 1.25rem;
      border-bottom: 1px solid rgba(59, 16, 20, 0.3);
      font-size: 0.8rem;
    }
    .info-item:last-child { border-bottom: none; }
    .empty-state {
      padding: 2.5rem;
      text-align: center;
      color: var(--text-dim);
      font-style: italic;
    }
  </style>
</head>
<body>
  <header class="header">
    <div>
      <h1>⚡ Admin Management Surface // Telemetría</h1>
      <p style="font-size: 0.8rem; color: var(--text-dim); margin-top: 0.2rem;">
        Host: <code>admin.arturonavax.dev</code> &bull; Public Content Coupling: 0%
      </p>
    </div>
    <div class="badges">
      <span class="badge live"><span class="pulse-dot"></span> EN VIVO</span>
      <span class="badge">Isolated Zero Trust Surface</span>
      <span class="badge" style="color: var(--gold-light);">Cloudflare Access</span>
    </div>
  </header>

  <!-- Metrics Counters -->
  <div class="kpis">
    <div class="kpi-card">
      <div class="kpi-title">Eventos Recientes (D1)</div>
      <div class="kpi-value" id="kpi-total">--</div>
      <div class="kpi-sub">Últimos registros en búfer</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Visitas Humanas (P0)</div>
      <div class="kpi-value" id="kpi-human" style="color: var(--green);">--</div>
      <div class="kpi-sub">Tráfico real validado</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Bots &amp; Rastreadores</div>
      <div class="kpi-value" id="kpi-bot" style="color: var(--gold-light);">--</div>
      <div class="kpi-sub">Indexadores &amp; crawlers</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">Visitantes Únicos</div>
      <div class="kpi-value" id="kpi-visitors">--</div>
      <div class="kpi-sub">Hashes GDPR anonimizados</div>
    </div>
  </div>

  <!-- Real-Time Controls -->
  <div class="controls">
    <div class="btn-group">
      <button type="button" id="btn-filter-all" class="active" onclick="setFilter('all')">Todos</button>
      <button type="button" id="btn-filter-human" onclick="setFilter('human')">Humanos</button>
      <button type="button" id="btn-filter-bot" onclick="setFilter('bot')">Bots</button>
    </div>
    <div style="display: flex; gap: 0.5rem; align-items: center;">
      <span id="last-update" style="font-size: 0.75rem; color: var(--text-dim);">Actualizando...</span>
      <button type="button" id="btn-toggle-poll" onclick="togglePolling()">Auto-refresco: ON (5s)</button>
      <button type="button" onclick="fetchTelemetry(true)">↻ Actualizar Ahora</button>
    </div>
  </div>

  <!-- Live Feed Table -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">Registro Perimetral de Telemetría en Tiempo Real</div>
      <span style="font-size: 0.75rem; color: var(--text-dim);" id="table-count">Mostrando 0 eventos</span>
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
            <td colspan="7" class="empty-state">Conectando con el router perimetral D1...</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Auxiliary Insights Grid -->
  <div class="grid-2">
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Rutas Más Demandadas</div>
      </div>
      <ul class="info-list" id="top-paths">
        <li class="info-item" style="color: var(--text-dim);">Cargando analíticas...</li>
      </ul>
    </div>
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Fuentes de Atribución &amp; UTMs</div>
      </div>
      <ul class="info-list" id="top-referrers">
        <li class="info-item" style="color: var(--text-dim);">Cargando canales...</li>
      </ul>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">Seguridad Perimetral &amp; Estado de Conexión</div>
    </div>
    <div style="padding: 1.25rem; font-size: 0.8rem; color: var(--text-muted); line-height: 1.8;">
      <p>&bull; <strong>Aislamiento Zero Trust:</strong> Dominio confinado a Cloudflare Access (<code>admin.arturonavax.dev</code>).</p>
      <p>&bull; <strong>Fail-Open Circuit Breaker:</strong> Telemetría ejecuta en <code>ctx.waitUntil()</code> con 0ms de latencia para el usuario.</p>
      <p>&bull; <strong>Persistencia D1:</strong> Tablas activas <code>pageviews</code>, <code>pageview_events</code> y <code>edge_telemetry_events</code>.</p>
    </div>
  </div>

  <script>
    let pollInterval = null;
    let isPolling = true;
    let currentFilter = 'all';
    let cachedPageviews = [];

    function setFilter(filter) {
      currentFilter = filter;
      document.getElementById('btn-filter-all').classList.toggle('active', filter === 'all');
      document.getElementById('btn-filter-human').classList.toggle('active', filter === 'human');
      document.getElementById('btn-filter-bot').classList.toggle('active', filter === 'bot');
      renderTable();
    }

    function togglePolling() {
      isPolling = !isPolling;
      const btn = document.getElementById('btn-toggle-poll');
      if (isPolling) {
        btn.textContent = 'Auto-refresco: ON (5s)';
        btn.style.borderColor = 'var(--gold)';
        pollInterval = setInterval(fetchTelemetry, 5000);
      } else {
        btn.textContent = 'Auto-refresco: PAUSADO';
        btn.style.borderColor = 'var(--text-dim)';
        clearInterval(pollInterval);
      }
    }

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

    function renderTable() {
      const tbody = document.getElementById('telemetry-tbody');
      let items = cachedPageviews;
      if (currentFilter === 'human') items = items.filter(i => !i.is_bot);
      if (currentFilter === 'bot') items = items.filter(i => i.is_bot);

      document.getElementById('table-count').textContent = 'Mostrando ' + items.length + ' de ' + cachedPageviews.length + ' eventos';

      if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No se registraron eventos para este filtro.</td></tr>';
        return;
      }

      tbody.innerHTML = items.map(function(item) {
        const isBot = !!item.is_bot;
        const tagClass = isBot ? 'tag-bot' : 'tag-human';
        const tagLabel = isBot ? 'BOT' : 'HUMAN';
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
          '<td><span class="hash">' + escapeHtml(hash) + '</span></td>' +
        '</tr>';
      }).join('');
    }

    function renderAggregates(items) {
      // Top paths
      const pathCounts = {};
      const refCounts = {};
      items.forEach(function(i) {
        if (!i.is_bot && i.path) {
          pathCounts[i.path] = (pathCounts[i.path] || 0) + 1;
        }
        const src = i.utm_source || i.referrer || 'Direct';
        if (src) {
          refCounts[src] = (refCounts[src] || 0) + 1;
        }
      });

      const sortedPaths = Object.entries(pathCounts).sort((a,b) => b[1] - a[1]).slice(0, 5);
      const topPathsEl = document.getElementById('top-paths');
      if (sortedPaths.length) {
        topPathsEl.innerHTML = sortedPaths.map(function(p) {
          return '<li class="info-item"><span class="tag-path">' + escapeHtml(p[0]) + '</span><strong>' + p[1] + ' visitas</strong></li>';
        }).join('');
      } else {
        topPathsEl.innerHTML = '<li class="info-item" style="color:var(--text-dim);">Sin datos de navegación aún</li>';
      }

      const sortedRefs = Object.entries(refCounts).sort((a,b) => b[1] - a[1]).slice(0, 5);
      const topRefsEl = document.getElementById('top-referrers');
      if (sortedRefs.length) {
        topRefsEl.innerHTML = sortedRefs.map(function(r) {
          return '<li class="info-item"><span>' + escapeHtml(r[0]) + '</span><strong>' + r[1] + ' eventos</strong></li>';
        }).join('');
      } else {
        topRefsEl.innerHTML = '<li class="info-item" style="color:var(--text-dim);">Sin datos de atribución aún</li>';
      }
    }

    async function fetchTelemetry(isManual) {
      try {
        const res = await fetch('/api/telemetry', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        cachedPageviews = data.pageviews || [];
        const stats = data.stats || {};

        document.getElementById('kpi-total').textContent = stats.total_pageviews ?? cachedPageviews.length;
        document.getElementById('kpi-human').textContent = stats.human_views ?? cachedPageviews.filter(p => !p.is_bot).length;
        document.getElementById('kpi-bot').textContent = stats.bot_views ?? cachedPageviews.filter(p => p.is_bot).length;
        document.getElementById('kpi-visitors').textContent = stats.unique_visitors ?? '--';

        renderTable();
        renderAggregates(cachedPageviews);

        const now = new Date();
        document.getElementById('last-update').textContent = 'Actualizado: ' + now.toTimeString().split(' ')[0];
      } catch (err) {
        document.getElementById('last-update').textContent = 'Error de conexión: reintentando...';
      }
    }

    fetchTelemetry();
    pollInterval = setInterval(fetchTelemetry, 5000);
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
