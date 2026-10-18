# Cloudflare Edge Infrastructure & Free-Tier Quota Guards

This portal is deployed to **Cloudflare Workers + Static Assets** and leverages Cloudflare's serverless primitives (D1, Vectorize, Workers AI, R2, Email Routing, and Zero Trust Access). The system is engineered with strict defensive guards and circuit breakers to operate robustly within the **Cloudflare Free Tier** without risk of service disruption or unexpected overages.

---

## 1. Cloudflare Free Tier Quota Architecture

The Cloudflare Free Tier provides generous allowances, but unmanaged traffic spikes, aggressive web crawlers, or speculative browser prefetching can quickly exhaust quotas if unmitigated. The table below outlines how this system enforces absolute safety:

| Cloudflare Primitive  | Free Tier Monthly/Daily Allowance                              | Quota Exhaustion Vector                               | Applied Architectural Guardrail                                                                                                                                      |
| :-------------------- | :------------------------------------------------------------- | :---------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1 Database (SQL)** | 100,000 writes / day<br>5,000,000 reads / day                  | Web crawlers, prefetch links, repeat dashboard visits | **Prefetch & Bot Circuit Breakers** (HTTP 204/202 bypass)<br>**In-memory telemetry read cache** (120s TTL)<br>**Daily write budget limit** (`D1_DAILY_WRITE_BUDGET`) |
| **Workers AI**        | 10,000 Neurons / day                                           | Search bot indexing, repeated query spam              | **Edge Cache API** (`caches.default`) for search results<br>**Instant fallback** to `StaticMemorySearchAdapter` (>350ms timeout or quota trip)                       |
| **Vectorize Index**   | 30,000 queries / month                                         | High-volume semantic searches                         | Shared with Workers AI caching; static vector snapshot fallback                                                                                                      |
| **R2 Object Storage** | 10,000,000 Class B reads / mo<br>1,000,000 Class A writes / mo | Visitor asset downloads                               | **Build-time sync**: content is baked into SSG `dist/`<br>**0 Class B reads** on static content delivery<br>Private bucket (no public domain exposure)               |
| **Workers CPU Time**  | 10 ms CPU per request                                          | Heavy compute on critical path                        | **Fast-path direct streaming** (< 0.5 ms CPU)<br>Asynchronous telemetry offloaded to `ctx.waitUntil()`                                                               |

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

### 2.5. Two-Layer Authoritative Pageview Deduplication (L1 Edge Cache + L2 DB)

Cloudflare Workers run globally across hundreds of independent ephemeral isolates. Relying strictly on in-memory deduplication risks duplicate records when consecutive requests hit different isolates or POPs.

- **Layer 1 (L1 Edge Cache API Absorption):** `computeVisitDedupeKey(ip, userAgent, path, timestamp)` computes a deterministic SHA-256 hash across a 30-minute bucket (`VISIT_DEDUPE_WINDOW_MS = 1_800_000`). Lookups check `caches.default` (`https://telemetry.internal/dedupe/${key}`). On cache hits, the visit is discarded immediately with **0 D1 reads and 0 D1 writes**.
- **Layer 2 (L2 Authoritative Database Deduplication):** A deterministic dedupe key is stored in `pageviews.dedupe_key` and `telemetry_events.dedupe_key` backed by `UNIQUE INDEX idx_pageviews_dedupe_key`. D1 automatically discards duplicates cross-isolate using `INSERT OR IGNORE`.
- **Atomic Batch Rollups:** Daily rollup counters are updated in the same transaction using `db.batch([pageviewInsert, rollupInsert])` with atomic upsert `INSERT INTO analytics_rollups ... ON CONFLICT DO UPDATE`, eliminating read-before-write race conditions.
- **SSR/ClientRouter Coordination:** On initial HTML document navigation, the Edge Worker emits `X-Edge-Visit-Logged: 1` and cookie `ev_init=1`. `EdgeViewCounter.astro` detects `ev_init=1` on initial load and suppresses duplicate client beaconing, while firing beacon telemetry only on subsequent `ClientRouter` SPA transitions and `pageshow` `bfcache` restores.

