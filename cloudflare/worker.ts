/// <reference types="@cloudflare/workers-types" />

import { handleAnalyticsRollup } from "./cron-scheduler";
import { BoundedCache } from "./runtime/bounded-cache";
import { readBoundedBody } from "./runtime/request-body";
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
  BotQuotaCircuitBreaker,
  StaticMemorySearchAdapter,
  DeploymentRegistry,
  QuotaDegradationTier,
  edgeQuotaTracker,
  isD1QuotaException,
  D1TelemetryAdapter,
  normalizeTelemetryPath,
  normalizeIpForDedupe,
  computeVisitDedupeKey,
  checkAndSetL1DedupeCache,
  clearL1DedupeCache,
  clearCompactRollupBuffer,
  writeTelemetryWalToR2,
  resolveR2Bucket,
} from "../src/lib/adapters";
import { coarseDeviceOs } from "../src/lib/adapters/cloudflare/d1-telemetry.adapter";
import { visitDimensions } from "../src/lib/adapters/cloudflare/telemetry-dimensions";
import type { SearchResultItem } from "../src/lib/ports/search.port";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  STORAGE_BUCKET?: R2Bucket;
  R2_BUCKET?: R2Bucket;
  CONTENT_BUCKET?: R2Bucket;
  ANALYTICS_ENGINE?: {
    writeDataPoint(event: {
      blobs?: string[];
      doubles?: number[];
      indexes?: string[];
    }): void;
  };
  VECTORIZE_INDEX?: any;
  AI?: any;
  TURNSTILE_SECRET_KEY?: string;
  DISCORD_WEBHOOK_URL?: string;
  SLACK_WEBHOOK_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ENABLE_TELEGRAM_NOTIFICATIONS?: string | boolean;
  EMAIL?: SendEmail;
  APP_STORAGE_DRIVER?: string;
  APP_SEARCH_DRIVER?: string;
  APP_TELEMETRY_DRIVER?: string;
  APP_CAPTCHA_DRIVER?: string;
  ENABLE_PREFETCH_TELEMETRY?: string | boolean;
  ENABLE_BOT_TELEMETRY?: string | boolean;
  BOT_TELEMETRY_SAMPLE_RATE?: string | number;
  SIMULATE_LOW_DB_QUOTA?: string | boolean;
  CLOUDFLARE_PLAN_TIER?: string;
  D1_DAILY_WRITE_BUDGET?: string | number;
  D1_DAILY_READ_BUDGET?: string | number;
  WORKERS_DAILY_REQUEST_BUDGET?: string | number;
  D1_TIER_CONSERVATIVE_RATIO?: string | number;
  D1_TIER_COMPACT_RATIO?: string | number;
  D1_TIER_SURVIVAL_RATIO?: string | number;
  D1_TIER_WAL_RATIO?: string | number;
  D1_BOT_BUDGET_RATIO?: string | number;
  D1_PREFETCH_BUDGET_RATIO?: string | number;
  D1_VISIT_BUDGET_RATIO?: string | number;
  D1_PREFETCH_SAMPLE_RATE?: string | number;
  REQUIRE_CF_ACCESS?: string | boolean;
  REQUIRE_ADMIN_AUTH?: string | boolean;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ADMIN_ACCESS_TOKEN?: string;
  ADMIN_ALLOWED_EMAIL?: string;
  ADMIN_AUTHORIZED_EMAILS?: string;
  ADMIN_API_KEY?: string;
  INDEXNOW_KEY?: string;
}

// 120-second In-Memory Edge Cache for /api/telemetry, /api/metrics, /api/leads, and /api/deployments to protect D1 daily row read quota (5,000,000 limit)
interface CachedTelemetry {
  timestamp: number;
  data: any;
  dbRef?: unknown;
}
const telemetryCache = new BoundedCache<string, CachedTelemetry>(128, 120_000);
const telemetryFreshCooldown = new BoundedCache<string, number>(128, 15_000);
const telemetryDbIds = new WeakMap<object, number>();
let nextTelemetryDbId = 0;
function telemetryDbKey(db: D1Database | undefined): string {
  if (!db) return "missing";
  let id = telemetryDbIds.get(db);
  if (!id) {
    id = ++nextTelemetryDbId;
    telemetryDbIds.set(db, id);
  }
  return String(id);
}
let cachedMetricsSnapshot: CachedTelemetry | null = null;
let cachedLeadsSnapshot: CachedTelemetry | null = null;
let cachedDeploymentsSnapshot: CachedTelemetry | null = null;
const TELEMETRY_CACHE_TTL_MS = 120_000;
const TELEMETRY_FRESH_COOLDOWN_MS = 15_000;

const STATIC_EXT_REGEX =
  /\.(?:css|js|mjs|map|json|png|jpg|jpeg|webp|avif|svg|ico|gif|woff|woff2|ttf|otf|eot|xml|txt|pdf|webmanifest)$/i;

const STATIC_PREFIX_REGEX = /^\/(?:_astro|fonts|images|assets)\//i;

/**
 * Vulnerability probe patterns and forbidden extensions for static Astro sites.
 */
export const SCANNER_EXTENSION_REGEX =
  /\.(?:php|asp|aspx|jsp|jspx|cgi|env|git|sql|bak|old|backup|ini|conf|config|yml|yaml|action|do|sh|pl)$/i;

// Root-anchored. Short/ambiguous tokens require a segment boundary (/, end, or .) so that
// legitimate future root routes (e.g. /storage-guide) are never flagged. Legitimate
// /.well-known/ endpoints (security.txt, ACME HTTP-01, passkeys, app links) are allowlisted.
export const SCANNER_PATH_PREFIX_REGEX =
  /^\/(?:\.git|\.env|\.aws|\.ssh|\.vscode|\.well-known\/(?!(?:security\.txt|acme-challenge\/|apple-app-site-association|assetlinks\.json|change-password|openid-configuration)$|acme-challenge\/)|wp-|wordpress|phpmyadmin|(?:pma|adminer|actuator|solr|cgi-bin|console|boaform|telescope|vendor|storage|shell|cmd)(?:\/|$|\.))/i;

export const HONEYPOT_CANARY_PATHS = new Set<string>([
  "/.env",
  "/.git/config",
  "/wp-login.php",
  "/xmlrpc.php",
  "/wp-config.php",
  "/phpmyadmin/index.php",
  "/adminer.php",
  "/actuator/env",
  "/actuator/health",
  "/api/swagger",
  "/v2/_catalog",
  "/shell.php",
  "/eval-stdin.php",
]);

export function isVulnerabilityScannerPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  if (HONEYPOT_CANARY_PATHS.has(normalized)) return true;
  if (SCANNER_EXTENSION_REGEX.test(normalized)) return true;
  if (SCANNER_PATH_PREFIX_REGEX.test(normalized)) return true;
  return false;
}

export const BOT_REGEX =
  /\b(?:googlebot|bingbot|bingpreview|slurp|duckduckbot|baiduspider|yandexbot|sogou|exabot|ia_archiver|gptbot|chatgpt-user|claudebot|claude-web|anthropic-ai|perplexitybot|perplexity|bytespider|ccbot|diffbot|cohere-ai|omgilibot|facebookbot|meta-externalagent|amazonbot|youbot|applebot|semrush|ahrefs|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|whatsapp|pinterestbot|redditbot|headlesschrome|phantomjs|selenium|playwright|puppeteer|cypress|webdriver|curl|wget|python-requests|aiohttp|httpx|httpclient|okhttp|axios|node-fetch|go-http-client|postmanruntime|insomnia|scrapy)\b/i;

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
];

// The Workers Cache API exposes `default`; DOM CacheStorage alone does not.
// Keep the capability optional for non-Workers runtimes and test fixtures.
function getDefaultCache(): Cache | null {
  if (typeof caches === "undefined") return null;
  const storage: CacheStorage & { readonly default?: Cache } = caches;
  return storage.default ?? null;
}

const routingPolicy = new CloudflareEdgeRoutingPolicy();
const circuitBreaker = new FailOpenCircuitBreaker();
export const prefetchCircuitBreaker = new PrefetchQuotaCircuitBreaker();
export const botCircuitBreaker = new BotQuotaCircuitBreaker();

function isAdminSurfacePath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    /^\/[a-z]{2}\/admin(?:\/|$)/i.test(pathname)
  );
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function createSafeResponse(
  body: BodyInit | null | undefined,
  status: number,
  headers: Headers,
): Response {
  if (!headers.has("Strict-Transport-Security")) {
    headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  if (NULL_BODY_STATUSES.has(status)) {
    headers.delete("content-type");
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    return new Response(null, { status, headers });
  }
  return new Response(body, { status, headers });
}

function withNoIndexHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return createSafeResponse(response.body, response.status, headers);
}

