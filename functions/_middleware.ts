/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB?: D1Database;
}

const STATIC_EXT_REGEX =
  /\.(?:css|js|mjs|map|json|png|jpg|jpeg|webp|svg|ico|gif|woff|woff2|ttf|eot|xml|txt|pdf)$/i;
const BOT_REGEX = /bot|spider|crawl|slurp|semrush|ahrefs|yandex|bytespider/i;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context;

  if (request.method !== "GET") {
    return next();
  }

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, "") || "/";

  // 1. Ignorar assets estáticos y bundles internos de Astro
  if (STATIC_EXT_REGEX.test(pathname) || pathname.startsWith("/_astro/")) {
    return next();
  }

  // 2. Filtrar peticiones HTML reales (ignora prefetchs automáticos del navegador)
  const acceptHeader = request.headers.get("accept") || "";
  const isHtml = acceptHeader.includes("text/html");
  const isPrefetch =
    request.headers.get("sec-purpose") === "prefetch" ||
    request.headers.get("purpose") === "prefetch";

  // 3. Ejecución en segundo plano sin demorar la respuesta estática
  if (isHtml && !isPrefetch && env.DB) {
    context.waitUntil(recordAnalytics(request, pathname, env.DB));
  }

  return next();
};

async function recordAnalytics(
  request: Request,
  path: string,
  db: D1Database,
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
        if (refUrl.hostname !== new URL(request.url).hostname) {
          referrer = refUrl.hostname;
        }
      } catch {
        referrer = "Invalid";
      }
    }

    const isBot = BOT_REGEX.test(userAgent) ? 1 : 0;

    // Hash diario rotativo (GDPR compliant: no almacena la IP original)
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
        `INSERT INTO pageviews (path, visitor_hash, referrer, country, is_bot, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      )
      .bind(path, visitorHash, referrer, country, isBot)
      .run();
  } catch (err) {
    console.error("Analytics tracking error:", err);
  }
}
