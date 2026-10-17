# Cloudflare Edge Infrastructure & Free-Tier Quota Guards

This portal is deployed to **Cloudflare Workers + Static Assets** and leverages Cloudflare's serverless primitives (D1, Vectorize, Workers AI, R2, Email Routing, and Zero Trust Access). The system is engineered with strict defensive guards and circuit breakers to operate robustly within the **Cloudflare Free Tier** without risk of service disruption or unexpected overages.

---

## 1. Cloudflare Free Tier Quota Architecture

The Cloudflare Free Tier provides generous allowances, but unmanaged traffic spikes, aggressive web crawlers, or speculative browser prefetching can quickly exhaust quotas if unmitigated. The table below outlines how this system enforces absolute safety:

| Cloudflare Primitive | Free Tier Monthly/Daily Allowance | Quota Exhaustion Vector | Applied Architectural Guardrail |
| :--- | :--- | :--- | :--- |
| **D1 Database (SQL)** | 100,000 writes / day<br>5,000,000 reads / day | Web crawlers, prefetch links, repeat dashboard visits | **Prefetch & Bot Circuit Breakers** (HTTP 204/202 bypass)<br>**In-memory telemetry read cache** (120s TTL)<br>**Daily write budget limit** (`D1_DAILY_WRITE_BUDGET`) |
| **Workers AI** | 10,000 Neurons / day | Search bot indexing, repeated query spam | **Edge Cache API** (`caches.default`) for search results<br>**Instant fallback** to `StaticMemorySearchAdapter` (>350ms timeout or quota trip) |
| **Vectorize Index** | 30,000 queries / month | High-volume semantic searches | Shared with Workers AI caching; static vector snapshot fallback |
| **R2 Object Storage** | 10,000,000 Class B reads / mo<br>1,000,000 Class A writes / mo | Visitor asset downloads | **Build-time sync**: content is baked into SSG `dist/`<br>**0 Class B reads** on static content delivery<br>Private bucket (no public domain exposure) |
| **Workers CPU Time** | 10 ms CPU per request | Heavy compute on critical path | **Fast-path direct streaming** (< 0.5 ms CPU)<br>Asynchronous telemetry offloaded to `ctx.waitUntil()` |

---

## 2. Defensive Circuit Breakers & Ingestion Guards

### 2.1. Prefetch Telemetry Shielding (`PrefetchQuotaCircuitBreaker`)
Modern browsers (Chrome, Edge, Firefox) aggressively prefetch links when hovering or entering the viewport (`Sec-Purpose: prefetch`, `Purpose: prefetch`, `X-Astro-Prefetch`).
- If every speculative prefetch wrote a row to D1, an active user browsing links could burn hundreds of writes in seconds.
- **The Guard:** In `cloudflare/worker.ts`, requests bearing prefetch indicators are checked against `prefetchCircuitBreaker`. If prefetch limits are approached or `ENABLE_PREFETCH_TELEMETRY=false`, the telemetry ingestion terminates early or returns HTTP 204 No Content.
- User document delivery is **never impacted**; only background D1 ingestion is shielded.

### 2.2. Bot Telemetry Shielding (`BotQuotaCircuitBreaker`)
Search indexers, SEO crawlers, and AI spiders (e.g. `GPTBot`, `ClaudeBot`, `SemrushBot`, `AhrefsBot`) visit dozens of pages per minute.
- Writing analytics for bots wastes D1 write operations without providing genuine user behavioral metrics.
- **The Guard:** The worker matches the `User-Agent` against `BOT_REGEX`. When a known crawler is identified, analytics writes are skipped, saving tens of thousands of D1 writes per week.

### 2.3. In-Memory Telemetry Read Caching (120-Second TTL)
Repeated visits to telemetry dashboards or analytics endpoints (`/api/telemetry`) can generate thousands of row read queries on D1.
- **The Guard:** In-memory edge caching (`telemetryCache`) stores computed telemetry summaries for 120 seconds. Identical or concurrent requests are served directly from RAM without touching D1.