const AI_CONTENT_ROUTE_REGEX =
  /^\/(?:(en|es)\/)?(blog|projects|services|experience|resume)(?:\/([^/?#]+?))?(?:\.md)?\/?$/i;

function stripHtmlTagsToMarkdown(html: string): {
  title: string;
  description: string;
  bodyMarkdown: string;
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch =
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i,
    ) ||
    html.match(
      /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i,
    );
  const title = (titleMatch?.[1] || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const description = (descMatch?.[1] || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const articleMatch =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const rawSection = articleMatch?.[1] || "";
  if (!rawSection) {
    return { title, description, bodyMarkdown: "" };
  }

  const bodyMarkdown = rawSection
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, description, bodyMarkdown };
}

async function handleAiMarkdownNegotiation(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  const pathname = url.pathname;
  const acceptHeader = (request.headers.get("accept") || "").toLowerCase();
  const isMdExtension = pathname.toLowerCase().endsWith(".md");
  const wantsMarkdown = acceptHeader.includes("text/markdown") || isMdExtension;

  if (!wantsMarkdown) return null;

  const match = pathname.match(AI_CONTENT_ROUTE_REGEX);
  if (!match) return null;

  const locale = (match[1] || "en").toLowerCase();
  const section = (match[2] || "blog").toLowerCase();
  const rawSlug = (match[3] || "").replace(/\.md$/i, "");
  const slug = rawSlug || section;

  const canonicalPath =
    locale === "es"
      ? `/es/${section}${rawSlug ? `/${rawSlug}/` : "/"}`
      : `/${section}${rawSlug ? `/${rawSlug}/` : "/"}`;
  const canonicalUrl = `https://arturonavax.dev${canonicalPath}`;
  const llmsAnchorUrl = `https://arturonavax.dev/llms-full.txt#${encodeURIComponent(slug)}`;

  const cache = getDefaultCache();
  const cacheKeyUrl = `${new URL(request.url).origin}${pathname}?__format=markdown`;
  const cacheKey = new Request(cacheKeyUrl, { method: "GET" });

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }
    } catch {
      // Fail-open on cache error
    }
  }

  let extractedTitle = "";
  let extractedDesc = "";
  let extractedBody = "";

  if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
    try {
      const assetUrl = new URL(canonicalPath, url.origin);
      const htmlReq = new Request(assetUrl.toString(), {
        method: "GET",
        headers: { accept: "text/html" },
      });
      const htmlRes = await env.ASSETS.fetch(htmlReq);
      if (htmlRes && htmlRes.status === 200) {
        const htmlText = await htmlRes.text();
        const parsed = stripHtmlTagsToMarkdown(htmlText);
        extractedTitle = parsed.title;
        extractedDesc = parsed.description;
        extractedBody = parsed.bodyMarkdown;
      }
    } catch {
      // Fail-open on asset fetch
    }
  }

  const humanizedSlug = slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const finalTitle =
    extractedTitle || `${humanizedSlug} — Arturo Nava (${section})`;
  const finalSummary =
    extractedDesc ||
    `Technical ${section} resource by Arturo Nava (Senior Software & AI Engineer | Distributed Systems Architect).`;

  const markdownLines = [
    `# ${finalTitle}`,
    "",
    `- **Author**: Arturo Nava (https://arturonavax.dev/#person)`,
    `- **Canonical URL**: ${canonicalUrl}`,
    `- **Locale**: ${locale}`,
    `- **Section**: ${section}`,
    `- **Full AI Knowledge Base**: ${llmsAnchorUrl}`,
    "",
    `## Summary`,
    finalSummary,
  ];

  if (extractedBody) {
    markdownLines.push("", "## Content", extractedBody);
  }

  markdownLines.push(
    "",
    "---",
    `For complete machine-readable context across all posts, projects, experience, services, and resume, fetch: https://arturonavax.dev/llms-full.txt`,
    "",
  );

  const mdResponse = new Response(markdownLines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "X-Robots-Tag":
        "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      Link: `<https://arturonavax.dev/llms.txt>; rel="llms-txt", <https://arturonavax.dev/llms-full.txt>; rel="alternate"; type="text/plain", <${canonicalUrl}>; rel="canonical"`,
      Location: llmsAnchorUrl,
      Vary: "Accept",
    },
  });

  if (cache) {
    try {
      const putPromise = cache.put(cacheKey, mdResponse.clone());
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(putPromise);
      } else {
        await putPromise;
      }
    } catch {
      // Fail-open on cache write
    }
  }

  return mdResponse;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // TASK 2: Intercept Cloudflare challenge platform JSD scripts at Edge
    if (url.pathname.startsWith("/cdn-cgi/challenge-platform/")) {
      return new Response("/* noop */", {
        status: 200,
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Strict-Transport-Security":
            "max-age=63072000; includeSubDomains; preload",
        },
      });
    }

    const rawHost =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      url.hostname;
    const host = rawHost.split(":")[0]!.toLowerCase();

    // 1. Canonical Path Normalization
    let decodedPath = url.pathname;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      // Keep raw path on decode failure
    }
    const collapsedPath = decodedPath.replace(/\/+/g, "/");
    const cleanPath = collapsedPath.replace(/\.html$/i, "");
    const normalizedLowerPath = (cleanPath || "/").toLowerCase();
    const pathname = cleanPath || "/";

    // 2. Block Direct External Access to /__admin_vault__*
    if (normalizedLowerPath.startsWith("/__admin_vault__")) {
      return new Response("Not Found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      });
    }

    if (env) {
      edgeQuotaTracker.configureFromEnv(
        env as unknown as Record<string, unknown>,
      );
    }

    // 3. Identify All Protected Admin & API Surfaces
    const isAdminHost =
      host === "admin.arturonavax.dev" || host === "dash.arturonavax.dev";
    const isAdminPage =
      isAdminHost ||
      /^\/(?:[a-z]{2}\/)?admin(?:\/|$)/.test(normalizedLowerPath);
    const isProtectedApi = isProtectedApiSurface(
      normalizedLowerPath,
      request.method.toUpperCase(),
    );

    // Bypass auth on immutable static assets / icons on admin host
    if (
      isAdminHost &&
      (normalizedLowerPath === "/favicon.ico" ||
        normalizedLowerPath === "/favicon.svg" ||
        normalizedLowerPath.startsWith("/favicon-") ||
        STATIC_PREFIX_REGEX.test(pathname) ||
        STATIC_EXT_REGEX.test(pathname))
    ) {
      return withNoIndexHeaders(await env.ASSETS.fetch(request));
    }

    // 4. Fail-Closed Zero-Trust Guard for Admin Page and Protected API Surfaces
    if (isAdminPage || isProtectedApi) {
      if (request.method.toUpperCase() === "OPTIONS") {
        const origin = request.headers.get("origin") || "";
        const isAllowedOrigin =
          origin === "https://arturonavax.dev" ||
          origin === "https://admin.arturonavax.dev" ||
          origin.endsWith(".arturonavax.dev") ||
          origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:");
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": isAllowedOrigin
              ? origin
              : "https://arturonavax.dev",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
            "Access-Control-Allow-Headers":
              "Authorization, Content-Type, X-Admin-Token, Cf-Access-Jwt-Assertion",
            "Access-Control-Max-Age": "86400",
            Vary: "Origin",
          },
        });
      }

      const auth = await verifyAdminAccess(request, env);
      if (!auth.authorized) {
        const acceptHeader = request.headers.get("accept") || "";
        const isHtml = acceptHeader.includes("text/html");

        if (isAdminPage && isHtml) {
          return withNoIndexHeaders(
            renderAdminUnauthorizedHtml(auth.reason, auth.status || 401),
          );
        }

        const origin = request.headers.get("origin") || "";
        const isAllowedOrigin =
          origin === "https://arturonavax.dev" ||
          origin === "https://admin.arturonavax.dev" ||
          origin.endsWith(".arturonavax.dev") ||
          origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:");
        const errHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
          "WWW-Authenticate": 'Bearer realm="admin.arturonavax.dev"',
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        };
        if (isAllowedOrigin) {
          errHeaders["Access-Control-Allow-Origin"] = origin;
          errHeaders["Access-Control-Allow-Credentials"] = "true";
          errHeaders["Vary"] = "Origin";
        }

        return new Response(
          JSON.stringify({
            error: "Unauthorized",
            status: auth.status || 401,
            message:
              auth.reason ||
              "Cloudflare Access Zero Trust authentication required to access admin surface.",
            docs: "https://developers.cloudflare.com/cloudflare-one/access-controls/",
          }),
          {
            status: auth.status || 401,
            headers: errHeaders,
          },
        );
      }

      // If authorized and is an API endpoint or /status
      if (
        isProtectedApi ||
        normalizedLowerPath.startsWith("/api/") ||
        normalizedLowerPath === "/status"
      ) {
        return withNoIndexHeaders(
          await handleAuthorizedAdminRequest(request, env, ctx),
        );
      }

      // 5. Internal Vault Rewrite for Authorized Admin Page Requests
      if (isAdminPage) {
        let localeKey = "default";
        const localeMatch = normalizedLowerPath.match(
          /^\/([a-z]{2})\/admin(?:\/|$)/,
        );
        if (
          localeMatch &&
          (localeMatch[1] === "en" || localeMatch[1] === "es")
        ) {
          localeKey = localeMatch[1];
        } else if (isAdminHost) {
          const langParam = url.searchParams.get("lang")?.toLowerCase();
          const cookieLang =
            request.headers.get("cookie")?.includes("admin_lang=es") ||
            request.headers.get("cookie")?.includes("preferred_locale=es");
          const acceptLang = (
            request.headers.get("accept-language") || ""
          ).toLowerCase();
          if (
            langParam === "es" ||
            normalizedLowerPath.startsWith("/es") ||
            (!langParam && (cookieLang || acceptLang.startsWith("es")))
          ) {
            localeKey = "es";
          }
        }

        let vaultResponse: Response | null = null;
        if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
          try {
            const vaultHeaders = new Headers(request.headers);
            vaultHeaders.set("x-admin-vault-internal", "1");

            const vaultUrl = new URL(
              `/__admin_vault__/${localeKey}/index.html`,
              url.origin,
            );
            let vaultRes = await env.ASSETS.fetch(
              new Request(vaultUrl.toString(), {
                headers: vaultHeaders,
              }),
            );
            if (vaultRes.status === 404 && localeKey !== "default") {
              const fallbackDefaultUrl = new URL(
                "/__admin_vault__/default/index.html",
                url.origin,
              );
              vaultRes = await env.ASSETS.fetch(
                new Request(fallbackDefaultUrl.toString(), {
                  headers: vaultHeaders,
                }),
              );
            }

            // Secondary fallback using apex origin in case ASSETS binding maps assets to apex host
            if (
              vaultRes.status !== 200 &&
              url.origin !== "https://arturonavax.dev"
            ) {
              const apexHeaders = new Headers(vaultHeaders);
              apexHeaders.set("host", "arturonavax.dev");
              const apexVaultUrl = new URL(
                `/__admin_vault__/${localeKey}/index.html`,
                "https://arturonavax.dev",
              );
              const apexRes = await env.ASSETS.fetch(
                new Request(apexVaultUrl.toString(), {
                  headers: apexHeaders,
                }),
              );
              if (apexRes.status === 200) {
                vaultRes = apexRes;
              } else if (localeKey !== "default") {
                const apexDefaultUrl = new URL(
                  "/__admin_vault__/default/index.html",
                  "https://arturonavax.dev",
                );
                const apexDefaultRes = await env.ASSETS.fetch(
                  new Request(apexDefaultUrl.toString(), {
                    headers: apexHeaders,
                  }),
                );
                if (apexDefaultRes.status === 200) {
                  vaultRes = apexDefaultRes;
                }
              }
            }

            if (vaultRes.status === 200) {
              vaultResponse = vaultRes;
            }
          } catch {}
        }

        if (vaultResponse && vaultResponse.status === 200) {
          const headers = new Headers(vaultResponse.headers);
          headers.set(
            "Cache-Control",
            "private, no-store, no-cache, must-revalidate",
          );
          headers.set("X-Frame-Options", "DENY");
          headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
          const queryToken =
            url.searchParams.get("token") ||
            url.searchParams.get("admin_token");
          if (queryToken && auth.method === "admin_token") {
            const isSecure = url.protocol === "https:";
            const cookieDomain = host.endsWith("arturonavax.dev")
              ? "; Domain=.arturonavax.dev"
              : "";
            headers.set(
              "Set-Cookie",
              `admin_session=${encodeURIComponent(queryToken.trim())}; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly${isSecure ? "; Secure" : ""}${cookieDomain}`,
            );
          }
          return new Response(vaultResponse.body, {
            status: 200,
            headers,
          });
        }

        return new Response("Admin assets unavailable", {
          status: 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "private, no-store, no-cache, must-revalidate",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
          },
        });
      }
    }

    const redirect = routingPolicy.resolveCanonicalRedirect(
      url,
      request.method,
    );
    if (redirect.shouldRedirect && redirect.targetUrl) {
      return Response.redirect(redirect.targetUrl, redirect.statusCode);
    }

    // -------------------------------------------------------------------------
    // 2. FAST-PATH: Static Asset Bypass (Zero D1 / Telemetry / Session Overhead)
    // -------------------------------------------------------------------------
    const isImmutableAsset =
      pathname.startsWith("/_astro/") ||
      pathname.startsWith("/fonts/") ||
      pathname === "/favicon.svg" ||
      pathname === "/favicon.ico" ||
      pathname === "/favicon-48x48.png" ||
      pathname === "/apple-touch-icon.png" ||
      pathname === "/icon-192.png" ||
      pathname === "/icon-512.png" ||
      pathname === "/og-default.png";

    if (isImmutableAsset) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      if (pathname.startsWith("/fonts/")) {
        headers.set("Access-Control-Allow-Origin", "*");
      }
      headers.set("X-Content-Type-Options", "nosniff");
      return createSafeResponse(response.body, response.status, headers);
    }

    if (
      pathname === "/indexnow-key.txt" ||
      pathname === "/.well-known/indexnow-key.txt"
    ) {
      if (env.INDEXNOW_KEY && env.INDEXNOW_KEY.trim()) {
        return new Response(env.INDEXNOW_KEY.trim(), {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
    }

    // -------------------------------------------------------------------------
    // 3. Speculative Prefetch Detection (Bypass Telemetry & Rate-Limit Resilience)
    // -------------------------------------------------------------------------
    const secPurpose = (request.headers.get("sec-purpose") || "").toLowerCase();
    const purpose = (request.headers.get("purpose") || "").toLowerCase();
    const hasAstroPrefetchParam =
      url.searchParams.has("astro-prefetch") ||
      url.search.includes("astro-prefetch");
    const isPrefetch =
      purpose === "prefetch" ||
      secPurpose.includes("prefetch") ||
      secPurpose.includes("prerender") ||
      request.headers.get("x-astro-prefetch") !== null ||
      request.headers.get("X-Astro-Prefetch") !== null ||
      hasAstroPrefetchParam;

    if (
      !pathname.startsWith("/api/") &&
      !pathname.startsWith("/cdn-assets/") &&
      !isVulnerabilityScannerPath(pathname) &&
      (STATIC_PREFIX_REGEX.test(pathname) || STATIC_EXT_REGEX.test(pathname))
    ) {
      if (isPrefetch && request.method === "HEAD") {
        return new Response(null, {
          status: 204,
          headers: {
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      if (
        pathname.startsWith("/_astro/") ||
        pathname.startsWith("/fonts/") ||
        isPrefetch
      ) {
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
      } else if (pathname.endsWith(".pdf")) {
        headers.set(
          "Cache-Control",
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
        );
      } else if (/\.(?:png|jpg|jpeg|webp|avif|svg|ico|gif)$/i.test(pathname)) {
        headers.set(
          "Cache-Control",
          "public, max-age=604800, stale-while-revalidate=86400",
        );
        headers.set("X-Content-Type-Options", "nosniff");
      } else if (pathname.startsWith("/search-index")) {
        headers.set(
          "Cache-Control",
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
        );
        headers.set("Access-Control-Allow-Origin", "*");
      } else if (
        pathname.endsWith("sitemap-index.xml") ||
        pathname.endsWith("sitemap-0.xml") ||
        pathname === "/rss.xml" ||
        pathname === "/robots.txt" ||
        pathname.startsWith("/llms")
      ) {
        headers.set(
          "Cache-Control",
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
        );
      } else {
        headers.set(
          "Cache-Control",
          "public, max-age=3600, stale-while-revalidate=86400",
        );
      }
      return createSafeResponse(response.body, response.status, headers);
    }

    // -------------------------------------------------------------------------
    // 4. Dedicated API Endpoints (Search, Captcha, Ingestion, Storage, Contact)
    // -------------------------------------------------------------------------
    if (pathname === "/api/contact") {
      return withNoIndexHeaders(
        await handleContactFormSubmission(request, env, ctx),
      );
    }

    if (pathname === "/api/search") {
      return withNoIndexHeaders(
        await handleSemanticSearch(request, env, ctx),
      );
    }

    if (pathname === "/api/verify-captcha" && request.method === "POST") {
      return withNoIndexHeaders(
        await handleCaptchaVerification(request, env, ctx),
      );
    }

    if (pathname === "/api/telemetry/collect") {
      return withNoIndexHeaders(
        await handleTelemetryCollectBeacon(request, env, ctx, isPrefetch),
      );
    }

    if (pathname === "/api/telemetry/views" && request.method === "GET") {
      return withNoIndexHeaders(
        await handleTelemetryViewsRead(env, ctx, url),
      );
    }

    if (pathname.startsWith("/cdn-assets/") && env.STORAGE_BUCKET) {
      return handleCdnStorageAsset(env, ctx, url);
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
            "X-Robots-Tag": "noindex, nofollow, noarchive",
          },
        },
      );
    }

    if (pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "X-Content-Type-Options": "nosniff",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      });
    }

    // -------------------------------------------------------------------------
    // 4b. AI Content Negotiation (Accept: text/markdown or .md suffix)
    // -------------------------------------------------------------------------
    const aiMarkdownResponse = await handleAiMarkdownNegotiation(
      request,
      env,
      ctx,
      url,
    );
    if (aiMarkdownResponse) {
      return aiMarkdownResponse;
    }

    // -------------------------------------------------------------------------
    // 5. FAST-PATH: Public Document Delivery & Non-Blocking Telemetry (REQ-PCD-01, REQ-PCD-04)
    // -------------------------------------------------------------------------
    if (isVulnerabilityScannerPath(pathname)) {
      return new Response("Not Found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=86400",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      });
    }

    // Static Assets already caches versioned deployments at the edge. A separate
    // Cache API entry keyed only by the public URL can outlive a deployment and
    // serve an old HTML shell without ClientRouter after the Worker is updated.
    const response = await env.ASSETS.fetch(request);
    let edgeVisitLogged = false;

    // Asynchronous decoupled telemetry in background via ctx.waitUntil
    // Enforce HTTP 200/304 Status Invariant: Only record analytics if response is successful (protect D1 quota)
    if (
      request.method === "GET" &&
      env.DB &&
      (response.status === 200 || response.status === 304)
    ) {
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
          // Only an explicit operational bypass suppresses eligible speculative events.
          const shouldBypassTelemetry =
            (env as unknown as Record<string, unknown>)
              ?.BYPASS_PREFETCH_TELEMETRY === true;

          if (
            !shouldBypassTelemetry &&
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
          } else if (!shouldBypassTelemetry) {
            // Circuit Breaker tripped or kill-switch: log incident once per date in background
            const today = new Date().toISOString().slice(0, 10);
            if (
              edgeQuotaTracker.getTier() <
                QuotaDegradationTier.CRITICAL_SURVIVAL &&
              prefetchCircuitBreaker.shouldLogIncident(today)
            ) {
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
          edgeVisitLogged = true;
          if (
            !prefetchCircuitBreaker.canRecordVisit ||
            prefetchCircuitBreaker.canRecordVisit(
              env as unknown as Record<string, unknown>,
            )
          ) {
            ctx.waitUntil(
              recordAnalyticsNonBlocking(request, pathname, env.DB, env),
            );
          }
        }
      }
    }

    // Apply deterministic RFC 9111 cache & edge security directives based on asset type
    const headers = new Headers(response.headers);
    let shouldWrapResponse = false;

    const contentType = headers.get("content-type") || "";
    if (
      contentType.includes("text/html") ||
      pathname.endsWith("/") ||
      !pathname.includes(".")
    ) {
      headers.set("Content-Type", "text/html; charset=utf-8");
      if (!headers.has("Cache-Control")) {
        headers.set("Cache-Control", "public, max-age=0, must-revalidate");
      }
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-Frame-Options", "DENY");
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload",
      );
      headers.set("Alt-Svc", 'h3=":443"; ma=86400');
      const existingPp = headers.get("Permissions-Policy");
      if (!existingPp) {
        headers.set(
          "Permissions-Policy",
          "camera=(), microphone=(), geolocation=(), browsing-topics=(), run-ad-auction=(), join-ad-interest-group=(), accelerometer=(), gyroscope=(), magnetometer=(), payment=(), usb=()",
        );
      } else if (!existingPp.includes("run-ad-auction")) {
        headers.set(
          "Permissions-Policy",
          `${existingPp}, run-ad-auction=(), join-ad-interest-group=()`,
        );
      }
      if (headers.has("Vary")) {
        const v = headers.get("Vary") || "";
        if (!v.includes("Accept")) headers.set("Vary", `${v}, Accept`);
      } else {
        headers.set("Vary", "Accept");
      }

      const isSearchRoute = /^\/(?:es\/)?search(?:\/|$)/.test(
        normalizedLowerPath,
      );
      const hasFilterOrSearchQuery =
        url.searchParams.has("q") ||
        url.searchParams.has("company") ||
        url.searchParams.has("filters") ||
        url.searchParams.has("skill") ||
        url.searchParams.has("tag");

      if (isAdminSurfacePath(pathname)) {
        headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      } else if (isSearchRoute || hasFilterOrSearchQuery) {
        headers.set("X-Robots-Tag", "noindex, nofollow");
      } else if (response.status === 200) {
        headers.set(
          "X-Robots-Tag",
          "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
        );
        headers.set(
          "Link",
          '<https://arturonavax.dev/llms.txt>; rel="llms-txt", <https://arturonavax.dev/llms-full.txt>; rel="alternate"; type="text/plain"',
        );
      }

      if (edgeVisitLogged && !isPrefetch) {
        headers.set("X-Edge-Visit-Logged", "1");
        headers.append(
          "Set-Cookie",
          "ev_init=1; Max-Age=5; Path=/; SameSite=Lax",
        );
      }
      shouldWrapResponse = true;
    }

    let finalResponse: Response;
    if (shouldWrapResponse) {
      if (
        response.status === 200 &&
        contentType.includes("text/html") &&
        response.body
      ) {
        let text = await response.text();
        if (
          text.includes("/cdn-cgi/challenge-platform/") ||
          text.includes("__CF$cv$params")
        ) {
          // Inspect one complete script at a time. Matching across closing tags
          // can erase Astro's router and metadata before an unrelated marker.
          text = text.replace(
            /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
            (script: string, attributes: string, body: string) => {
              const challengeSource =
                /\bsrc\s*=\s*(["'])[^"']*\/cdn-cgi\/challenge-platform\/scripts\/jsd\/main\.js[^"']*\1/i.test(
                  attributes,
                );
              // The application's defensive script only references this marker.
              const challengeAssignment = /\b__CF\$cv\$params\s*=/.test(body);
              return challengeSource || challengeAssignment ? "" : script;
            },
          );
        }
        finalResponse = new Response(text, {
          status: response.status,
          headers,
        });
      } else {
        finalResponse = createSafeResponse(
          response.body,
          response.status,
          headers,
        );
      }
    } else {
      finalResponse = response;
    }

    return finalResponse;
  },

  // Cron Trigger Engine for Daily Analytics Rollups (SPEC-003 Section 2.3.2)
  async scheduled(
    _controller: ScheduledController,
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
  const cache = getDefaultCache();
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
      { success: false },
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

// IP Rate Limiter for public form submissions (max 5 submissions per 10 minutes per IP)
const contactRateLimits = new BoundedCache<
  string,
  { count: number; resetAt: number }
>(4096, 10 * 60 * 1000);

export function checkContactRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const maxRequests = 5;

  const record = contactRateLimits.get(ip);
  if (!record || now > record.resetAt) {
    return contactRateLimits.admit(
      ip,
      { count: 1, resetAt: now + windowMs },
      now,
    );
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * Direct Contact Form Submission with Cloudflare Free Tier D1 Storage (ODD Task)
 */
export async function handleContactFormSubmission(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  let rawBody: string | null;
  try {
    rawBody = await readBoundedBody(request, 32 * 1024);
  } catch {
    rawBody = "";
  }
  if (rawBody === null) {
    return new Response(
      JSON.stringify({ status: "error", error: "Payload too large" }),
      {
        status: 413,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, private",
        },
      },
    );
  }

  const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
  if (!checkContactRateLimit(clientIp)) {
    return new Response(
      JSON.stringify({
        status: "error",
        error: "Too many contact submissions. Please try again in 10 minutes.",
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "600",
          "Cache-Control": "no-store, private",
        },
      },
    );
  }

  try {
    const data = (() => {
      try {
        return JSON.parse(rawBody || "{}");
      } catch {
        return {};
      }
    })() as Record<string, any>;
    const name = (data.name || "").toString().trim().slice(0, 100);
    const email = (data.email || "").toString().trim().slice(0, 120);
    const phone = (data.phone || "").toString().trim().slice(0, 35);
    const rawSubject = (
      data.subject || "Distributed Architecture & Performance Consulting"
    )
      .toString()
      .trim()
      .slice(0, 150);
    const rawLocale = (data.locale || data.lang || "en")
      .toString()
      .trim()
      .slice(0, 10)
      .toLowerCase();
    const locale = rawLocale.startsWith("es") ? "es" : "en";

    // Normalize topic/subject to English as required
    const subjectMap: Record<string, string> = {
      "Consultoría de Arquitectura y Rendimiento":
        "Distributed Architecture & Performance Consulting",
      "Consultoría de Arquitectura & Rendimiento Distribuido":
        "Distributed Architecture & Performance Consulting",
      "Oportunidad Profesional (Staff / Senior Engineer)":
        "Career Opportunity (Staff / Senior Engineer)",
      "Seguridad & DevSecOps": "Security Hardening & DevSecOps",
      "Hardening de Seguridad & DevSecOps": "Security Hardening & DevSecOps",
      "Colaboración General & Asesoría": "General Collaboration & Advisory",
    };
    const subject =
      subjectMap[rawSubject] ||
      rawSubject ||
      "Distributed Architecture & Performance Consulting";
    const message = (data.message || "").toString().trim().slice(0, 4000);
    const honeypot = (data.website || data.honeypot || "").toString().trim();
    const turnstileToken = (
      data.turnstileToken ||
      data["cf-turnstile-response"] ||
      request.headers.get("cf-turnstile-response") ||
      ""
    )
      .toString()
      .trim();

    // Silent drop for bot submissions trap
    if (honeypot) {
      return new Response(
        JSON.stringify({
          status: "ok",
          message: "Message received successfully",
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

    // Required fields & email format validation
    if (!name || name.length === 0) {
      return new Response(
        JSON.stringify({
          status: "error",
          error: "Please provide a valid name or organization.",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, private",
          },
        },
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return new Response(
        JSON.stringify({
          status: "error",
          error: "Please provide a valid email address.",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, private",
          },
        },
      );
    }

    if (!message || message.length < 20) {
      return new Response(
        JSON.stringify({
          status: "error",
          error: "Message must be at least 20 characters long.",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, private",
          },
        },
      );
    }

    // Prevent direct automated API exploitation: enforce same-origin or known host
    const origin = request.headers.get("origin") || "";
    const reqHost = new URL(request.url).host;
    if (
      origin &&
      !origin.includes(reqHost) &&
      !origin.includes("localhost") &&
      !origin.includes("127.0.0.1") &&
      !origin.includes("arturonavax.dev")
    ) {
      return new Response(
        JSON.stringify({
          status: "error",
          error: "Cross-origin submission rejected.",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Time-to-submit verification (trap automated bot speed < 1.5 seconds)
    const tSig = Number(data.t_sig || 0);
    if (tSig > 0 && Date.now() - tSig < 1500) {
      // Rapid bot submission dropped silently
      return new Response(
        JSON.stringify({
          status: "ok",
          message: "Message received successfully",
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

    // Cloudflare Turnstile Captcha verification when configured
    let isTurnstileVerified = !env.TURNSTILE_SECRET_KEY;
    if (env.TURNSTILE_SECRET_KEY) {
      if (!turnstileToken) {
        return new Response(
          JSON.stringify({
            status: "error",
            error: "Security verification (Turnstile) is required.",
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store, private",
            },
          },
        );
      }

      if (
        turnstileToken === "fallback_adblock" ||
        turnstileToken === "fallback_network"
      ) {
        // Legitimate client with ad-blocker or protected network where Turnstile was blocked.
        // Protected by Edge Shield (Honeypot + strict IP rate-limiting + time-to-submit verification).
        isTurnstileVerified = false;
      } else {
        try {
          const captchaAdapter = createCaptchaAdapter({
            env: {
              APP_CAPTCHA_DRIVER: env.APP_CAPTCHA_DRIVER,
              TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY,
            },
            executionCtx: ctx,
          });

          const turnstileResult = await circuitBreaker.executeWithFallback(
            () =>
              captchaAdapter.verify({
                token: turnstileToken,
              }),
            { success: true },
            2500,
            "turnstile-verify",
          );

          if (!turnstileResult.success) {
            return new Response(
              JSON.stringify({
                status: "error",
                error: "Captcha verification failed. Please try again.",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          isTurnstileVerified = true;
        } catch (_) {
          // Fail-open on timeout or internal adapter failure
        }
      }
    }

    // Extract Cloudflare Edge Legal Telemetry (GDPR-compliant security & legitimate interest logging)
    const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    const userAgent = (request.headers.get("user-agent") || "").slice(0, 500);
    const referer = (request.headers.get("referer") || "").slice(0, 500);

    const cf = (request as unknown as { cf?: Record<string, any> }).cf;
    const country = (cf?.country || "").toString().slice(0, 10);
    const city = (cf?.city || "").toString().slice(0, 100);
    const region = (cf?.region || cf?.regionCode || "")
      .toString()
      .slice(0, 100);
    const timezone = (cf?.timezone || "").toString().slice(0, 100);
    const asn = typeof cf?.asn === "number" ? cf.asn : null;
    const asOrganization = (cf?.asOrganization || "").toString().slice(0, 150);

    // Format the stored lead body and notification representation.
    let formattedBody = `Name: ${name}\nEmail: ${email}`;
    if (phone) {
      formattedBody += `\nPhone: ${phone}`;
    }
    formattedBody += `\nLocale: ${locale}\nIP: ${ip}\nLocation: ${[city, country].filter(Boolean).join(", ") || "Unknown"}\n\nMessage:\n${message}`;

    // Persist in the compact contact_leads schema with network and geo fields.
    // Tier 4 or D1 error automatically spills the lead to R2 WAL (`wal/leads/${uuid}.json`)
    const leadWalPayload = {
      name,
      from_email: email,
      phone: phone || null,
      subject: `[Web] ${subject}`,
      body: formattedBody,
      locale,
      ip,
      country: country || null,
      city: city || null,
      region: region || null,
      timezone: timezone || null,
      asn,
      as_organization: asOrganization || null,
      user_agent: userAgent || null,
      referer: referer || null,
      turnstile_verified: isTurnstileVerified ? 1 : 0,
      created_at: new Date().toISOString(),
    };

    let leadPersisted = false;
    const spillLeadToR2Wal = async () => {
      const bucket = resolveR2Bucket(env);
      if (!bucket || typeof bucket.put !== "function") return;
      try {
        const walKey = `wal/leads/${crypto.randomUUID()}.json`;
        await bucket.put(walKey, JSON.stringify(leadWalPayload), {
          httpMetadata: { contentType: "application/json" },
        });
        leadPersisted = true;
      } catch (walErr) {
        console.warn("[Contact Lead R2 WAL Error]:", walErr);
      }
    };

    if (
      edgeQuotaTracker.getTier() === QuotaDegradationTier.R2_WAL_FALLBACK ||
      !env.DB
    ) {
      await spillLeadToR2Wal();
    } else if (env.DB) {
      try {
        const stmt = env.DB.prepare(
          "INSERT INTO contact_leads (from_email, subject, body, name, phone, locale, ip, country, city, region, timezone, asn, as_organization, user_agent, referer, turnstile_verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        ).bind(
          email,
          `[Web] ${subject}`,
          formattedBody,
          name,
          phone || null,
          locale,
          ip,
          country || null,
          city || null,
          region || null,
          timezone || null,
          asn,
          asOrganization || null,
          userAgent || null,
          referer || null,
          isTurnstileVerified ? 1 : 0,
        );
        await stmt.run();
        leadPersisted = true;
        edgeQuotaTracker.recordWrite(1);
      } catch (err) {
        if (isD1QuotaException(err)) edgeQuotaTracker.tripCircuitBreaker(String(err));
        await spillLeadToR2Wal();
      }
    }

    if (!leadPersisted) {
      return new Response(JSON.stringify({ status: "unavailable", error: "Unable to persist message at this time." }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" },
      });
    }

    // Webhook & Push dispatch if configured (Discord/Slack/Telegram)
    const webhookUrl = env.DISCORD_WEBHOOK_URL || env.SLACK_WEBHOOK_URL;
    const geoSummary = [city, country].filter(Boolean).join(", ");
    const networkSummary = [asOrganization, asn ? `AS${asn}` : ""]
      .filter(Boolean)
      .join(" · ");
    const shieldStatus = isTurnstileVerified
      ? "✅ Verified"
      : "🛡️ Fallback (Ad-blocker / Shield)";

    if (webhookUrl && ctx && typeof ctx.waitUntil === "function") {
      const webhookPromise = fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [
            {
              title: `New Direct Lead: [Web] ${subject}`,
              description: `**From:** ${name} (\`${email}\`${phone ? ` · 📞 \`${phone}\`` : ""} · 🌐 \`${locale.toUpperCase()}\`)\n📍 ${geoSummary || "Unknown"} (IP: \`${ip}\`${networkSummary ? ` · ${networkSummary}` : ""})\n🛡️ **Shield:** ${shieldStatus}\n\n**Message:**\n${message.slice(0, 500)}`,
              color: isTurnstileVerified ? 0xd4af37 : 0x22d3ee,
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      }).catch(() => {});
      ctx.waitUntil(webhookPromise);
    }

    // Direct Email Notification Trigger to arturo@arturonavax.dev upon successful submission
    const emailBodyText =
      `Nuevo mensaje recibido en arturonavax.dev:\n\n` +
      `De: ${name} <${email}>\n` +
      (phone ? `Teléfono: ${phone}\n` : "") +
      `Idioma: ${locale.toUpperCase()}\n` +
      `Asunto / Área: ${subject}\n` +
      `Ubicación: ${geoSummary || "Desconocida"} (IP: ${ip}${networkSummary ? ` · ${networkSummary}` : ""})\n` +
      `Seguridad: ${shieldStatus}\n\n` +
      `Mensaje:\n${message}\n\n` +
      `---\n` +
      `Notificación automática enviada desde Cloudflare Worker (arturonavax.dev)`;

    if (ctx && typeof ctx.waitUntil === "function") {
      // 1. Cloudflare Workers SendEmail / Email Routing binding (Zero Cost)
      if (env.EMAIL && typeof (env.EMAIL as any).send === "function") {
        const sendEmailPromise = (async () => {
          try {
            const rawEmail = [
              `From: "Arturo Nava Portfolio" <contact-form@arturonavax.dev>`,
              `To: <arturo@arturonavax.dev>`,
              `Subject: [Lead Web] ${subject} - ${name}`,
              `Content-Type: text/plain; charset=utf-8`,
              "",
              emailBodyText,
            ].join("\r\n");

            let msg: any;
            try {
              const { EmailMessage } = await import("cloudflare:email");
              msg = new EmailMessage(
                "contact-form@arturonavax.dev",
                "arturo@arturonavax.dev",
                rawEmail,
              );
            } catch {
              // Fallback for unit testing environments where cloudflare:email is not bundled
              msg = {
                from: "contact-form@arturonavax.dev",
                to: "arturo@arturonavax.dev",
                raw: rawEmail,
              };
            }
            await (env.EMAIL as any).send(msg);
          } catch (err: unknown) {
            console.warn("[Email Trigger Send Warning - Fail-Open]:", err);
          }
        })();
        ctx.waitUntil(sendEmailPromise);
      }
    }

    // Telegram Push Notification Trigger (Available on demand, disabled by default unless ENABLE_TELEGRAM_NOTIFICATIONS === "true")
    if (
      env.ENABLE_TELEGRAM_NOTIFICATIONS === "true" &&
      env.TELEGRAM_BOT_TOKEN &&
      env.TELEGRAM_CHAT_ID &&
      ctx &&
      typeof ctx.waitUntil === "function"
    ) {
      const tgText =
        `🚀 *New Direct Lead: [Web] ${subject}*\n\n` +
        `👤 *From:* ${name}\n` +
        `📧 *Email:* \`${email}\`${phone ? `\n📞 *Phone:* \`${phone}\`` : ""}\n` +
        `🌐 *Locale:* \`${locale.toUpperCase()}\` | *Shield:* ${isTurnstileVerified ? "✅ Turnstile" : "🛡️ Fallback"}\n` +
        `📍 *Location:* ${geoSummary || "Unknown"} (IP: \`${ip}\`${networkSummary ? ` · ${networkSummary}` : ""})\n\n` +
        `💬 *Message:*\n${message.slice(0, 1000)}`;

      const tgPromise = fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: tgText,
            parse_mode: "Markdown",
          }),
        },
      ).catch(() => {});
      ctx.waitUntil(tgPromise);
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        message: "Thank you! Your message has been received.",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, private",
        },
      },
    );
  } catch {
    return new Response(
      JSON.stringify({
        status: "error",
        error: "Unable to process message at this time.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

export interface VisitorClassification {
  isBot: boolean;
  classification:
    | "human"
    | "verified_bot"
    | "search_crawler"
    | "ai_scraper"
    | "social_bot"
    | "automated_client";
  reason: string;
  confidence: number;
}

/**
 * Standard HTTP & Cloudflare Edge Visitor Classifier (Human vs Bot)
 *
 * Deterministically classifies ingress traffic into Human (P0) or Automated/Bot.
 * Uses available request signals and user-agent heuristics to distinguish likely humans,
 * crawlers, and automated clients. False positives and unknown bots remain possible;
 * classification is not a verified visitor identity or exhaustive bot census.
 *
 * Classification runs at the edge; the document path schedules analytics with waitUntil.
 * It adds no classification-specific client JavaScript.
 */
export function classifyVisitor(
  request: Request,
  pathname?: string,
): VisitorClassification {
  const checkPath =
    pathname ||
    (function () {
      try {
        return new URL(request.url).pathname;
      } catch {
        return "";
      }
    })();

  if (checkPath && isVulnerabilityScannerPath(checkPath)) {
    return {
      isBot: true,
      classification: "automated_client",
      reason: "vulnerability_scanner_path_probe",
      confidence: 1.0,
    };
  }

  // 1. Cloudflare Native Edge Telemetry Signals (Highest Authority)
  const cf = (request as unknown as { cf?: Record<string, any> }).cf;
  if (cf) {
    if (cf.verifiedBot === true || cf.botManagement?.verifiedBot === true) {
      return {
        isBot: true,
        classification: "verified_bot",
        reason: "cf_verified_bot",
        confidence: 1.0,
      };
    }

    if (
      typeof cf.botManagement?.score === "number" &&
      cf.botManagement.score < 30
    ) {
      return {
        isBot: true,
        classification: "automated_client",
        reason: "cf_bot_score_low",
        confidence: 0.95,
      };
    }
  }

  const rawUa = request.headers.get("user-agent");
  const userAgent = (rawUa || "").trim();
  const acceptHeader = (request.headers.get("accept") || "").toLowerCase();
  const secFetchDest = request.headers.get("sec-fetch-dest");

  // 2. Missing or Trivial User-Agent Check
  if (userAgent === "-" || userAgent === "null" || userAgent === "undefined") {
    return {
      isBot: true,
      classification: "automated_client",
      reason: "trivial_ua",
      confidence: 1.0,
    };
  }

  if (!userAgent) {
    if (
      acceptHeader.includes("text/html") ||
      secFetchDest === "document" ||
      request.url.includes("/api/telemetry/collect")
    ) {
      return {
        isBot: false,
        classification: "human",
        reason: "default_document_request",
        confidence: 0.9,
      };
    }
    return {
      isBot: true,
      classification: "automated_client",
      reason: "missing_or_empty_ua",
      confidence: 1.0,
    };
  }

  // 3. Search Engine Crawlers
  const SEARCH_CRAWLER_REGEX =
    /\b(?:googlebot|bingbot|bingpreview|slurp|duckduckbot|baiduspider|yandexbot|yandeximages|yandexaccessibilitybot|yandexmetrika|sogou|exabot|ia_archiver|seznambot|naverbot|daumoa|qwantify)\b/i;
  if (SEARCH_CRAWLER_REGEX.test(userAgent)) {
    return {
      isBot: true,
      classification: "search_crawler",
      reason: "search_engine_crawler",
      confidence: 1.0,
    };
  }

  // 4. AI Crawlers & Scrapers
  const AI_SCRAPER_REGEX =
    /\b(?:gptbot|chatgpt-user|claudebot|claude-web|anthropic-ai|perplexitybot|perplexity|bytespider|ccbot|diffbot|cohere-ai|omgilibot|facebookbot|meta-externalagent|amazonbot|youbot|applebot|timpibot|velenpublicwebcrawler|webzio)\b/i;
  if (AI_SCRAPER_REGEX.test(userAgent)) {
    return {
      isBot: true,
      classification: "ai_scraper",
      reason: "ai_training_crawler",
      confidence: 1.0,
    };
  }

  // 5. Social Platform & Link Preview Bots
  const SOCIAL_BOT_REGEX =
    /\b(?:facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|whatsapp|pinterestbot|vkshare|embedly|quora link preview|redditbot|skypeuripreview)\b/i;
  if (SOCIAL_BOT_REGEX.test(userAgent)) {
    return {
      isBot: true,
      classification: "social_bot",
      reason: "social_link_preview",
      confidence: 1.0,
    };
  }

  // 6. SEO Auditing, Monitoring, and Security Crawlers
  const SEO_AUDIT_REGEX =
    /\b(?:semrushbot|ahrefsbot|mj12bot|dotbot|rogerbot|screaming frog|siteauditbot|blexbot|petalbot|seekport|zoominfobot|barkrowler|criteobot|uptimebot|statuscake|pingdom|uptimerobot|nodeping)\b/i;
  if (SEO_AUDIT_REGEX.test(userAgent)) {
    return {
      isBot: true,
      classification: "search_crawler",
      reason: "seo_monitoring_crawler",
      confidence: 1.0,
    };
  }

  // 7. Headless Automation Frameworks
  const HEADLESS_AUTOMATION_REGEX =
    /\b(?:headlesschrome|phantomjs|selenium|playwright|puppeteer|cypress|webdriver|nightwatch|casperjs|htmlunit)\b/i;
  if (HEADLESS_AUTOMATION_REGEX.test(userAgent)) {
    return {
      isBot: true,
      classification: "automated_client",
      reason: "headless_browser",
      confidence: 1.0,
    };
  }

  // 8. Known CLI Tools, HTTP Libraries & Scripting Frameworks
  const CLI_HTTP_CLIENT_REGEX =
    /\b(?:curl|wget|python-requests|requests|python-urllib|urllib|aiohttp|httpx|httpclient|okhttp|axios|node-fetch|got|superagent|undici|go-http-client|java|apache-httpclient|postmanruntime|insomnia|libwww-perl|mechanize|restsharp|scrapy|feedly|replicate|faraday|guzzlehttp|winhttp|http_request)\b/i;
  if (CLI_HTTP_CLIENT_REGEX.test(userAgent)) {
    return {
      isBot: true,
      classification: "automated_client",
      reason: "cli_or_script_client",
      confidence: 1.0,
    };
  }

  // 8b. Suspiciously short user agents that are not standard browsers or CLI tools
  if (
    userAgent.length < 16 &&
    !/^(safari|chrome|firefox|curl|wget)/i.test(userAgent)
  ) {
    return {
      isBot: true,
      classification: "automated_client",
      reason: "trivial_ua",
      confidence: 0.95,
    };
  }

  // 9. Generic Bot Pattern with False Positive Exclusions
  // Exclude CUBOT mobile brand and YaBrowser (Yandex Browser)
  const isCubot = /cubot/i.test(userAgent);
  const isYaBrowser = /yabrowser|yandex\//i.test(userAgent);

  if (!isCubot && !isYaBrowser) {
    const GENERIC_BOT_REGEX = /(?:^|[^\w])(?:bot|spider|crawler)(?:[^\w]|$)/i;
    if (GENERIC_BOT_REGEX.test(userAgent)) {
      return {
        isBot: true,
        classification: "automated_client",
        reason: "generic_bot_token",
        confidence: 0.9,
      };
    }
  }

  // 10. Human Browser Whitelisting & Anti-Spoofing Checks
  const hasBrowserEngine =
    /applewebkit|gecko|trident|blink|chrome|safari|firefox|edg|opr|yabrowser|samsungbrowser/i.test(
      userAgent,
    );
  const hasOperatingSystem =
    /windows nt|macintosh|android|iphone|ipad|linux|cros|x11/i.test(userAgent);

  const acceptLanguage = request.headers.get("accept-language");
  const secFetchUser = request.headers.get("sec-fetch-user");
  const secChUa = request.headers.get("sec-ch-ua");

  // Anti-Spoofing Check: A client claiming to be a major browser (Chrome/Safari/Firefox)
  // but sending Accept: */* (or no Accept) AND missing Accept-Language AND missing all Sec-Fetch/Sec-CH headers
  if (
    hasBrowserEngine &&
    hasOperatingSystem &&
    !acceptLanguage &&
    !secFetchDest &&
    !secChUa &&
    (!acceptHeader || acceptHeader === "*/*")
  ) {
    return {
      isBot: true,
      classification: "automated_client",
      reason: "spoofed_browser_missing_headers",
      confidence: 0.95,
    };
  }

  // Verified Human Signals
  if (secFetchUser === "?1") {
    return {
      isBot: false,
      classification: "human",
      reason: "user_gesture_navigation",
      confidence: 1.0,
    };
  }

  if (
    typeof cf?.botManagement?.score === "number" &&
    cf.botManagement.score >= 80
  ) {
    return {
      isBot: false,
      classification: "human",
      reason: "cf_high_trust_score",
      confidence: 1.0,
    };
  }

  if (
    hasBrowserEngine &&
    (hasOperatingSystem || acceptLanguage || secFetchDest === "document")
  ) {
    return {
      isBot: false,
      classification: "human",
      reason: "verified_human_browser",
      confidence: 0.99,
    };
  }

  // Fallback for general navigation
  if (acceptLanguage || acceptHeader.includes("text/html")) {
    return {
      isBot: false,
      classification: "human",
      reason: "browser_accept_language",
      confidence: 0.95,
    };
  }

  return {
    isBot: true,
    classification: "automated_client",
    reason: "unknown_non_browser_client",
    confidence: 0.85,
  };
}

const TELEMETRY_PATH_REGEX = /^\/[A-Za-z0-9\-._~/%]{0,199}$/;

/**
 * Lightweight SPA View Transitions & bfcache Beacon Collector (`POST /api/telemetry/collect`)
 * Protected by L1 Cache API 30-minute deduplication and 5-tier quota degradation.
 */
async function handleTelemetryCollectBeacon(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  isPrefetch: boolean,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const jsonHeaders = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, private",
  };

  if (isPrefetch) {
    return new Response(
      JSON.stringify({
        recorded: false,
        deduped: true,
        storageTier: "L1_CACHE",
      }),
      { status: 202, headers: jsonHeaders },
    );
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin") {
    return new Response(
      JSON.stringify({ error: "Forbidden: cross-origin telemetry rejected" }),
      { status: 403, headers: jsonHeaders },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 1024) {
    return new Response(JSON.stringify({ error: "Payload Too Large" }), {
      status: 413,
      headers: jsonHeaders,
    });
  }

  try {
    const raw = await request.text();
    if (raw.length > 1024) {
      return new Response(JSON.stringify({ error: "Payload Too Large" }), {
        status: 413,
        headers: jsonHeaders,
      });
    }
    const payload = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    const rawPath = String(payload.path || "/");
    if (
      rawPath.length > 180 ||
      /[<>{}\\\^`|]/.test(rawPath) ||
      !TELEMETRY_PATH_REGEX.test(rawPath) ||
      isVulnerabilityScannerPath(rawPath) ||
      STATIC_EXT_REGEX.test(rawPath)
    ) {
      return new Response(
        JSON.stringify({
          recorded: false,
          deduped: false,
          storageTier: "L1_CACHE",
          error: "Invalid or oversized telemetry path",
        }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const normalizedPath = normalizeTelemetryPath(rawPath);
    const eventTypeRaw = String(
      payload.trigger || payload.eventType || "spa_transition",
    );
    const eventType: "pageview" | "spa_transition" | "bfcache" | "beacon" =
      eventTypeRaw === "bfcache" ||
      eventTypeRaw === "pageview" ||
      eventTypeRaw === "beacon"
        ? eventTypeRaw
        : "spa_transition";

    const visitorInfo = classifyVisitor(request, normalizedPath);
    const userAgent = request.headers.get("user-agent") || "";
    if (visitorInfo.isBot) {
      if (
        !botCircuitBreaker.canRecordBot(
          env as unknown as Record<string, unknown>,
          userAgent,
          visitorInfo.classification,
        )
      ) {
        return new Response(
          JSON.stringify({
            ok: true,
            recorded: false,
            deduped: true,
            deduplicated: true,
            storageTier: "L1_CACHE",
          }),
          { status: 202, headers: jsonHeaders },
        );
      }
      botCircuitBreaker.recordBot();
    }

    const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    const visitorHash = await computeVisitorHash(ip, userAgent);
    const dimensions = visitDimensions(request);
    const country = dimensions.country;
    const attribution = parseAttribution(
      request.url,
      String(payload.referrer || request.headers.get("referer") || ""),
    );

    const adapter = new D1TelemetryAdapter(env.DB, env, ctx);
    const nowMs = Date.now();
    const bucket = Math.floor(nowMs / PAGEVIEW_DEDUPE_WINDOW_MS);
    const [dashboardKey, previousDashboardKey] = await Promise.all([
      computeDedupeKey(visitorHash, normalizedPath, bucket),
      computeDedupeKey(visitorHash, normalizedPath, bucket - 1),
    ]);
    const result = await adapter.ingestVisit({
      path: normalizedPath,
      visitorHash,
      ip,
      userAgent,
      eventType,
      isBot: visitorInfo.isBot,
      botName: visitorInfo.isBot ? visitorInfo.reason : null,
      country,
      region: dimensions.region,
      browser: dimensions.browser,
      browserLanguage: dimensions.browserLanguage,
      deviceType: dimensions.deviceType,
      referrerHost: attribution.referrer,
      statusCode: 200,
      nowMs,
      dashboard: {
        path: rawPath,
        dedupeKey: dashboardKey,
        previousDedupeKey: previousDashboardKey,
        source: attribution.source || "direct",
        medium: attribution.medium || "none",
        campaign: attribution.campaign || "",
        content: attribution.content,
        term: attribution.term,
      },
    });

    if (result.recorded) {
      prefetchCircuitBreaker.recordVisit();
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 202,
      headers: jsonHeaders,
    });
  } catch {
    return new Response(
      JSON.stringify({
        ok: true,
        recorded: false,
        deduped: false,
        storageTier: "L1_CACHE",
      }),
      { status: 202, headers: jsonHeaders },
    );
  }
}

/**
 * Cached O(1) Views Counter Read Endpoint (`GET /api/telemetry/views?path=/...`)
 * Queries `analytics_rollups` (1 indexed row read) and caches in `caches.default` for 60s.
 */
async function handleTelemetryViewsRead(
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  const rawPath = url.searchParams.get("path") || "/";
  const normalizedPath = normalizeTelemetryPath(rawPath);
  const cache = getDefaultCache();
  const cacheKey = new Request(
    `https://arturonavax.dev/__cf_edge_views?path=${encodeURIComponent(normalizedPath)}`,
    { method: "GET" },
  );

  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const clone = hit.clone();
        const headers = new Headers(clone.headers);
        headers.set("X-Telemetry-Cache", "HIT");
        return new Response(clone.body, { status: 200, headers });
      }
    } catch {
      // Ignore cache lookup failure
    }
  }

  // Tier 3+ Survival Mode: Zero D1 reads
  if (
    edgeQuotaTracker.getTier() >= QuotaDegradationTier.CRITICAL_SURVIVAL ||
    !env.DB
  ) {
    return new Response(
      JSON.stringify({
        path: normalizedPath,
        views: 0,
        cached: true,
        degraded: true,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  }

  let views = 0;
  try {
    const stmt = env.DB.prepare(
      "SELECT COALESCE(SUM(views), 0) AS total_views FROM analytics_rollups WHERE path = ?",
    ).bind(normalizedPath);
    const res =
      typeof (stmt as any).all === "function"
        ? await (stmt as any).all()
        : await stmt.all();
    const rows = (res.results || []) as Array<{ total_views?: number }>;
    views = Number(rows[0]?.total_views || 0);
    edgeQuotaTracker.recordD1Meta(res.meta, 0, 1);

    if (views === 0) {
      try {
        const fallbackStmt = env.DB.prepare(
          "SELECT COUNT(*) AS total_views FROM pageviews WHERE (path = ? OR path = ?) AND is_bot = 0",
        ).bind(normalizedPath, `${normalizedPath}/`);
        const fallbackRes =
          typeof (fallbackStmt as any).all === "function"
            ? await (fallbackStmt as any).all()
            : await fallbackStmt.all();
        const fbRows = (fallbackRes.results || []) as Array<{
          total_views?: number;
        }>;
        views = Number(fbRows[0]?.total_views || 0);
      } catch {
        // Ignore fallback failure
      }
    }
  } catch (err) {
    if (isD1QuotaException(err)) {
      edgeQuotaTracker.tripCircuitBreaker(String(err), undefined, ctx);
    }
  }

  const response = new Response(
    JSON.stringify({
      path: normalizedPath,
      views,
      cached: false,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
        "X-Telemetry-Cache": "MISS",
      },
    },
  );

  if (cache && ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  } else if (cache) {
    await cache.put(cacheKey, response.clone());
  }

  return response;
}

/**
 * R2 Storage Asset Handler via Workers Cache API (SPEC-003, SPEC-004 REQ-EDG-03)
 */
async function handleCdnStorageAsset(
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

  // Preserve the R2 streaming fast path and the exact byte range of views.
  // Only SharedArrayBuffer-backed views need an owned ArrayBuffer copy for BodyInit.
  const body = item.data instanceof Uint8Array
    ? item.data.buffer instanceof ArrayBuffer
      ? new Uint8Array(item.data.buffer, item.data.byteOffset, item.data.byteLength)
      : new Uint8Array(item.data)
    : item.data;
  return new Response(body, {
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

export interface AdminAuthResult {
  authorized: boolean;
  status?: number;
  email?: string;
  method: "cf_access" | "admin_token" | "local_dev" | "none";
  reason?: string;
}

export interface AdminAccessResult {
  authorized: boolean;
  status: 200 | 401 | 403;
  reason?: string;
  email?: string;
  method?: "cf_access" | "admin_token";
}

interface JwksCacheEntry {
  expiresAt: number;
  keys: any[];
}
const jwksMemoryCache = new Map<string, JwksCacheEntry>();

export function base64UrlDecode(str: string): Uint8Array<ArrayBuffer> {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function timingSafeEqualSha256(
  a: string,
  b: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const aDigest = await crypto.subtle.digest("SHA-256", encoder.encode(a));
  const bDigest = await crypto.subtle.digest("SHA-256", encoder.encode(b));
  const aView = new Uint8Array(aDigest);
  const bView = new Uint8Array(bDigest);
  if (aView.byteLength !== bView.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aView.byteLength; i++) {
    diff |= aView[i]! ^ bView[i]!;
  }
  return diff === 0;
}

export async function fetchJwksWithCache(
  teamDomain: string,
): Promise<any[] | null> {
  const nowSec = Math.floor(Date.now() / 1000);
  const cachedMem = jwksMemoryCache.get(teamDomain);
  if (cachedMem && cachedMem.expiresAt > nowSec) {
    return cachedMem.keys;
  }

  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
  let keys: any[] | null = null;

  try {
    const cache = (caches as any)?.default;
    if (cache) {
      const cacheKey = new Request(certsUrl);
      const cachedResp = await cache.match(cacheKey);
      if (cachedResp) {
        const data = (await cachedResp.json()) as { keys?: any[] };
        if (data?.keys && Array.isArray(data.keys)) {
          keys = data.keys;
        }
      }
    }
  } catch {
    // Fail-open to direct fetch
  }

  if (!keys) {
    try {
      const resp = await fetch(certsUrl);
      if (resp.ok) {
        const data = (await resp.json()) as { keys?: any[] };
        if (data?.keys && Array.isArray(data.keys)) {
          keys = data.keys;
          try {
            const cache = (caches as any)?.default;
            if (cache) {
              const toCache = new Response(JSON.stringify(data), {
                headers: {
                  "Content-Type": "application/json",
                  "Cache-Control": "public, max-age=3600",
                },
              });
              await cache.put(new Request(certsUrl), toCache);
            }
          } catch {}
        }
      }
    } catch {}
  }

  if (keys) {
    jwksMemoryCache.set(teamDomain, {
      expiresAt: nowSec + 3600,
      keys,
    });
  }

  return keys;
}

export async function verifyCloudflareAccessJwt(
  jwt: string,
  teamDomain: string,
  expectedAud: string,
  allowedEmail?: string,
): Promise<{ valid: boolean; email?: string; reason?: string }> {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      return { valid: false, reason: "Malformed JWT" };
    }
    const [headerB64, payloadB64, sigB64] = parts;
    const headerStr = new TextDecoder().decode(base64UrlDecode(headerB64!));
    const payloadStr = new TextDecoder().decode(base64UrlDecode(payloadB64!));
    const header = JSON.parse(headerStr);
    const payload = JSON.parse(payloadStr);

    const audValid = Array.isArray(payload.aud)
      ? payload.aud.includes(expectedAud)
      : payload.aud === expectedAud;
    if (!audValid) {
      return { valid: false, reason: "JWT audience mismatch" };
    }

    const expectedIss = `https://${teamDomain}`;
    if (payload.iss !== expectedIss) {
      return { valid: false, reason: "JWT issuer mismatch" };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
      return { valid: false, reason: "JWT expired" };
    }

    if (allowedEmail) {
      const email =
        typeof payload.email === "string"
          ? payload.email.toLowerCase().trim()
          : "";
      const allowed = allowedEmail
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      if (!allowed.includes(email)) {
        return {
          valid: false,
          reason: `Email ${payload.email} is not authorized`,
        };
      }
    }

    const keys = await fetchJwksWithCache(teamDomain);
    if (!keys || keys.length === 0) {
      return { valid: false, reason: "Unable to retrieve Access public certs" };
    }

    const matchingKey = keys.find((k: any) => k.kid === header.kid);
    if (!matchingKey) {
      return { valid: false, reason: `Key ID ${header.kid} not found in JWKS` };
    }

    const rsaKey = await crypto.subtle.importKey(
      "jwk",
      matchingKey,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: { name: "SHA-256" },
      },
      false,
      ["verify"],
    );

    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sigBytes = base64UrlDecode(sigB64!);

    const sigValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      rsaKey,
      sigBytes,
      signedData,
    );

    if (!sigValid) {
      return { valid: false, reason: "Invalid cryptographic signature" };
    }

    return {
      valid: true,
      email: payload.email || "access-jwt@arturonavax.dev",
    };
  } catch (err) {
    return {
      valid: false,
      reason: `JWT verification error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function verifyAdminAccess(
  request: Request,
  env: Env,
): Promise<AdminAccessResult> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const expectedAud = env.CF_ACCESS_AUD?.trim();
  const hasCfAccessConfig = Boolean(teamDomain && expectedAud);

  const configuredToken = (
    env.ADMIN_ACCESS_TOKEN ||
    env.ADMIN_API_KEY ||
    ""
  ).trim();
  const hasTokenConfig = configuredToken.length >= 20;

  const requireAuth =
    env.REQUIRE_CF_ACCESS === "true" ||
    (env.REQUIRE_CF_ACCESS as any) === true ||
    env.REQUIRE_ADMIN_AUTH === "true" ||
    (env.REQUIRE_ADMIN_AUTH as any) === true;

  // Fail-Closed Rule: If neither Cloudflare Access nor ADMIN_ACCESS_TOKEN nor requireAuth is configured in env,
  // ALWAYS return { authorized: false, status: 403, reason: 'Admin authentication not configured' }.
  if (!hasCfAccessConfig && !hasTokenConfig && !requireAuth) {
    return {
      authorized: false,
      status: 403,
      reason: "Admin authentication not configured",
    };
  }

  // Method A — Cloudflare Access JWT (Cf-Access-Jwt-Assertion header or CF_Authorization cookie)
  let cfJwt = request.headers.get("cf-access-jwt-assertion");
  if (!cfJwt) {
    const cookieHeader = request.headers.get("cookie") || "";
    const match = cookieHeader.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    if (match) {
      try {
        cfJwt = decodeURIComponent(match[1]!.trim());
      } catch {
        // Malformed cookies are untrusted input, never authentication evidence.
        cfJwt = null;
      }
    }
  }

  if (hasCfAccessConfig && cfJwt) {
    const allowedEmail = env.ADMIN_ALLOWED_EMAIL || env.ADMIN_AUTHORIZED_EMAILS;
    const jwtResult = await verifyCloudflareAccessJwt(
      cfJwt,
      teamDomain!,
      expectedAud!,
      allowedEmail,
    );
    if (jwtResult.valid) {
      return {
        authorized: true,
        status: 200,
        method: "cf_access",
        ...(jwtResult.email !== undefined ? { email: jwtResult.email } : {}),
      };
    }
  }

  // Method B — Constant-Time Bearer / Header Token (Authorization: Bearer <token> or X-Admin-Token)
  if (hasTokenConfig) {
    let candidateToken: string | null = null;
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      candidateToken = authHeader.slice(7).trim();
    } else if (request.headers.get("x-admin-token")) {
      candidateToken = request.headers.get("x-admin-token")?.trim() || null;
    } else {
      const cookieHeader = request.headers.get("cookie") || "";
      const matchCookie = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);
      if (matchCookie) {
        candidateToken = decodeURIComponent(matchCookie[1]!.trim());
      } else {
        try {
          const u = new URL(request.url);
          candidateToken =
            u.searchParams.get("token") || u.searchParams.get("admin_token");
        } catch {}
      }
    }

    if (candidateToken) {
      const isValid = await timingSafeEqualSha256(
        candidateToken,
        configuredToken,
      );
      if (isValid) {
        return {
          authorized: true,
          status: 200,
          method: "admin_token",
          email: "token-admin@arturonavax.dev",
        };
      }
    }
  }

  return {
    authorized: false,
    status: 401,
    reason:
      "Cloudflare Access Zero Trust authentication required to access admin surface.",
  };
}

export async function verifyAdminAuthorization(
  request: Request,
  env: Env,
): Promise<AdminAuthResult> {
  const res = await verifyAdminAccess(request, env);
  return {
    authorized: res.authorized,
    status: res.status,
    ...(res.email !== undefined ? { email: res.email } : {}),
    method: res.method || "none",
    ...(res.reason !== undefined ? { reason: res.reason } : {}),
  };
}

export function isProtectedApiSurface(
  normalizedLowerPath: string,
  method: string,
): boolean {
  if (/^\/api\/admin(?:\/|$)/.test(normalizedLowerPath)) return true;
  if (/^\/api\/(?:deployments|quota|leads)(?:\/|$)/.test(normalizedLowerPath))
    return true;
  if (
    normalizedLowerPath === "/api/metrics" ||
    normalizedLowerPath === "/api/telemetry" ||
    normalizedLowerPath === "/api/status" ||
    normalizedLowerPath === "/status"
  ) {
    return true;
  }
  if (normalizedLowerPath.startsWith("/api/telemetry/")) {
    if (normalizedLowerPath === "/api/telemetry/collect") {
      return method !== "POST" && method !== "OPTIONS";
    }
    if (normalizedLowerPath === "/api/telemetry/views") {
      return method !== "GET" && method !== "OPTIONS";
    }
    return true;
  }
  return false;
}

/**
 * Clean, dark-mode 401 challenge screen for unauthorized admin access (Zero telemetry leakage)
 */
export function renderAdminUnauthorizedHtml(
  _reason?: string,
  status: number = 401,
): Response {
  const html = `<!doctype html>
<html lang="es" data-theme="dark" class="dark">
<head>
  <meta charset="utf-8" />
  <title>401 Acceso Restringido // Admin Zero Trust - arturonavax.dev</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    :root {
      --bg: #0a0203;
      --bg-surface: #120305;
      --card: #180406;
      --border: #521317;
      --gold: #d48b38;
      --gold-light: #f3c77c;
      --text: #f5f5f5;
      --text-dim: #999;
      --red: #ef4444;
      --green: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .auth-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 4px;
      max-width: 520px;
      width: 100%;
      padding: 2.25rem;
      box-shadow: 0 10px 40px rgba(0,0,0,0.8);
    }
    .auth-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 0.35rem 0.75rem;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: var(--red);
      border-radius: 2px;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 0.75rem;
      letter-spacing: -0.02em;
    }
    p {
      font-size: 0.85rem;
      line-height: 1.6;
      color: var(--text-dim);
      margin-bottom: 1.5rem;
    }
    .btn-access {
      display: block;
      width: 100%;
      text-align: center;
      background: var(--gold);
      color: #0a0203;
      font-weight: 700;
      font-size: 0.85rem;
      padding: 0.85rem 1.25rem;
      border-radius: 3px;
      text-decoration: none;
      transition: background 0.2s ease;
      margin-bottom: 1.5rem;
    }
    .btn-access:hover {
      background: var(--gold-light);
    }
    .divider {
      display: flex;
      align-items: center;
      text-align: center;
      margin: 1.5rem 0;
      color: var(--border);
      font-size: 0.75rem;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid var(--border);
    }
    .divider span {
      padding: 0 0.75rem;
      color: var(--text-dim);
    }
    .token-form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .token-input {
      width: 100%;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.75rem;
      font-size: 0.85rem;
      font-family: inherit;
      border-radius: 3px;
    }
    .token-input:focus {
      outline: none;
      border-color: var(--gold);
    }
    .btn-token {
      background: transparent;
      border: 1px solid var(--gold);
      color: var(--gold);
      font-weight: 600;
      padding: 0.75rem;
      font-size: 0.85rem;
      font-family: inherit;
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn-token:hover {
      background: var(--gold);
      color: #0a0203;
    }
    .footer-note {
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      font-size: 0.72rem;
      color: var(--text-dim);
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="auth-card">
    <div class="auth-badge">
      <span>●</span> 401 UNAUTHORIZED // ZERO TRUST ENFORCED
    </div>
    <h1>Acceso Restringido</h1>
    <p>Esta superficie administrativa está estrictamente aislada y protegida. Se requiere una sesión activa de Cloudflare Zero Trust con correo autorizado o una clave de administrador válida.</p>
    
    <div id="cf-detected-notice" style="display:none; margin-bottom:1.25rem; padding:0.75rem 1rem; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.4); border-radius:3px; font-size:0.8rem; color:#10b981; line-height:1.4;">
      <span style="font-weight:700;">● Sesión Cloudflare Zero Trust detectada.</span><br />
      Ingresando a la consola administrativa...
    </div>

    <a href="https://orange-art-1302.cloudflareaccess.com/cdn-cgi/access/login/admin.arturonavax.dev" class="btn-access" id="btn-cf-login">
      Autenticar con Cloudflare Zero Trust
    </a>

    <div class="divider"><span>o ingresar con token de acceso</span></div>

    <form class="token-form" id="token-auth-form">
      <input type="password" id="token-input" class="token-input" placeholder="Ingresar ADMIN_API_KEY..." autocomplete="current-password" required />
      <button type="submit" class="btn-token" id="btn-token-submit">Desbloquear Consola</button>
      <div id="token-feedback" style="display:none; font-size:0.75rem; color:#ef4444; margin-top:0.25rem; line-height:1.4;"></div>
    </form>

    <div class="footer-note">
      <span>arturonavax.dev / admin</span>
      <span>RFC 9110 § 15.5.2</span>
    </div>
  </div>

  <script>
    (function () {
      var host = window.location.hostname;
      var isApex = host !== "admin.arturonavax.dev";

      // 1. Intelligent Cloudflare Access Session Detection across subdomains
      if (isApex && (host === "arturonavax.dev" || host.endsWith(".arturonavax.dev"))) {
        fetch("https://admin.arturonavax.dev/api/status", {
          credentials: "include",
          headers: { "Accept": "application/json" }
        })
          .then(function (res) {
            if (res.ok) {
              var notice = document.getElementById("cf-detected-notice");
              if (notice) notice.style.display = "block";
              window.location.replace("https://admin.arturonavax.dev/");
            }
          })
          .catch(function () {});
      }

      // 2. Token Authentication Form Submission with validation
      var form = document.getElementById("token-auth-form");
      if (form) {
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          var input = document.getElementById("token-input");
          var btn = document.getElementById("btn-token-submit");
          var feedback = document.getElementById("token-feedback");
          var token = (input ? input.value : "").trim();
          if (!token) return;

          if (btn) {
            btn.disabled = true;
            btn.textContent = "Verificando token...";
          }
          if (feedback) feedback.style.display = "none";

          fetch("/api/status", {
            headers: { "Authorization": "Bearer " + token }
          })
            .then(function (res) {
              if (res.ok) {
                var sec = window.location.protocol === "https:" ? "; Secure" : "";
                var domainAttr = host.endsWith("arturonavax.dev") ? "; Domain=.arturonavax.dev" : "";
                document.cookie = "admin_session=" + encodeURIComponent(token) + "; Path=/; Max-Age=86400; SameSite=Lax" + sec + domainAttr;
                if (btn) {
                  btn.textContent = "✓ Consola Desbloqueada";
                  btn.style.borderColor = "#10b981";
                  btn.style.color = "#10b981";
                }
                setTimeout(function () {
                  window.location.reload();
                }, 150);
              } else {
                if (feedback) {
                  feedback.textContent = "Clave de administrador incorrecta o inválida.";
                  feedback.style.display = "block";
                }
                if (btn) {
                  btn.disabled = false;
                  btn.textContent = "Desbloquear Consola";
                }
              }
            })
            .catch(function () {
              var sec = window.location.protocol === "https:" ? "; Secure" : "";
              var domainAttr = host.endsWith("arturonavax.dev") ? "; Domain=.arturonavax.dev" : "";
              document.cookie = "admin_session=" + encodeURIComponent(token) + "; Path=/; Max-Age=86400; SameSite=Lax" + sec + domainAttr;
              window.location.reload();
            });
        });
      }
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
      "WWW-Authenticate": 'Bearer realm="admin.arturonavax.dev"',
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
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
  if (env) {
    edgeQuotaTracker.configureFromEnv(
      env as unknown as Record<string, unknown>,
    );
  }

  // Strict verification of Cloudflare Access Zero Trust & Admin Token
  const auth = await verifyAdminAuthorization(request, env);
  if (!auth.authorized) {
    const acceptHeader = request.headers.get("accept") || "";
    const isHtml = acceptHeader.includes("text/html");

    if (isHtml && !url.pathname.startsWith("/api/")) {
      return renderAdminUnauthorizedHtml(auth.reason, auth.status || 401);
    }

    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        status: auth.status || 401,
        message:
          auth.reason ||
          "Cloudflare Access Zero Trust authentication required to access admin surface.",
        docs: "https://developers.cloudflare.com/cloudflare-one/access-controls/",
      }),
      {
        status: auth.status || 401,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
          "WWW-Authenticate": 'Bearer realm="admin.arturonavax.dev"',
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      },
    );
  }

  return handleAuthorizedAdminRequest(request, env, ctx);
}

// Only the verified fetch branch or the exported handler after verification calls this closure.
async function handleAuthorizedAdminRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  edgeQuotaTracker.configureFromEnv(env as unknown as Record<string, unknown>);
  if (url.pathname === "/status" || url.pathname === "/api/status") {
    const registry = new DeploymentRegistry(env.DB);
    const activeDeployment = await registry.getActiveDeployment();
    const origin = request.headers.get("origin") || "";
    const isAllowedOrigin =
      origin === "https://arturonavax.dev" ||
      origin === "https://admin.arturonavax.dev" ||
      origin.endsWith(".arturonavax.dev") ||
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:");
    const statusHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, private",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    };
    if (isAllowedOrigin) {
      statusHeaders["Access-Control-Allow-Origin"] = origin;
      statusHeaders["Access-Control-Allow-Credentials"] = "true";
      statusHeaders["Vary"] = "Origin";
    }
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
        headers: statusHeaders,
      },
    );
  }

  if (url.pathname === "/api/deployments") {
    const now = Date.now();
    const isFresh =
      url.searchParams.get("fresh") === "true" ||
      url.searchParams.get("refresh") === "1";

    if (
      !isFresh &&
      cachedDeploymentsSnapshot &&
      cachedDeploymentsSnapshot.dbRef === env.DB &&
      now - cachedDeploymentsSnapshot.timestamp < TELEMETRY_CACHE_TTL_MS
    ) {
      return new Response(JSON.stringify(cachedDeploymentsSnapshot.data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, no-store",
          "X-Telemetry-Source": "edge-memory-cache",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      });
    }

    let deployments: unknown[] = [];
    if (
      env.DB &&
      edgeQuotaTracker.getTier(now) < QuotaDegradationTier.CRITICAL_SURVIVAL
    ) {
      const registry = new DeploymentRegistry(env.DB);
      deployments = await registry.listDeployments(20);
      edgeQuotaTracker.recordRead(deployments.length || 1, now);
    }

    const deploymentsPayload = { deployments };
    cachedDeploymentsSnapshot = {
      timestamp: now,
      data: deploymentsPayload,
      dbRef: env.DB,
    };

    return new Response(JSON.stringify(deploymentsPayload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  const buildUnifiedQuotas = (
    dailyWrites: number,
    dailyReads: number,
  ) => {
    const quotaConfig = edgeQuotaTracker.getConfig();
    const trackerSnap = edgeQuotaTracker.getSnapshot();
    const effectiveWrites = Math.max(dailyWrites, trackerSnap.dailyWrites);
    const effectiveReads = Math.max(dailyReads, trackerSnap.dailyReads);
    // Provider usage is not available through local request/D1 counters.
    const monthlyUsed = null;

    const workersDailyLimit = Number.isFinite(quotaConfig.workersDailyBudget)
      ? quotaConfig.workersDailyBudget
      : 100_000;
    const workersMonthlyLimit = workersDailyLimit * 30;
    const d1ReadsDailyLimit = Number.isFinite(quotaConfig.dailyReadBudget)
      ? quotaConfig.dailyReadBudget
      : 5_000_000;
    const d1WritesDailyLimit = Number.isFinite(quotaConfig.dailyWriteBudget)
      ? quotaConfig.dailyWriteBudget
      : 100_000;

    const isWritesExceeded = effectiveWrites >= d1WritesDailyLimit;
    const isReadsExceeded = effectiveReads >= d1ReadsDailyLimit;
    const isWorkersExceeded = null; // Provider request usage is unavailable.

    const degradationTier = isWritesExceeded ? 4 : trackerSnap.tier;
    const degradationTierName = isWritesExceeded
      ? "R2_WAL_FALLBACK"
      : trackerSnap.tierName;

    return {
      plan_tier: quotaConfig.planTier,
      degradation_tier: degradationTier,
      degradation_tier_name: degradationTierName,
      is_d1_writes_exceeded: isWritesExceeded,
      is_d1_reads_exceeded: isReadsExceeded,
      is_workers_exceeded: isWorkersExceeded,
      strategy: {
        plan_tier: quotaConfig.planTier,
        daily_write_budget: d1WritesDailyLimit,
        daily_read_budget: d1ReadsDailyLimit,
        workers_daily_budget: workersDailyLimit,
        conservative_ratio: quotaConfig.conservativeRatio,
        compact_ratio: quotaConfig.compactRatio,
        survival_ratio: quotaConfig.survivalRatio,
        wal_ratio: quotaConfig.walRatio,
        bot_budget_ratio: quotaConfig.botBudgetRatio,
        prefetch_budget_ratio: quotaConfig.prefetchBudgetRatio,
        visit_budget_ratio: quotaConfig.visitBudgetRatio,
        prefetch_sample_rate: quotaConfig.prefetchSampleRate,
      },
      usage_evidence: { workers: "unavailable", d1: "local_estimate", r2: "unavailable", ai: "unavailable", vectorize: "unavailable", pages: "unavailable", zero_trust: "unavailable" },
      workers_requests: {
        daily_used: null,
        daily_limit: workersDailyLimit,
        monthly_used: monthlyUsed,
        monthly_limit: workersMonthlyLimit,
        reset: "00:00 UTC",
        unit: "requests",
      },
      d1_operations: {
        reads_today: effectiveReads,
        reads_daily_limit: d1ReadsDailyLimit,
        writes_today: effectiveWrites,
        writes_daily_limit: d1WritesDailyLimit,
        is_exceeded: isWritesExceeded,
        exceeded_by: Math.max(0, effectiveWrites - d1WritesDailyLimit),
        storage_mb: null,
        storage_limit_mb: 500,
        unit: "rows",
      },
      r2_storage: {
        class_a_monthly_used: null,
        class_a_monthly_limit: 1000000,
        class_b_monthly_used: null,
        class_b_monthly_limit: 10000000,
        storage_gb: null,
        storage_limit_gb: 10,
        used_gb: null,
        limit_gb: 10,
        unit: "operations",
      },
      zero_trust: {
        active_seats: null,
        total_seats: 50,
        unit: "seats",
      },
      workers_ai: {
        neurons_today: null,
        neurons_daily_limit: 10000,
        unit: "neurons",
      },
      pages_deployments: {
        builds_monthly_used: null,
        builds_monthly_limit: 500,
        unit: "builds",
      },
      vectorize: {
        dimensions_monthly_used: null,
        dimensions_monthly_limit: 5000000,
        queries_monthly_used: null,
        queries_monthly_limit: 5000000,
        unit: "dimensions",
      },
      // Flat fields are part of the current /admin UI renderQuotas() API contract.
      workers_daily: {
        used: null,
        limit: workersDailyLimit,
        is_exceeded: isWorkersExceeded,
      },
      workers_monthly: { used: monthlyUsed, limit: workersMonthlyLimit },
      d1_reads_daily: {
        used: effectiveReads,
        limit: d1ReadsDailyLimit,
        is_exceeded: isReadsExceeded,
      },
      d1_writes_daily: {
        used: effectiveWrites,
        limit: d1WritesDailyLimit,
        is_exceeded: isWritesExceeded,
      },
      d1_storage: {
        used_mb: null,
        limit_mb: 500,
        limit_gb: 0.5,
        scope: "per_database",
      },
      r2_class_a_monthly: { used: null, limit: 1000000 },
      r2_class_b_monthly: { used: null, limit: 10000000 },
      zero_trust_seats: { used: null, limit: 50 },
      workers_ai_daily: { used: null, limit: 10000 },
      vectorize_monthly: { used: null, limit: 5000000 },
      pages_builds_monthly: { used: null, limit: 500 },
    };
  };

  if (url.pathname === "/api/metrics") {
    const now = Date.now();
    const isFresh =
      url.searchParams.get("fresh") === "true" ||
      url.searchParams.get("refresh") === "1";

    if (
      !isFresh &&
      cachedMetricsSnapshot &&
      cachedMetricsSnapshot.dbRef === env.DB &&
      now - cachedMetricsSnapshot.timestamp < TELEMETRY_CACHE_TTL_MS
    ) {
      return new Response(JSON.stringify(cachedMetricsSnapshot.data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, no-store",
          "X-Telemetry-Source": "edge-memory-cache",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      });
    }

    let rollups: unknown[] = [];
    let incidents: unknown[] = [];
    if (
      env.DB &&
      edgeQuotaTracker.getTier(now) < QuotaDegradationTier.CRITICAL_SURVIVAL
    ) {
      try {
        const stmt = env.DB.prepare(
          "SELECT date, path, views, uniques, human_views, bot_views FROM analytics_rollups ORDER BY date DESC LIMIT 30",
        );
        const query =
          typeof (stmt as any).all === "function"
            ? await (stmt as any).all()
            : await stmt.bind().all();
        rollups = query.results || [];
        edgeQuotaTracker.recordD1Meta(query.meta, 0, rollups.length || 1, now);
      } catch (err) {
        if (isD1QuotaException(err)) {
          edgeQuotaTracker.tripCircuitBreaker(String(err), now, ctx);
        }
      }

      if (rollups.length === 0) {
        try {
          const fallbackStmt = env.DB.prepare(
            "SELECT summary_date AS date, path, total_views AS views FROM pageviews_daily_summary ORDER BY summary_date DESC LIMIT 30",
          );
          const fallbackQuery =
            typeof (fallbackStmt as any).all === "function"
              ? await (fallbackStmt as any).all()
              : await fallbackStmt.bind().all();
          rollups = fallbackQuery.results || [];
          edgeQuotaTracker.recordD1Meta(
            fallbackQuery.meta,
            0,
            rollups.length || 1,
            now,
          );
        } catch (err) {
          if (isD1QuotaException(err)) {
            edgeQuotaTracker.tripCircuitBreaker(String(err), now, ctx);
          }
        }
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
        edgeQuotaTracker.recordD1Meta(
          incQuery.meta,
          0,
          incidents.length || 1,
          now,
        );
      } catch (err) {
        if (isD1QuotaException(err)) {
          edgeQuotaTracker.tripCircuitBreaker(String(err), now, ctx);
        }
      }
    }
    const envRecord = env as unknown as Record<string, unknown>;
    const prefStatus = prefetchCircuitBreaker.getStatus(envRecord);
    const botStatus = botCircuitBreaker.getStatus(envRecord);
    let snap = edgeQuotaTracker.getSnapshot(now);
    try {
      if (env.DB) {
        snap = await edgeQuotaTracker.syncFromD1AndCache(env.DB, now);
      }
    } catch {
      // Fail-open
    }

    const quotas = buildUnifiedQuotas(snap.dailyWrites, snap.dailyReads);

    const metricsPayload = {
      metrics: rollups,
      data_quality_warnings: incidents.map((inc: any) => ({
        date: inc.date,
        subsystem: inc.subsystem,
        warning: `Data is partial: circuit breaker tripped due to ${inc.reason}`,
        shed_count: inc.shed_count,
        data_completeness: inc.data_completeness,
      })),
      circuit_breakers: {
        prefetch: prefStatus,
        bot: botStatus,
      },
      degradation_tier: snap,
      quotas,
    };

    cachedMetricsSnapshot = {
      timestamp: now,
      data: metricsPayload,
      dbRef: env.DB,
    };

    return new Response(JSON.stringify(metricsPayload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  if (url.pathname === "/api/leads") {
    const now = Date.now();
    const isFresh =
      url.searchParams.get("fresh") === "true" ||
      url.searchParams.get("refresh") === "1";

    if (
      !isFresh &&
      cachedLeadsSnapshot &&
      cachedLeadsSnapshot.dbRef === env.DB &&
      now - cachedLeadsSnapshot.timestamp < TELEMETRY_CACHE_TTL_MS
    ) {
      return new Response(JSON.stringify(cachedLeadsSnapshot.data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, no-store",
          "X-Telemetry-Source": "edge-memory-cache",
        },
      });
    }

    let leads: any[] = [];
    let leadsStatus: "ok" | "unavailable" | "degraded" = !env.DB
      ? "unavailable"
      : edgeQuotaTracker.getTier(now) >= QuotaDegradationTier.CRITICAL_SURVIVAL
        ? "degraded" : "ok";
    if (leadsStatus === "ok") {
      try {
        const stmt = env.DB.prepare(
          "SELECT id, name, from_email, phone, subject, body, locale, ip, country, city, region, timezone, asn, as_organization, user_agent, referer, turnstile_verified, created_at FROM contact_leads ORDER BY created_at DESC LIMIT 50",
        );
        const q =
          typeof (stmt as any).all === "function"
            ? await (stmt as any).all()
            : await stmt.bind().all();
        leads = q.results || [];
        edgeQuotaTracker.recordD1Meta(q.meta, 0, leads.length || 1, now);
      } catch (err) {
        leadsStatus = isD1QuotaException(err) ? "degraded" : "unavailable";
        if (isD1QuotaException(err)) {
          edgeQuotaTracker.tripCircuitBreaker(String(err), now, ctx);
        }
      }
    }

    const leadsPayload = {
      status: leadsStatus,
      leads,
      ...(leadsStatus === "ok" ? {} : { error: "Lead data is not available" }),
    };
    if (leadsStatus === "ok") cachedLeadsSnapshot = {
      timestamp: now,
      data: leadsPayload,
      dbRef: env.DB,
    };

    return new Response(JSON.stringify(leadsPayload), {
      status: leadsStatus === "ok" ? 200 : 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (url.pathname === "/api/contact") {
    return handleContactFormSubmission(request, env, ctx);
  }

  if (url.pathname === "/api/telemetry") {
    const range = url.searchParams.get("range") || "all";
    const countryParam = url.searchParams.get("country") || "all";
    const segmentParam = url.searchParams.get("segment") || "all";
    const pathFilter = url.searchParams.get("path") || "all";
    const searchParam = url.searchParams.get("search")?.trim() || "";
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(
      100,
      Math.max(10, parseInt(url.searchParams.get("limit") || "50", 10)),
    );
    const offset = (page - 1) * limit;
    const pageOnly =
      url.searchParams.get("page_only") === "1" ||
      url.searchParams.get("page_only") === "true";

    const requestedFresh =
      url.searchParams.get("fresh") === "true" ||
      url.searchParams.get("refresh") === "1";

    const now = Date.now();
    const cacheKey = `${telemetryDbKey(env.DB)}:${range}:${countryParam}:${segmentParam}:${pathFilter}:${searchParam}:${fromParam || ""}:${toParam || ""}:${page}:${limit}:${pageOnly ? "1" : "0"}`;

    // Resolved cooldown entries may evict by recency; unlike the IP security
    // window, a full table must not silently discard an explicit fresh request.
    const lastFreshAt = telemetryFreshCooldown.get(cacheKey, now) || 0;
    const isFresh = requestedFresh && now - lastFreshAt >= TELEMETRY_FRESH_COOLDOWN_MS;
    if (isFresh) telemetryFreshCooldown.set(cacheKey, now, now);

    // Bounded per-isolate resolved snapshot cache; never share D1 I/O across requests.
    const cachedHit = telemetryCache.get(cacheKey, now);
    if (
      !isFresh &&
      cachedHit &&
      cachedHit.dbRef === env.DB &&
      now - cachedHit.timestamp < TELEMETRY_CACHE_TTL_MS
    ) {
      return new Response(JSON.stringify(cachedHit.data), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, no-store",
          "X-Telemetry-Source": "edge-memory-cache",
        },
      });
    }

    let pageviews: any[] = [];
    let edgeEvents: any[] = [];
    let prefetches: any[] = [];
    let dailySummaries: any[] = [];
    let coverage: Record<string, unknown> | null = null;
    let topPages: any[] = [];
    let topCountries: any[] = [];
    let utmAttributions: any[] = [];
    let topReferrers: any[] = [];
    let dataStatus: "ok" | "unavailable" | "degraded" = env.DB
      ? edgeQuotaTracker.getTier(now) >= QuotaDegradationTier.CRITICAL_SURVIVAL
        ? "degraded"
        : "ok"
      : "unavailable";
    const stats = {
      total_pageviews: 0,
      human_views: 0,
      bot_views: 0,
      unique_visitors: 0,
      unique_human_visitors: 0,
      prefetches_count: 0,
      all_time_pageviews: 0,
    };

    if (
      env.DB &&
      edgeQuotaTracker.getTier(now) < QuotaDegradationTier.CRITICAL_SURVIVAL
    ) {
      try {
        const whereClauses: string[] = [];
        const bindValues: (string | number)[] = [];

        if (range === "1d" || range === "24h") {
          whereClauses.push("created_at >= datetime('now', '-1 day')");
        } else if (range === "2d" || range === "48h") {
          whereClauses.push("created_at >= datetime('now', '-2 days')");
        } else if (range === "3d" || range === "72h") {
          whereClauses.push("created_at >= datetime('now', '-3 days')");
        } else if (range === "7d" || range === "1w") {
          whereClauses.push("created_at >= datetime('now', '-7 days')");
        } else if (range === "30d" || range === "1m") {
          whereClauses.push("created_at >= datetime('now', '-30 days')");
        } else if (range === "custom") {
          if (fromParam) {
            whereClauses.push("created_at >= ?");
            bindValues.push(
              fromParam.length <= 10 ? `${fromParam} 00:00:00` : fromParam,
            );
          }
          if (toParam) {
            whereClauses.push("created_at <= ?");
            bindValues.push(
              toParam.length <= 10 ? `${toParam} 23:59:59` : toParam,
            );
          }
        }

        if (countryParam && countryParam !== "all") {
          whereClauses.push("country = ?");
          bindValues.push(countryParam);
        }

        // Prefetch has no human/bot attribution; share only supported filters.
        const prefetchWhereClauses = [...whereClauses];
        const prefetchBindValues = [...bindValues];

        if (segmentParam === "human") {
          whereClauses.push("is_bot = 0");
        } else if (segmentParam === "bot") {
          whereClauses.push("is_bot = 1");
        }

        if (pathFilter && pathFilter !== "all") {
          whereClauses.push("path LIKE ?");
          bindValues.push(`${pathFilter}%`);
        }

        if (searchParam) {
          whereClauses.push(
            "(path LIKE ? OR country LIKE ? OR referrer LIKE ? OR utm_source LIKE ? OR utm_campaign LIKE ? OR visitor_hash LIKE ?)",
          );
          const s = `%${searchParam}%`;
          bindValues.push(s, s, s, s, s, s);
        }

        const whereSql =
          whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

        const runQuery = async (
          sql: string,
          params: (string | number)[] = [],
        ) => {
          let stmt = env.DB.prepare(sql);
          if (params.length > 0) {
            stmt = stmt.bind(...params);
          }
          const q =
            typeof (stmt as any).all === "function"
              ? await (stmt as any).all()
              : await stmt.bind().all();
          const rows = q.results || [];
          edgeQuotaTracker.recordD1Meta(q.meta, 0, rows.length || 1, now);
          return rows;
        };

        if (pathFilter && pathFilter !== "all") {
          prefetchWhereClauses.push("path LIKE ?");
          prefetchBindValues.push(`${pathFilter}%`);
        }
        if (searchParam) {
          prefetchWhereClauses.push(
            "(path LIKE ? OR country LIKE ? OR referrer LIKE ? OR visitor_hash LIKE ? OR purpose LIKE ?)",
          );
          const search = `%${searchParam}%`;
          prefetchBindValues.push(search, search, search, search, search);
        }
        const prefetchWhereSql = prefetchWhereClauses.length
          ? `WHERE ${prefetchWhereClauses.join(" AND ")}`
          : "";
        const prefetchTotals = await runQuery(
          `SELECT COUNT(*) AS count FROM prefetch_analytics_events ${prefetchWhereSql}`,
          prefetchBindValues,
        );
        stats.prefetches_count = Number(prefetchTotals[0]?.count || 0);

        // 1. Exact Totals Aggregations (1:1 with D1)
        const aggSql = `SELECT COUNT(*) AS total_views, SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS human_views, SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bot_views, COUNT(DISTINCT visitor_hash) AS unique_visitors, COUNT(DISTINCT CASE WHEN is_bot = 0 THEN visitor_hash END) AS unique_human_visitors FROM pageviews ${whereSql}`;
        const aggResults = await runQuery(aggSql, bindValues);
        if (aggResults.length > 0) {
          const row = aggResults[0];
          stats.total_pageviews = Number(row.total_views || 0);
          stats.human_views = Number(row.human_views || 0);
          stats.bot_views = Number(row.bot_views || 0);
          stats.unique_visitors = Number(row.unique_visitors || 0);
          stats.unique_human_visitors = Number(row.unique_human_visitors || 0);
        }

        // 2. All-time total pageviews via compact rollup summary (zero full-table scan on pageviews)
        if (whereClauses.length === 0) {
          stats.all_time_pageviews = stats.total_pageviews;
        } else if (!pageOnly) {
          try {
            let rollupTotal = 0;
            try {
              const arRes = await runQuery(
                "SELECT COALESCE(SUM(views), 0) AS all_views FROM analytics_rollups",
              );
              rollupTotal = Number(arRes[0]?.all_views || 0);
            } catch {
              // Fallback to pageviews_daily_summary
            }
            if (rollupTotal === 0) {
              const allRes = await runQuery(
                "SELECT COALESCE(SUM(total_views), 0) AS all_views FROM pageviews_daily_summary",
              );
              rollupTotal = Number(allRes[0]?.all_views || 0);
            }
            stats.all_time_pageviews =
              rollupTotal > stats.total_pageviews
                ? rollupTotal
                : stats.total_pageviews;
          } catch {
            stats.all_time_pageviews = stats.total_pageviews;
          }
        } else {
          stats.all_time_pageviews = stats.total_pageviews;
        }

        // Skip heavy GROUP BY aggregations when `page_only=1` (table pagination fast-path)
        if (!pageOnly) {
          // 3. Exact Top Pages (grouped by path, 1:1 with D1)
          const pagesSql = `SELECT path, COUNT(*) AS total_views, SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS human_views, COUNT(DISTINCT visitor_hash) AS unique_visitors FROM pageviews ${whereSql} GROUP BY path ORDER BY total_views DESC LIMIT 15`;
          topPages = await runQuery(pagesSql, bindValues);

          // 4. Exact Top Countries (grouped by country, 1:1 with D1)
          const countriesSql = `SELECT country, COUNT(*) AS views, SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS human_views, COUNT(DISTINCT visitor_hash) AS unique_visitors FROM pageviews ${whereSql} GROUP BY country ORDER BY views DESC LIMIT 15`;
          topCountries = await runQuery(countriesSql, bindValues);

          // 5. Exact Top Referrers (1:1 with D1, sanitizing legacy Invalid entries)
          const refWhere =
            whereClauses.length > 0
              ? `${whereSql} AND referrer IS NOT NULL AND LOWER(referrer) != 'direct' AND LOWER(referrer) != 'invalid' AND referrer != ''`
              : "WHERE referrer IS NOT NULL AND LOWER(referrer) != 'direct' AND LOWER(referrer) != 'invalid' AND referrer != ''";
          const refSql = `SELECT referrer, COUNT(*) AS count, COUNT(DISTINCT visitor_hash) AS unique_visitors FROM pageviews ${refWhere} GROUP BY referrer ORDER BY count DESC LIMIT 15`;
          topReferrers = await runQuery(refSql, bindValues);

          // 6. Exact Top UTM Attributions (1:1 with D1, sanitizing legacy Invalid entries)
          const utmWhere =
            whereClauses.length > 0
              ? `${whereSql} AND utm_source IS NOT NULL AND LOWER(utm_source) != 'direct' AND LOWER(utm_source) != 'invalid' AND utm_source != ''`
              : "WHERE utm_source IS NOT NULL AND LOWER(utm_source) != 'direct' AND LOWER(utm_source) != 'invalid' AND utm_source != ''";
          const utmSql = `SELECT utm_source, utm_medium, utm_campaign, COUNT(*) AS count, COUNT(DISTINCT visitor_hash) AS unique_visitors FROM pageviews ${utmWhere} GROUP BY utm_source, utm_medium, utm_campaign ORDER BY count DESC LIMIT 15`;
          utmAttributions = await runQuery(utmSql, bindValues);
        }

        // 7. Paginated Pageviews Batch (bounded LIMIT and OFFSET, sanitizing legacy Invalid rows)
        const pageviewsSql = `SELECT id, path, visitor_hash, referrer, country, utm_source, utm_medium, utm_campaign, utm_content, utm_term, is_bot, created_at FROM pageviews ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`;
        const rawPageviews = await runQuery(pageviewsSql, [
          ...bindValues,
          limit,
          offset,
        ]);
        pageviews = (rawPageviews || []).map((p: any) => ({
          ...p,
          referrer:
            !p.referrer || p.referrer.toLowerCase() === "invalid"
              ? "Direct"
              : p.referrer,
          utm_source:
            !p.utm_source || p.utm_source.toLowerCase() === "invalid"
              ? "direct"
              : p.utm_source,
        }));

        if (!pageOnly) {
          // 8. Prefetches
          prefetches = await runQuery(
            `SELECT id, path, visitor_hash, referrer, country, purpose, created_at FROM prefetch_analytics_events ${prefetchWhereSql} ORDER BY id DESC LIMIT 15`,
            prefetchBindValues,
          );

          // 9. Daily Summaries (query analytics_rollups first, fallback to pageviews_daily_summary)
          try {
            dailySummaries = await runQuery(
              "SELECT date AS summary_date, path, 'ALL' AS country, views AS total_views, human_views, bot_views, uniques FROM analytics_rollups ORDER BY date DESC LIMIT 30",
            );
          } catch {
            dailySummaries = [];
          }
          if (dailySummaries.length === 0) {
            dailySummaries = await runQuery(
              "SELECT summary_date, path, country, total_views FROM pageviews_daily_summary ORDER BY summary_date DESC LIMIT 30",
            );
          }

          // Fixed recent windows, independent of the raw-ledger filters above.
          // Do not imply these subset counts equal document or unique-visitor totals.
          let deviceOs: {
            status: "subset" | "unavailable";
            source: string;
            window_days: number;
            classified_views: number | null;
            device: Record<string, number> | null;
            os: Record<string, number> | null;
          } = {
            status: "unavailable",
            source: "analytics_rollups",
            window_days: 30,
            classified_views: null,
            device: null,
            os: null,
          };
          try {
            const rows = await runQuery(
              `SELECT COALESCE(SUM(device_desktop), 0) AS desktop,
                COALESCE(SUM(device_mobile), 0) AS mobile,
                COALESCE(SUM(os_windows), 0) AS windows,
                COALESCE(SUM(os_macos), 0) AS macos,
                COALESCE(SUM(os_ios), 0) AS ios,
                COALESCE(SUM(os_android), 0) AS android,
                COALESCE(SUM(os_linux), 0) AS linux,
                COALESCE(SUM(os_other), 0) AS other
               FROM analytics_rollups WHERE date >= date('now', '-29 days')`,
            );
            const row = rows[0];
            if (row) {
              const device = {
                desktop: Number(row.desktop || 0),
                mobile: Number(row.mobile || 0),
              };
              deviceOs = {
                status: "subset",
                source: "analytics_rollups",
                window_days: 30,
                classified_views: device.desktop + device.mobile,
                device,
                os: {
                  windows: Number(row.windows || 0),
                  macos: Number(row.macos || 0),
                  ios: Number(row.ios || 0),
                  android: Number(row.android || 0),
                  linux: Number(row.linux || 0),
                  other: Number(row.other || 0),
                },
              };
            }
          } catch (err) {
            if (isD1QuotaException(err)) {
              edgeQuotaTracker.tripCircuitBreaker(String(err), now, ctx);
              dataStatus = "degraded";
            }
          }

          const bots = {
            status: "unavailable" as "subset" | "unavailable",
            source: "pageviews",
            window_days: 7,
            collection_enabled:
              env.ENABLE_BOT_TELEMETRY !== false &&
              env.ENABLE_BOT_TELEMETRY !== "false" &&
              env.ENABLE_BOT_TELEMETRY !== "0",
            sample_rate: resolveBotTelemetrySampleRate(env),
            observed: null as number | null,
            ai: null as number | null,
            other: null as number | null,
            unknown: null as number | null,
          };
          try {
            const rows = await runQuery(
              `SELECT COUNT(*) AS observed,
                COALESCE(SUM(CASE WHEN bot_category = 'ai_scraper' THEN 1 ELSE 0 END), 0) AS ai,
                COALESCE(SUM(CASE WHEN bot_category IS NULL THEN 1 ELSE 0 END), 0) AS unknown
               FROM pageviews
               WHERE is_bot = 1 AND created_at >= ?`,
              [
                new Date(now - 7 * 86_400_000)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19),
              ],
            );
            if (rows[0]) {
              bots.status = "subset";
              bots.observed = Number(rows[0].observed || 0);
              bots.ai = Number(rows[0].ai || 0);
              bots.unknown = Number(rows[0].unknown || 0);
              bots.other = bots.observed - bots.ai - bots.unknown;
            }
          } catch (err) {
            if (isD1QuotaException(err)) {
              edgeQuotaTracker.tripCircuitBreaker(String(err), now, ctx);
              dataStatus = "degraded";
            }
          }
          coverage = { device_os: deviceOs, bots };
        }
      } catch (err) {
        if (isD1QuotaException(err)) {
          edgeQuotaTracker.tripCircuitBreaker(String(err), now, ctx);
        }
        dataStatus = "unavailable";
        // Fail-open resilience: If D1 row read quota was exceeded or temporarily blocked by Cloudflare
        console.warn("[D1 Telemetry Quota Safeguard - Fail-Open]:", err);
      }
    }

    const totalFiltered = stats.total_pageviews;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));
    let snap = edgeQuotaTracker.getSnapshot(now);
    try {
      if (env.DB) {
        snap = await edgeQuotaTracker.syncFromD1AndCache(env.DB, now);
      }
    } catch {
      // Fail-open
    }

    const responsePayload = {
      status: dataStatus,
      surface: "admin-isolated",
      timestamp: new Date().toISOString(),
      page_only: pageOnly,
      pagination: {
        page,
        limit,
        total_filtered: totalFiltered,
        total_pages: totalPages,
      },
      filters: {
        range,
        country: countryParam,
        segment: segmentParam,
        path: pathFilter,
        search: searchParam,
        from: fromParam,
        to: toParam,
      },
      stats,
      top_pages: topPages,
      top_countries: topCountries,
      utm_attributions: utmAttributions,
      top_referrers: topReferrers,
      pageviews,
      edge_events: edgeEvents,
      prefetches,
      daily_summaries: dailySummaries,
      coverage,
      circuit_breakers: {
        prefetch: prefetchCircuitBreaker.getStatus(
          env as unknown as Record<string, unknown>,
        ),
        bot: botCircuitBreaker.getStatus(
          env as unknown as Record<string, unknown>,
        ),
      },
      degradation_tier: snap,
      quotas: buildUnifiedQuotas(snap.dailyWrites, snap.dailyReads),
    };

    // Cache only observed data; an unavailable ledger must never masquerade as empty.
    if (dataStatus === "ok") {
      telemetryCache.set(cacheKey, {
        timestamp: now,
        data: responsePayload,
        dbRef: env.DB,
      }, now);


    }

    return new Response(JSON.stringify(responsePayload), {
      status: dataStatus === "ok" ? 200 : 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "X-Telemetry-Source":
          dataStatus === "ok" ? "edge-d1-fresh" : dataStatus,
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  return new Response(JSON.stringify({ error: "Not Found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" },
  });
}

export interface AttributionResult {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
  referrer: string;
}

/**
 * Universal Attribution & Visit Ingress Normalizer
 * Robustly parses standard UTMs, alternate campaign aliases, advertising click IDs (Google, FB, Bing, etc.),
 * mobile Android application URIs (android-app://), search engines, and social platforms.
 * Invariant: NEVER returns "Invalid" under any malformed or unexpected ingress pattern.
 */
export function parseAttribution(
  rawUrl: string | URL,
  rawReferrerHeader: string | null | undefined,
): AttributionResult {
  let url: URL;
  try {
    url = typeof rawUrl === "string" ? new URL(rawUrl) : rawUrl;
  } catch {
    url = new URL("https://arturonavax.dev/");
  }

  // 1. Extraer Parámetros de Búsqueda (Case-Insensitive)
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (v && v.trim()) {
      params[k.toLowerCase()] = v.trim();
    }
  }

  let utmSource =
    params["utm_source"] ||
    params["source"] ||
    params["ref"] ||
    params["origin"] ||
    params["channel"] ||
    "";
  let utmMedium = params["utm_medium"] || params["medium"] || "";
  let utmCampaign = params["utm_campaign"] || params["campaign"] || "";
  let utmContent = params["utm_content"] || params["content"] || "";
  let utmTerm = params["utm_term"] || params["term"] || "";

  // Detección de Click IDs de Campañas Pagadas y Plataformas
  if (
    params["gclid"] ||
    params["gbraid"] ||
    params["wbraid"] ||
    params["dclid"]
  ) {
    if (!utmSource) utmSource = "google";
    if (!utmMedium) utmMedium = "cpc";
    if (!utmContent)
      utmContent = params["gclid"] || params["gbraid"] || "google-ads";
  } else if (params["fbclid"]) {
    if (!utmSource) utmSource = "facebook";
    if (!utmMedium) utmMedium = utmCampaign ? "paid-social" : "social";
    if (!utmContent) utmContent = params["fbclid"];
  } else if (params["msclkid"]) {
    if (!utmSource) utmSource = "bing";
    if (!utmMedium) utmMedium = "cpc";
    if (!utmContent) utmContent = params["msclkid"];
  } else if (params["ttclid"]) {
    if (!utmSource) utmSource = "tiktok";
    if (!utmMedium) utmMedium = "social";
  } else if (params["twclid"]) {
    if (!utmSource) utmSource = "x";
    if (!utmMedium) utmMedium = "social";
  } else if (params["li_fat_id"]) {
    if (!utmSource) utmSource = "linkedin";
    if (!utmMedium) utmMedium = "social";
  } else if (params["igshid"]) {
    if (!utmSource) utmSource = "instagram";
    if (!utmMedium) utmMedium = "social";
  } else if (params["mc_cid"]) {
    if (!utmSource) utmSource = "mailchimp";
    if (!utmMedium) utmMedium = "email";
  }

  // 2. Normalización de Referrer HTTP
  let referrer = "Direct";
  const refHeader = (rawReferrerHeader || "").trim();

  if (
    refHeader &&
    refHeader.toLowerCase() !== "direct" &&
    refHeader.toLowerCase() !== "invalid" &&
    refHeader.toLowerCase() !== "null" &&
    refHeader.toLowerCase() !== "undefined" &&
    refHeader.toLowerCase() !== "none"
  ) {
    if (refHeader.startsWith("android-app://")) {
      const pkg =
        refHeader.replace("android-app://", "").split("/")[0]?.toLowerCase() ||
        "";
      if (pkg.includes("google")) {
        referrer = "google.com";
        if (!utmSource) utmSource = "google";
        if (!utmMedium) utmMedium = "organic";
      } else if (pkg.includes("linkedin")) {
        referrer = "linkedin.com";
        if (!utmSource) utmSource = "linkedin";
        if (!utmMedium) utmMedium = "social";
      } else if (pkg.includes("twitter") || pkg.includes(".x.")) {
        referrer = "x.com";
        if (!utmSource) utmSource = "x";
        if (!utmMedium) utmMedium = "social";
      } else if (pkg.includes("facebook") || pkg.includes("katana")) {
        referrer = "facebook.com";
        if (!utmSource) utmSource = "facebook";
        if (!utmMedium) utmMedium = "social";
      } else if (pkg.includes("instagram")) {
        referrer = "instagram.com";
        if (!utmSource) utmSource = "instagram";
        if (!utmMedium) utmMedium = "social";
      } else if (pkg.includes("slack")) {
        referrer = "slack.com";
        if (!utmSource) utmSource = "slack";
        if (!utmMedium) utmMedium = "chat";
      } else if (pkg.includes("telegram")) {
        referrer = "telegram.org";
        if (!utmSource) utmSource = "telegram";
        if (!utmMedium) utmMedium = "chat";
      } else if (pkg.includes("whatsapp")) {
        referrer = "whatsapp.com";
        if (!utmSource) utmSource = "whatsapp";
        if (!utmMedium) utmMedium = "chat";
      } else if (pkg.includes("reddit")) {
        referrer = "reddit.com";
        if (!utmSource) utmSource = "reddit";
        if (!utmMedium) utmMedium = "social";
      } else if (pkg) {
        referrer = pkg;
      }
    } else {
      try {
        const fullRef = refHeader.includes("://")
          ? refHeader
          : `https://${refHeader}`;
        const refParsed = new URL(fullRef);
        const cleanRefHost = refParsed.hostname
          .toLowerCase()
          .replace(/^www\./, "");
        const cleanReqHost = url.hostname.toLowerCase().replace(/^www\./, "");

        // Excluir navegación interna
        if (
          cleanRefHost &&
          cleanRefHost !== cleanReqHost &&
          cleanRefHost !== "arturonavax.dev" &&
          cleanRefHost !== "localhost" &&
          cleanRefHost !== "127.0.0.1" &&
          !cleanRefHost.endsWith(".arturonavax.dev")
        ) {
          referrer = cleanRefHost;
        }
      } catch {
        // Blindaje fail-open: Jamás emitir "Invalid"
        referrer = "Direct";
      }
    }
  }

  // 3. Fallback exhaustivo de Motores de Búsqueda, Redes y Plataformas
  if (!utmSource) {
    const ref = referrer.toLowerCase();
    if (
      ref.includes("google.") ||
      ref.includes("bing.") ||
      ref.includes("duckduckgo.") ||
      ref.includes("yahoo.") ||
      ref.includes("ecosia.") ||
      ref.includes("baidu.") ||
      ref.includes("yandex.") ||
      ref.includes("brave.com") ||
      ref.includes("kagi.com")
    ) {
      utmSource = ref.split(".")[0] || "search";
      utmMedium = utmMedium || "organic";
    } else if (
      ref.includes("perplexity.ai") ||
      ref.includes("chatgpt.com") ||
      ref.includes("openai.com") ||
      ref.includes("claude.ai") ||
      ref.includes("anthropic.com")
    ) {
      utmSource = ref.includes("perplexity")
        ? "perplexity"
        : ref.includes("chatgpt") || ref.includes("openai")
          ? "chatgpt"
          : "claude";
      utmMedium = utmMedium || "ai-search";
    } else if (ref.includes("linkedin.com") || ref.includes("lnkd.in")) {
      utmSource = "linkedin";
      utmMedium = utmMedium || "social";
    } else if (ref.includes("github.com") || ref.includes("github.io")) {
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
    } else if (
      ref.includes("facebook.com") ||
      ref.includes("fb.com") ||
      ref.includes("fb.me")
    ) {
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
    } else if (ref.includes("dev.to")) {
      utmSource = "devto";
      utmMedium = utmMedium || "community";
    } else if (ref.includes("hashnode.")) {
      utmSource = "hashnode";
      utmMedium = utmMedium || "community";
    } else if (ref.includes("substack.com")) {
      utmSource = "substack";
      utmMedium = utmMedium || "newsletter";
    } else if (ref.includes("threads.net")) {
      utmSource = "threads";
      utmMedium = utmMedium || "social";
    } else if (ref.includes("bluesky.app") || ref.includes("bsky.app")) {
      utmSource = "bluesky";
      utmMedium = utmMedium || "social";
    } else if (ref.includes("mastodon.")) {
      utmSource = "mastodon";
      utmMedium = utmMedium || "social";
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
    } else if (referrer !== "Direct") {
      utmSource = referrer;
      utmMedium = utmMedium || "referral";
    } else {
      utmSource = "direct";
      utmMedium = utmMedium || "none";
    }
  }

  // 4. Invariante: Jamás persistir "invalid" en ningún campo
  if (utmSource.toLowerCase() === "invalid") utmSource = "direct";
  if (referrer.toLowerCase() === "invalid") referrer = "Direct";

  return {
    source: utmSource.slice(0, 100).toLowerCase(),
    medium: (utmMedium || "none").slice(0, 50).toLowerCase(),
    campaign: utmCampaign.slice(0, 100),
    content: utmContent.slice(0, 100),
    term: utmTerm.slice(0, 100),
    referrer: referrer.slice(0, 100),
  };
}

/**
 * Edge pageview deduplication — two layers:
 *
 *  L1 (this in-memory map): per-isolate fast path that avoids a D1 round-trip for rapid
 *      double-clicks, pre-render races and instant reloads. It is an optimization only: isolates
 *      are many and ephemeral, so it can never be the source of truth.
 *  L2 (authoritative, D1): `pageviews.dedupe_key` UNIQUE index (migration 0010). The key is
 *      sha256(visitor_hash | normalized_path | time_bucket). Correct across every isolate/POP.
 */
export const recentPageviewsCache = new Map<string, number>();
export const PAGEVIEW_DEDUPE_WINDOW_MS = 5_000;
const PAGEVIEW_CACHE_MAX_ENTRIES = 5_000;

export function clearRecentPageviewsCache(): void {
  recentPageviewsCache.clear();
  clearL1DedupeCache();
  clearCompactRollupBuffer();
  telemetryCache.clear();
  telemetryFreshCooldown.clear();
  cachedMetricsSnapshot = null;
  cachedLeadsSnapshot = null;
  cachedDeploymentsSnapshot = null;
  edgeQuotaTracker.reset();
}

export function isDuplicatePageview(
  visitorHash: string,
  normalizedPath: string,
  now: number = Date.now(),
): boolean {
  const key = `${visitorHash}:${normalizedPath}`;
  const lastTime = recentPageviewsCache.get(key);
  if (lastTime !== undefined && now - lastTime < PAGEVIEW_DEDUPE_WINDOW_MS) {
    return true;
  }
  recentPageviewsCache.set(key, now);
  if (recentPageviewsCache.size > PAGEVIEW_CACHE_MAX_ENTRIES) {
    for (const [k, ts] of recentPageviewsCache) {
      if (now - ts > PAGEVIEW_DEDUPE_WINDOW_MS) {
        recentPageviewsCache.delete(k);
      }
    }
  }
  return false;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export { normalizeIpForDedupe };

/** Daily-rotating anonymized visitor hash (GDPR compliant, no raw IP/UA stored). */
export async function computeVisitorHash(
  ip: string,
  userAgent: string,
  day: string = new Date().toISOString().slice(0, 10),
): Promise<string> {
  const normalizedIp = normalizeIpForDedupe(ip);
  return (await sha256Hex(`${normalizedIp}-${userAgent}-${day}`)).slice(0, 16);
}

/** Deterministic dedupe key for a (visitor, path, time-bucket) triple. */
export async function computeDedupeKey(
  visitorHash: string,
  normalizedPath: string,
  bucket: number,
): Promise<string> {
  return (await sha256Hex(`${visitorHash}|${normalizedPath}|${bucket}`)).slice(
    0,
    32,
  );
}

/**
 * Asynchronous Non-Blocking Analytics Logger (REQ-PCD-04, REQ-PCD-05)
 * Runs strictly within ctx.waitUntil without adding any latency to the critical response path.
 *
 * Write path = ONE atomic D1 batch (single round-trip):
 *   1. INSERT INTO pageviews ... guarded by NOT EXISTS(previous bucket) + ON CONFLICT(dedupe_key) DO NOTHING
 *   2. INSERT INTO pageview_events ... SELECT ... WHERE changes() > 0   (humans only)
 * so the rollup row is written if and only if the pageview row was actually inserted.
 */
function resolveBotTelemetrySampleRate(env?: Env): number {
  // Unconfigured collection uses the same bounded 1% default as enabled collection.
  const value = env?.BOT_TELEMETRY_SAMPLE_RATE ?? 0.01;
  if (typeof value === "string" && value.trim() === "") return 0.01;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0.01;
}

export async function recordAnalyticsNonBlocking(
  request: Request,
  path: string,
  db: D1Database,
  env?: Env,
): Promise<void> {
  try {
    const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    const userAgent = request.headers.get("user-agent") || "";
    const referrerHeader = request.headers.get("referer") || "";

    const cf = (request as unknown as { cf?: { country?: string } }).cf;
    const country = cf?.country || "XX";

    // Extraer y Normalizar Atribución & Ingress
    const attribution = parseAttribution(request.url, referrerHeader);
    const utmSource = attribution.source;
    const utmMedium = attribution.medium;
    const utmCampaign = attribution.campaign;
    const utmContent = attribution.content;
    const utmTerm = attribution.term;
    const referrer = attribution.referrer;

    const visitorInfo = classifyVisitor(request, path);
    const isBot = visitorInfo.isBot ? 1 : 0;
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);

    const visitorHash = await computeVisitorHash(ip, userAgent, today);

    // Normalización canónica de la ruta para agregación consistente
    const normalizedPath = normalizeTelemetryPath(path);

    // L1 dedupe (per-isolate + Edge Cache API 30-minute window). Skips the D1 round-trip for repeats.
    const l1Key30m = await computeVisitDedupeKey(
      ip,
      userAgent,
      normalizedPath,
      now,
    );
    const isDupShort = isDuplicatePageview(visitorHash, normalizedPath, now);
    const isDupL1 = await checkAndSetL1DedupeCache(l1Key30m, now);
    if (isDupShort || isDupL1) {
      return;
    }

    const currentTier = edgeQuotaTracker.getTier(now);

    if (isBot) {
      // Sample only explicitly enabled bot collection. The deterministic bucket
      // hash avoids an extra identity, D1 read or per-isolate sampling counter.
      // Disabled collection still reaches the existing kill-switch behavior.
      if (
        env?.ENABLE_BOT_TELEMETRY !== false &&
        env?.ENABLE_BOT_TELEMETRY !== "false" &&
        env?.ENABLE_BOT_TELEMETRY !== "0" &&
        parseInt(l1Key30m.slice(0, 8), 16) / 0x1_0000_0000 >=
          resolveBotTelemetrySampleRate(env)
      ) {
        return;
      }
      // Bot Telemetry Circuit Breaker (REQ-PCD-04, SPEC-008):
      // Bots are secondary priority compared to human visits (P0).
      const reqPurpose = (request.headers.get("purpose") || "").toLowerCase();
      const reqSecPurpose = (
        request.headers.get("sec-purpose") || ""
      ).toLowerCase();
      const reqIsPrefetch =
        reqPurpose === "prefetch" || reqSecPurpose.includes("prefetch");
      if (
        !botCircuitBreaker.canRecordBot(
          env as unknown as Record<string, unknown>,
          userAgent,
          visitorInfo.classification,
          reqIsPrefetch,
        )
      ) {
        // Quota is constrained or bot kill-switch is active: shed bot telemetry to protect P0 quota.
        if (
          currentTier < QuotaDegradationTier.CRITICAL_SURVIVAL &&
          botCircuitBreaker.shouldLogIncident(today)
        ) {
          botCircuitBreaker.markIncidentLogged(today);
          const tripReason = botCircuitBreaker.getTripReason();
          await recordCircuitBreakerIncident(
            db,
            "bot_telemetry",
            today,
            tripReason,
            `Bot telemetry shed to protect P0 human visit quota (${visitorInfo.reason})`,
          );
        }
        return;
      }
      botCircuitBreaker.recordBot(reqIsPrefetch);

      // In Tier >= CONSERVATIVE (50% quota), drop raw bot pageview writes and record only to compact rollups
      if (currentTier >= QuotaDegradationTier.CONSERVATIVE) {
        if (
          visitorInfo.classification === "verified_bot" ||
          visitorInfo.classification === "search_crawler" ||
          visitorInfo.classification === "ai_scraper"
        ) {
          const adapter = new D1TelemetryAdapter(db, env);
          await adapter.ingestVisit({
            path: normalizedPath,
            visitorHash,
            ip,
            userAgent,
            dedupeKey: l1Key30m,
            skipL1Check: true,
            eventType: "pageview",
            isBot: true,
            botName: visitorInfo.reason,
            country,
            referrerHost: referrer,
            statusCode: 200,
            nowMs: now,
          });
        }
        return;
      }
    }

    // Quota accounting happens only for visits that survived the L1 dedupe gate.
    prefetchCircuitBreaker.recordVisit();

    // Documents and committed browser routes share the authoritative raw insert
    // and conditional rollup. Bot sampling and nominal category handling follow.
    if (!isBot) {
      const dimensions = visitDimensions(request);
      const bucket = Math.floor(now / PAGEVIEW_DEDUPE_WINDOW_MS);
      const [dedupeKey, previousDedupeKey] = await Promise.all([
        computeDedupeKey(visitorHash, normalizedPath, bucket),
        computeDedupeKey(visitorHash, normalizedPath, bucket - 1),
      ]);
      await new D1TelemetryAdapter(db, env).ingestVisit({
        path: normalizedPath, visitorHash, ip, userAgent,
        dedupeKey: l1Key30m, skipL1Check: true, eventType: "pageview",
        country: dimensions.country, region: dimensions.region,
        browser: dimensions.browser, browserLanguage: dimensions.browserLanguage,
        deviceType: dimensions.deviceType, referrerHost: referrer,
        statusCode: 200, nowMs: now,
        dashboard: { path, dedupeKey, previousDedupeKey,
          source: utmSource, medium: utmMedium, campaign: utmCampaign,
          content: utmContent, term: utmTerm },
      });
      return;
    }

    const walRecord = {
      dedupe_key: l1Key30m,
      path: normalizedPath,
      event_type: "pageview",
      visitor_hash: visitorHash,
      is_bot: isBot,
      bot_name: visitorInfo.reason,
      country: country.slice(0, 10),
      device_type: coarseDeviceOs(userAgent).device,
      os_type: coarseDeviceOs(userAgent).os,
      referrer_host: referrer.slice(0, 100),
      status_code: 200,
      created_at: new Date(now).toISOString(),
    };

    // Tier 3 (CRITICAL_SURVIVAL) & Tier 4 (R2_WAL_FALLBACK): Zero D1 writes, spill to R2 WAL + Analytics Engine
    if (currentTier >= QuotaDegradationTier.CRITICAL_SURVIVAL) {
      await writeTelemetryWalToR2(walRecord, env, now);
      return;
    }

    // Tier 1 (CONSERVATIVE: >= 50%) & Tier 2 (COMPACT_ROLLUP: >= 70%):
    // Skip raw pageviews/pageview_events inserts, write strictly to compact analytics_rollups!
    if (currentTier >= QuotaDegradationTier.CONSERVATIVE) {
      const adapter = new D1TelemetryAdapter(db, env);
      await adapter.ingestVisit({
        path: normalizedPath,
        visitorHash,
        ip,
        userAgent,
        dedupeKey: l1Key30m,
        skipL1Check: true,
        eventType: "pageview",
        isBot: true,
        botName: visitorInfo.reason,
        country,
        referrerHost: referrer,
        statusCode: 200,
        nowMs: now,
      });
      return;
    }

    // L2 dedupe: current bucket key (UNIQUE) + previous bucket probe so two hits that straddle a
    // bucket boundary within the window are still collapsed.
    const bucket = Math.floor(now / PAGEVIEW_DEDUPE_WINDOW_MS);
    const [dedupeKey, prevDedupeKey] = await Promise.all([
      computeDedupeKey(visitorHash, normalizedPath, bucket),
      computeDedupeKey(visitorHash, normalizedPath, bucket - 1),
    ]);

    // Human ingestion returned above; this path writes classified bot rows.
    const pageviewsInsert = db
      .prepare(
        `INSERT INTO pageviews (
           path, visitor_hash, referrer, country,
           utm_source, utm_medium, utm_campaign, utm_content, utm_term,
           is_bot, bot_category, created_at, dedupe_key
         ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?
         WHERE NOT EXISTS (SELECT 1 FROM pageviews WHERE dedupe_key = ?)
         ON CONFLICT(dedupe_key) DO NOTHING`,
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
        visitorInfo.classification,
        dedupeKey,
        prevDedupeKey,
      );

    const statements = [pageviewsInsert];

    if (edgeQuotaTracker.shouldSyncD1()) {
      const quotaStmt = edgeQuotaTracker.buildQuotaUpsertStatement(db, now);
      if (quotaStmt && typeof quotaStmt.run === "function") {
        quotaStmt.run().catch(() => {});
      }
    }

    try {
      if (typeof db.batch === "function") {
        await db.batch(statements);
      } else {
        for (const stmt of statements) {
          await stmt.run();
        }
      }
      edgeQuotaTracker.recordWrite(statements.length, now);
    } catch (batchErr) {
      if (isD1QuotaException(batchErr)) {
        edgeQuotaTracker.tripCircuitBreaker(String(batchErr), now);
        await writeTelemetryWalToR2(walRecord, env, now);
        return;
      }
      throw batchErr;
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
  if (edgeQuotaTracker.getTier() >= QuotaDegradationTier.CONSERVATIVE) {
    return;
  }
  try {
    const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
    const userAgent = request.headers.get("user-agent") || "";
    const referrerHeader = request.headers.get("referer") || "";

    const cf = (request as unknown as { cf?: { country?: string } }).cf;
    const country = cf?.country || "XX";

    const attribution = parseAttribution(request.url, referrerHeader);
    const referrer = attribution.referrer;

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
    edgeQuotaTracker.recordWrite(1);
  } catch (err) {
    if (isD1QuotaException(err)) {
      edgeQuotaTracker.tripCircuitBreaker(String(err));
    }
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
  notes = "Prefetch telemetry shed to protect P0 quota",
): Promise<void> {
  if (edgeQuotaTracker.getTier() >= QuotaDegradationTier.CRITICAL_SURVIVAL) {
    return;
  }
  try {
    await db
      .prepare(
        `INSERT INTO circuit_breaker_incidents (
           subsystem, date, reason, shed_count, data_completeness, notes
         ) VALUES (?, ?, ?, 1, 'partial', ?)
         ON CONFLICT(subsystem, date) DO UPDATE SET
           shed_count = circuit_breaker_incidents.shed_count + 1`,
      )
      .bind(subsystem, date, reason, notes)
      .run();
    edgeQuotaTracker.recordWrite(1);
  } catch (err) {
    if (isD1QuotaException(err)) {
      edgeQuotaTracker.tripCircuitBreaker(String(err));
    }
    console.warn("[Circuit Breaker Incident Log Error - Fail-Open]:", err);
  }
}
