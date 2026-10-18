ROLE & OBJECTIVE
Act as a Principal Systems & Edge Performance Architect. Execute the following 7 production-hardening tasks on the `personal-website` repository to eliminate residual edge cases in Cron subrequest limits, mobile IPv6 deduplication, R2 bundle garbage collection, Markdown content-negotiation cache isolation, dynamic IndexNow key verification, and vertical JSON-LD/hreflang wiring across all `[slug].astro` routes.

---

TASK 1: SUBREQUEST-SAFE R2 WAL REPLAY & BATCH DELETE IN `cloudflare/cron-scheduler.ts`
Files to modify:

- `cloudflare/cron-scheduler.ts`
- `src/lib/adapters/cloudflare/r2-storage.adapter.ts`

Instructions:

1. Cloudflare Workers Free Tier enforces a strict limit of 50 subrequests per invocation (including Cron Triggers).
2. In `cloudflare/cron-scheduler.ts`, cap WAL replay to process at most 20 WAL objects per Cron execution (`limit: 20` on R2 list).
3. Aggregate all parsed telemetry records from those 20 WAL files in memory first, then execute a SINGLE `env.DB.batch(statements)` call (1 subrequest) to upsert `analytics_rollups` and insert `contact_leads`.
4. Delete all processed WAL keys from R2 in a SINGLE bulk call `await env.R2_BUCKET.delete(processedKeys)` (1 subrequest) instead of deleting keys one by one in a loop.

---

TASK 2: ISOLATE-SAFE `COMPACT_ROLLUP` & PIGGYBACKED QUOTA TRACKING
Files to modify:

- `src/lib/adapters/cloudflare/circuit-breaker.adapter.ts`
- `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts`

Instructions:

1. In `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts`, ensure that when operating in `COMPACT_ROLLUP` tier (70%-85% quota), visits are never left buffered in volatile isolate memory after `ctx.waitUntil()` completes. Instead, write directly to `analytics_rollups` using a single `INSERT INTO analytics_rollups ... ON CONFLICT DO UPDATE` statement (1 row written, 0 raw `telemetry_events` written), or flush immediately within the current request's `ctx.waitUntil()` lifecycle.
2. In `src/lib/adapters/cloudflare/circuit-breaker.adapter.ts`, never execute standalone D1 `UPDATE quota_state_daily` queries on every request. Piggyback the `quota_state_daily` upsert statement into the existing `env.DB.batch()` call only when flushing telemetry, and cache the read state in `caches.default` for 300 seconds.

---

TASK 3: IPV6 `/64` SUBNET NORMALIZATION, FIRST-PARTY ANONYMOUS COOKIE & `ev_init` CLEANUP
Files to modify:

- `cloudflare/worker.ts`
- `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts`
- `src/components/ui/EdgeViewCounter.astro`

Instructions:

1. In `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts` and `cloudflare/worker.ts`, normalize IPv6 addresses before computing `dedupe_key` by truncating to the `/64` prefix (first 4 colon-separated hextets, e.g. `ip.split(':').slice(0, 4).join(':')`) so mobile Dual-Stack / privacy-extension IP rotation does not cause duplicate visits.
2. In `cloudflare/worker.ts`, validate `/api/telemetry/collect` `POST` requests: reject requests where `Sec-Fetch-Site` is present and not `same-origin`, and sanitize `path` against valid route patterns (rejecting arbitrary random strings longer than 180 chars or containing invalid characters) to prevent D1 cardinality attacks.
3. In `src/components/ui/EdgeViewCounter.astro`, immediately clear the `ev_init` cookie (`document.cookie = 'ev_init=; Max-Age=0; Path=/; SameSite=Lax'`) as soon as the initial load check consumes it, ensuring subsequent manual reloads (`F5`) after the 30-minute window are properly evaluated.

---

TASK 4: CACHE POISONING PREVENTION (`Vary: Accept`) FOR AI MARKDOWN NEGOTIATION
Files to modify:

- `cloudflare/worker.ts`
- `public/_headers`

Instructions:

