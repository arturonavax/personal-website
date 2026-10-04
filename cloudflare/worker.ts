/// <reference types="@cloudflare/workers-types" />

import { handleAnalyticsRollup } from "./cron-scheduler";
import {
  processIncomingEmail,
  type ForwardableEmailMessage,
} from "./email-worker";
import { createSearchAdapter, createCaptchaAdapter } from "../src/lib/adapters";

interface Env {
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

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // 1. Identify Speculative Prefetch Requests
    const secPurpose = request.headers.get("sec-purpose") || "";
    const purpose = request.headers.get("purpose") || "";
    const isPrefetch =
      purpose === "prefetch" ||
      secPurpose.includes("prefetch") ||
      secPurpose.includes("prerender") ||
      request.headers.get("x-astro-prefetch") !== null ||
      request.headers.get("X-Astro-Prefetch") !== null;

    // 2. Semantic Search Endpoint with Query Parameter Normalization (SPEC-003 Section 2.2 & 3.2.2)
    if (url.pathname === "/api/search") {
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
            "Cache-Control": "public, max-age=60, s-maxage=300",
          },
        });
      }

      try {
        const searchAdapter = createSearchAdapter({
          env: {
            APP_SEARCH_DRIVER: env.APP_SEARCH_DRIVER,
            AI: env.AI,
            VECTORIZE_INDEX: env.VECTORIZE_INDEX,
          },
          executionCtx: ctx,
        });

        const results = await searchAdapter.search({
          query: q,
          locale,
          limit,
          threshold,
        });

        return new Response(JSON.stringify({ results }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=60, s-maxage=300",
          },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({
            results: [],
            error: err instanceof Error ? err.message : "Search failed",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    // 3. Captcha / Bot Verification Endpoint (SPEC-003 Section 1.1.4 & 3.4)
    if (url.pathname === "/api/verify-captcha" && request.method === "POST") {
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

        const result = await captchaAdapter.verify({
          token: body.token || "",
          remoteIp: clientIp,
        });

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

    // 4. Telemetry Ingestion Endpoint
    if (url.pathname === "/api/v1/telemetry" && request.method === "POST") {
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
              (request as unknown as { cf?: { country?: string } }).cf
                ?.country ||
              request.headers.get("cf-ipcountry") ||
              "XX";

            const now = Date.now();
            const path = String(payload.path || "").slice(0, 255);
            const locale = String(payload.locale || "en").slice(0, 10);
            const visitorHash = String(payload.visitorHash || "").slice(0, 32);

            // Record raw edge telemetry event
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

            // Record into pageview_events for SPEC-003 Daily Rollups
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
            // Edge telemetry errors discarded defensively
          }
        })(),
      );

      return new Response(JSON.stringify({ queued: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 5. Pageview analytics for GET requests
    const isGet = request.method === "GET";
    if (isGet) {
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const isStatic =
        STATIC_EXT_REGEX.test(pathname) || pathname.startsWith("/_astro/");
      const acceptHeader = request.headers.get("accept") || "";
      const isHtml = acceptHeader.includes("text/html");

      const secFetchDest = request.headers.get("sec-fetch-dest");
      const isDocumentNavigation = !secFetchDest || secFetchDest === "document";

      if (
        !isStatic &&
        isHtml &&
        isDocumentNavigation &&
        !isPrefetch &&
        env.DB
      ) {
        ctx.waitUntil(recordAnalytics(request, pathname, env.DB));
      }
    }

    // 6. Delegate to Static Assets
    const response = await env.ASSETS.fetch(request);

    // 7. Immutable Cache-Control for Hashed Assets & Specific PDF Cache Rules
    if (
      url.pathname.startsWith("/_astro/") ||
      url.pathname.startsWith("/fonts/")
    ) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(response.body, { status: response.status, headers });
    }

    if (url.pathname.endsWith(".pdf")) {
      const headers = new Headers(response.headers);
      headers.set(
        "Cache-Control",
        "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      );
      return new Response(response.body, { status: response.status, headers });
    }

    return response;
  },

  // Cron Trigger Engine for Analytics Rollups (SPEC-003 Section 2.3.2)
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

async function recordAnalytics(
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

    // 1. Extraer Parámetros de Atribución (UTM, Ref y Content/ID)
    let utmSource =
      url.searchParams.get("utm_source") || url.searchParams.get("ref");
    let utmMedium = url.searchParams.get("utm_medium");
    let utmCampaign = url.searchParams.get("utm_campaign");
    const utmContent = url.searchParams.get("utm_content") || "";
    const utmTerm = url.searchParams.get("utm_term") || "";

    // 2. Normalizar Referrer HTTP si no hay UTM explícito
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

    // 3. Fallback inteligente exhaustivo de Plataformas y Motores de Búsqueda
    if (!utmSource) {
      const ref = referrer.toLowerCase();

      // Buscadores (Organic Search)
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
      }
      // Redes Profesionales y Desarrollo
      else if (ref.includes("linkedin.com") || ref.includes("lnkd.in")) {
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
      }
      // Redes Sociales y Contenido
      else if (
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
      }
      // Mensajería y Trabajo en Equipo
      else if (ref.includes("whatsapp.com") || ref.includes("wa.me")) {
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
      }
      // Referrers genéricos o visitas directas
      else if (referrer !== "Direct" && referrer !== "Invalid") {
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

    // 2. Inserción en pageview_events para SPEC-003 Daily Rollups si no es bot
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
    console.error("[Analytics Error]:", err);
  }
}