### 2.6. 5-Tier Progressive Degradation State Machine & R2 WAL (Zero Data Loss)

To withstand sudden virality or distributed bot floods without exceeding D1 daily quotas, `EdgeQuotaTracker` implements an automated 5-tier progressive degradation engine:

1. **Tier 0 (`NOMINAL` < 50% writes):** Full human telemetry, rollups, verified crawlers, contact leads, and prefetch tracking.
2. **Tier 1 (`CONSERVATIVE` 50% - 70% writes):** 100% of prefetch telemetry writes are frozen (`prefetch-circuit-breaker`). Generic bot logging is dropped while verified SEO/AI search engines (`Googlebot`, `ClaudeBot`, `GPTBot`, `PerplexityBot`) are recorded in rollups.
3. **Tier 2 (`COMPACT_ROLLUP` 70% - 85% writes):** Individual row logging to `pageviews` and `telemetry_events` is suspended. Visits are aggregated in isolate memory buffers (up to 25 events or 15s window) and flushed as atomic upserts to `analytics_rollups`.
4. **Tier 3 (`CRITICAL_SURVIVAL` 85% - 95% writes):** 100% of telemetry D1 writes are frozen, reserving remaining quota for business-critical `contact_leads`. Telemetry visits are dispatched to Cloudflare Analytics Engine and written to R2 WAL (`wal/telemetry/${dateUtc}/${isolateId}.ndjson`).
5. **Tier 4 (`R2_WAL_FALLBACK` >= 95% writes or D1 Exception):** All writes (both telemetry and contact leads) fall back to R2 WAL (`wal/leads/${uuid}.json`). The contact form continues to return `200 OK` (`walFallback: true`), guaranteeing **zero leads are ever lost**.

**Automated Replay Cron (`5 0 * * *`):** A daily cron trigger runs at 00:05 UTC (`reconcileR2WalToD1`), replaying all buffered R2 leads and telemetry into D1 and purging processed WAL objects.

### 2.7. Dynamically Configurable Quota Engine (Free Tier to Paid Plan)

Upgrading from Cloudflare Free Tier to Paid Plans requires **zero code modifications**, managed entirely via environment variables in `wrangler.jsonc` or Cloudflare dashboard:

- `CLOUDFLARE_PLAN_TIER`: `"free"` (default) | `"paid"` | `"unlimited"`.
- `D1_DAILY_WRITE_BUDGET`: Defaults to `100_000` (free), `50_000_000` (paid), or `Infinity` (unlimited).
- `D1_DAILY_READ_BUDGET`: Defaults to `5_000_000` (free), `250_000_000` (paid), or `Infinity` (unlimited).
- `WORKERS_DAILY_REQUEST_BUDGET`: Defaults to `100_000` (free) or `10_000_000` (paid).
- Ratios: `D1_TIER_CONSERVATIVE_RATIO` (0.50), `D1_TIER_COMPACT_RATIO` (0.70), `D1_TIER_SURVIVAL_RATIO` (0.85), `D1_TIER_WAL_RATIO` (0.95), `D1_PREFETCH_SAMPLE_RATE` (0.10 free, 1.0 paid).

### 2.8. Low-Quota `/admin` Dashboard Strategy

Opening the `/admin` telemetry dashboard twice a day never exhausts D1 row read quotas:

- **120-Second Edge Cache TTL:** Telemetry aggregates are cached in `caches.default` and memory for 120 seconds.
- **15-Second Cache-Buster Cooldown:** Rapid clicks on refresh buttons cannot bypass cache repeatedly.
- **Pagination via `page_only=1`:** Page or limit adjustments only fetch the paginated slice (`<= 25` rows read) rather than re-running the 6 heavy `GROUP BY` aggregations.
- **Eliminated Table Scans:** Total views are resolved from rollup tables rather than unbounded `SELECT COUNT(*) FROM pageviews`.

