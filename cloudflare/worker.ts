/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const STATIC_EXT_REGEX =
  /\.(?:css|js|mjs|map|json|png|jpg|jpeg|webp|avif|svg|ico|gif|woff|woff2|ttf|eot|xml|txt|pdf|webmanifest)$/i;

const BOT_REGEX =
  /bot|spider|crawl|slurp|semrush|ahrefs|yandex|bytespider|gptbot|claudebot|perplexity|anthropic|cohere|applebot/i;

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

    // 2. Telemetry Ingestion Endpoint
    if (url.pathname === "/api/v1/telemetry" && request.method === "POST") {
      if (isPrefetch) {
        // Discard prefetch requests immediately without hitting D1
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

            await env.DB.prepare(
              `INSERT INTO edge_telemetry_events (
                id, timestamp, path, locale, country, user_agent, visitor_hash
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
              .bind(
                crypto.randomUUID(),
                Date.now(),
                String(payload.path || "").slice(0, 255),
                String(payload.locale || "en").slice(0, 10),
                country,
                userAgent,
                String(payload.visitorHash || "").slice(0, 32),
              )
              .run();
          } catch {
            // Edge telemetry errors are discarded to prevent client disruptions
          }
        })(),
      );

      return new Response(JSON.stringify({ queued: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Pageview analytics for GET requests
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

    // 4. Delegate to Static Assets
    const response = await env.ASSETS.fetch(request);

    // 5. Immutable Cache-Control for Hashed Assets
    if (
      url.pathname.startsWith("/_astro/") ||
      url.pathname.startsWith("/fonts/")
    ) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(response.body, { status: response.status, headers });
    }

    return response;
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

    // Inserción en D1 con límites defensivos en longitud
    await db
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
  } catch (err) {
    console.error("[Analytics Error]:", err);
  }
}