1. In `cloudflare/worker.ts`, whenever a route supports AI Content Negotiation (`Accept: text/markdown`), append `Vary: Accept` to both HTML and Markdown responses so Cloudflare CDN and browser caches never serve cached Markdown to a human browser requesting `Accept: text/html`.
2. When caching Markdown responses in `caches.default` inside `cloudflare/worker.ts`, use a distinct synthetic cache key URL (`new URL(request.url).origin + pathname + '?__format=markdown'`).

---

TASK 5: R2 BUNDLE GARBAGE COLLECTION IN `scripts/r2-push.mjs`
Files to modify:

- `scripts/r2-push.mjs`
- `scripts/lib/r2-content.mjs`

Instructions:

1. In `scripts/r2-push.mjs`, before uploading the updated `content/_manifest.v2.json`, record the previous `bundleKey` from the remote manifest.
2. After the new `content/_bundle-${shortHash}.tar.gz` and `content/_manifest.v2.json` are successfully uploaded, delete obsolete bundle archives from R2 (`DeleteObject` is free in Cloudflare R2) while keeping at most the current and immediately previous bundle for rollback safety. This prevents exhausting the 10 GB R2 Free Tier storage cap over time.

---

TASK 6: WIRE VERTICAL JSON-LD SCHEMAS & VERIFIED `availableLocales` IN ALL DYNAMIC PAGES
Files to modify:

- `src/pages/[...lang]/blog/[slug].astro`
- `src/pages/[...lang]/projects/[slug].astro`
- `src/pages/[...lang]/services/[slug].astro`
- `src/pages/[...lang]/experience/[slug].astro`
- `src/pages/[...lang]/resume/index.astro`

Instructions:

1. In `src/pages/[...lang]/projects/[slug].astro`, `src/pages/[...lang]/services/[slug].astro`, `src/pages/[...lang]/experience/[slug].astro`, and `src/pages/[...lang]/blog/[slug].astro`, compute `availableLocales` by checking which locales actually have a matching entry for the current `slug` in the content collection, and pass `availableLocales` down to `BaseLayout.astro` / `ArticleLayout.astro` -> `SEOHead.astro` so `hreflang` tags never point to 404 translations.
2. Pass explicit vertical schema props to `BaseLayout.astro` / `SEOHead.astro`:
   - `src/pages/[...lang]/projects/[slug].astro`: emit `SoftwareSourceCode` node in `@graph` with `codeRepository`, `programmingLanguage`, and `runtimePlatform`.
   - `src/pages/[...lang]/services/[slug].astro`: emit `Service` node in `@graph` with `provider` linked to `#person` and `areaServed: "Worldwide"`.
   - `src/pages/[...lang]/resume/index.astro`: emit `ProfilePage` node in `@graph` with `mainEntity: { "@id": "https://arturonavax.dev/#person" }`.

---

TASK 7: DYNAMIC `IndexNow` KEY SERVING & SYNC VALIDATION
Files to modify:

- `cloudflare/worker.ts`
- `scripts/r2-push.mjs`

Instructions:

1. In `cloudflare/worker.ts`, intercept `GET /indexnow-key.txt` and `GET /.well-known/indexnow-key.txt`: if `env.INDEXNOW_KEY` is configured, return `new Response(env.INDEXNOW_KEY.trim(), { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } })` so the verification file always matches the production secret.
2. In `scripts/r2-push.mjs`, include `"keyLocation": "${siteUrl}/indexnow-key.txt"` in the IndexNow JSON payload and skip IndexNow notification with a clear warning if `INDEXNOW_KEY` is still set to the placeholder hash `e3b0c44298fc1c149afbf4c8996fb924`.

---

VERIFICATION
Update `tests/spec-011/edge-telemetry-dedupe.test.ts` and `tests/spec-012/seo-aeo-and-db-compaction.test.ts` to test:

1. IPv6 `/64` subnet normalization produces identical `dedupe_key` values across ephemeral interface suffixes.
2. `cloudflare/cron-scheduler.ts` processes WAL files using batch D1 execution and bulk R2 delete within `< 25` subrequests.
3. `Vary: Accept` is present on Markdown-negotiated routes.
4. Run `pnpm run typecheck && pnpm test && pnpm run build` and ensure 100% pass rate.