### 2.9. D1 Write Amplification Elimination & Compacted Schema

- Compacted all incremental migrations (`0001` through `0010`) into the baseline `0001_initial_schema.sql` and `schema.sql`.
- Pruned 5 redundant indexes on `pageviews`, dropping write amplification from ~12 down to ~4 rows per write (>65% reduction).
- Added deterministic reset script `cloudflare/d1/reset.sql` with npm scripts `db:reset:local` and `db:reset:remote`.

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

The administration and analytics portal is completely decoupled and shielded behind a multi-layered security perimeter:

### 4.1. Universal Worker Interception (`run_worker_first: true`)
- In `wrangler.jsonc`, `"run_worker_first": true` ensures that the Cloudflare Worker intercepts **100% of incoming requests** before Static Assets can serve files from disk.
- Any attempt to access `arturonavax.dev/admin`, `arturonavax.dev/admin/`, or `arturonavax.dev/*/admin*` is immediately intercepted and permanently redirected via **HTTP 308** to `https://admin.arturonavax.dev/`. Static HTML is never served without passing through worker verification.

### 4.2. Dual-Method Strict Authentication (`verifyAdminAuthorization`)
The worker enforces strict identity verification across both document navigations and API endpoints:
1. **Cloudflare Access Zero Trust Identity:**
   - Validates `cf-access-authenticated-user-email` against the authorized admin whitelist configured in `ADMIN_AUTHORIZED_EMAILS`.
   - Rejects unauthorized or spoofed emails with HTTP 401/403.
   - Inspects `cf-access-jwt-assertion` cryptographically.
2. **Admin API Key / Secret Token (`ADMIN_API_KEY`):**
   - Allows authorized administrators to authenticate via `Authorization: Bearer <key>`, query parameter `?token=<key>`, or secure session cookie `admin_session=<key>`.
   - Passing `?token=<key>` automatically sets an `HttpOnly`, `SameSite=Lax`, `Secure` session cookie for seamless 24-hour administration.

### 4.3. Universal API Shielding
All administrative endpoints are strictly protected:
- `/api/telemetry`
- `/api/metrics`
- `/api/leads`
- `/api/deployments`
- `/api/status`
- `/status`

Unauthenticated requests to any of these endpoints return **HTTP 401 Unauthorized** with `X-Robots-Tag: noindex, nofollow, noarchive` and `Cache-Control: no-store, private`.

### 4.4. 401 Authentication Challenge Screen
When an unauthenticated browser navigates to `https://admin.arturonavax.dev/`:
- The server responds with **HTTP 401 Unauthorized** and a clean, dark-mode challenge screen.
- Provides direct single-click redirection to the Cloudflare Zero Trust authentication gateway.
- Includes a secure token entry form to unlock the console via `ADMIN_API_KEY`.
- **Zero data leakage:** No metrics, charts, visitor logs, or database rows are emitted in unauthenticated responses.

### 4.5. Comprehensive Cloudflare Quota Telemetry in Admin UI
The admin dashboard surfaces live usage, limits, and degradation tiers across all Cloudflare primitives:
- **Workers Requests:** Daily (100k limit) & 30-day cumulative rolling usage.
- **D1 Database Reads:** Daily rows read (5M limit) with edge memory cache indicators.
- **D1 Database Writes:** Daily rows written (100k limit) with color-coded degradation tier indicators (`NOMINAL`, `CONSERVATIVE`, `COMPACT_ROLLUP`, `CRITICAL_SURVIVAL`, `R2_WAL_FALLBACK`).
- **D1 Database Storage:** Current DB size vs 5 GB maximum.
- **Workers AI:** Daily neuron consumption vs 10k free daily allocation.
- **Vectorize Index:** Semantic search queries & dimensions vs monthly allowance.
- **R2 Storage & Operations:** Class A mutations (1M limit), Class B reads (10M limit), and storage volume (10 GB limit).
- **Zero Trust:** Active seats vs 50 seats included in the free tier.

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
