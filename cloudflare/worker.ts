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

    // -------------------------------------------------------------------------
    // 1. FAST-PATH: Subdomain Canonicalization & Apex Admin Surface Redirect (REQ-PCD-02, REQ-PCD-03)
    // -------------------------------------------------------------------------
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
    const pathname = url.pathname;
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
        const query = await env.DB.prepare(
          "SELECT * FROM daily_analytics_rollups ORDER BY date DESC LIMIT 30",
        ).all();
        rollups = query.results || [];
      } catch {
        // Fail-open
      }

      try {
        const incQuery = await env.DB.prepare(
          "SELECT * FROM circuit_breaker_incidents ORDER BY date DESC LIMIT 30",
        ).all();
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

  const adminHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Admin Dashboard - arturonavax.dev</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace; background: #0c0a09; color: #f5f5f4; padding: 2rem; }
    h1 { color: #f59e0b; margin-bottom: 0.5rem; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; background: #292524; color: #10b981; font-size: 0.875rem; border: 1px solid #44403c; }
    .card { background: #1c1917; border: 1px solid #292524; padding: 1.5rem; border-radius: 8px; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <h1>Admin Management Surface</h1>
  <p><span class="badge">Isolated Zero Trust Surface</span> Authenticated via Cloudflare Access</p>
  <div class="card">
    <h2>Edge Health & Security Status</h2>
    <p>Host: <code>admin.arturonavax.dev</code></p>
    <p>Zero Trust Boundary: Active</p>
    <p>Public Content Coupling: 0%</p>
  </div>
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