### 2.4. Semantic Search Fail-Open & Cache Hierarchy
The search endpoint (`/api/search`) implements a dual-tier architecture:
1. **Tier 1 (Edge Cache):** Queries are cached in `caches.default` for 3600 seconds (`s-maxage=3600, stale-while-revalidate=86400`).
2. **Tier 2 (Workers AI + Vectorize):** Executes embedding generation via `@cf/baai/bge-small-en-v1.5` and queries Vectorize.
3. **Tier 3 (Fail-Open Static Memory Fallback):** If Vectorize or Workers AI throws an error, exceeds the 350 ms latency budget, or runs out of Neurons, the worker seamlessly delegates to `StaticMemorySearchAdapter`, searching the pre-indexed JSON catalogue without returning an HTTP 500.

---

## 3. Subdomain Routing & 308 Canonicalization

The portal supports thematic vanity subdomains for clean branding, direct sharing, and marketing campaigns:

```
  blog.arturonavax.dev         ──► HTTP 308 ──► https://arturonavax.dev/blog/
  projects.arturonavax.dev     ──► HTTP 308 ──► https://arturonavax.dev/projects/
  services.arturonavax.dev     ──► HTTP 308 ──► https://arturonavax.dev/services/
  experience.arturonavax.dev   ──► HTTP 308 ──► https://arturonavax.dev/experience/
  resume.arturonavax.dev       ──► HTTP 308 ──► https://arturonavax.dev/resume/
  maker.arturonavax.dev        ──► HTTP 308 ──► https://arturonavax.dev/tools/resume-maker/
```

### Why HTTP 308 (Permanent Redirect)?
1. **Preserves HTTP Method & Body:** Unlike 301/302, 308 strictly forbids the client from changing the HTTP request method.
2. **SEO PageRank Consolidation:** Search engines transfer 100% of the backlink equity directly to the canonical apex URL, preventing duplicate content penalties across subdomains.
3. **Zero Overhead:** Resolved at the edge before any asset lookup or heavy worker logic.

### Routing Configuration in `wrangler.jsonc`
In `wrangler.jsonc`, custom domain routes ensure direct routing into the worker:
```jsonc
"routes": [
  { "pattern": "arturonavax.dev", "custom_domain": true },
  { "pattern": "admin.arturonavax.dev", "custom_domain": true },
  { "pattern": "blog.arturonavax.dev", "custom_domain": true }
]
```

---

## 4. Zero Trust Isolated Admin Surface (`admin.arturonavax.dev`)

The administration and analytics portal (`/admin`) is completely decoupled from the public apex domain:
- Any visitor attempting to access `arturonavax.dev/admin` or `arturonavax.dev/admin/*` is immediately redirected via HTTP 308 to `https://admin.arturonavax.dev`.
- `admin.arturonavax.dev` is protected by **Cloudflare Access (Zero Trust)** policies requiring hardware WebAuthn keys or GitHub OAuth identity verification.
- Public HTML responses on the apex never include administrative code, cookies, or authorization tokens.

---

## 5. Background Scheduled Cron (`0 2 * * *`)

A daily cron trigger runs at 02:00 UTC (`triggers: { crons: ["0 2 * * *"] }`):
- Executes `handleAnalyticsRollup(env)` in `cloudflare/cron-scheduler.ts`.
- Aggregates daily telemetry rows into compact rollups (`analytics_rollups` table).
- Automatically purges raw telemetry logs older than 30 days to keep D1 storage well below the 5 GB Free Tier storage quota.

---

## 6. Serverless Corporate Email Routing

Incoming emails sent to `@arturonavax.dev` (e.g. `arturo@arturonavax.dev`) are ingested serverlessly via Cloudflare Email Routing:
- Processed by `email-worker.ts` via the `email(message, env, ctx)` handler.
- Automatically validates SPF, DKIM, and DMARC headers.
- Parses incoming messages and forwards authorized leads to verified personal destinations or webhook channels (Discord / Slack / Telegram).
