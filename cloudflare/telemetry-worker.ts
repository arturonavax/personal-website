/// <reference types="@cloudflare/workers-types" />

export interface Env {
  ANALYTICS_DB: D1Database;
  CF_VERSION_METADATA?: { id: string };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Public Edge Ingestion Endpoint
    if (url.pathname === "/api/v1/telemetry" && request.method === "POST") {
      try {
        const payload = (await request.json()) as {
          path: string;
          locale: string;
          referrer?: string;
          screenResolution?: string;
          connectionType?: string;
        };

        const country = request.headers.get("cf-ipcountry") || "UNKNOWN";
        const userAgent = request.headers.get("user-agent") || "UNKNOWN";
        const clientIp = request.headers.get("cf-connecting-ip") || "0.0.0.0";

        // Anonymized hash of client IP for unique visitors without cookies
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest(
          "SHA-256",
          encoder.encode(
            `${clientIp}-${new Date().toISOString().slice(0, 10)}`,
          ),
        );
        const visitorHash = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 16);

        await env.ANALYTICS_DB.prepare(
          `INSERT INTO edge_telemetry_events (
            id, timestamp, path, locale, country, user_agent, visitor_hash, referrer
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            crypto.randomUUID(),
            Date.now(),
            payload.path.slice(0, 255),
            payload.locale.slice(0, 10),
            country,
            userAgent.slice(0, 512),
            visitorHash,
            payload.referrer?.slice(0, 255) || null,
          )
          .run();

        return new Response(JSON.stringify({ status: "queued" }), {
          status: 202,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "https://arturonavax.dev",
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "invalid_payload" }), {
          status: 400,
        });
      }
    }

    // Fallback
    return new Response("Edge Gateway Operational", { status: 200 });
  },
};
