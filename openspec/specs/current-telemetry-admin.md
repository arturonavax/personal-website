# Current contract: telemetry, quotas, data and admin

Baseline: `4187033` (2026-10-23). Status: implemented behavior inspected in source; this document does not certify production persistence or account configuration. See [specification precedence](README.md), [edge/security contract](current-edge-operations.md), and [SPA contract](current-spa.md).

## Scope and data flow

```text
successful public HTML GET -> Worker -> ASSETS -> response
                              └─ waitUntil(recordAnalyticsNonBlocking)
Astro navigation / cached job commit / bfcache -> singleton browser collector
                              └─ POST /api/telemetry/collect -> D1TelemetryAdapter
both ingestion paths -> shared visitor/path dedupe -> tier-dependent D1 or R2 WAL
D1 pageview_events -> scheduled daily summary; R2 WAL -> bounded scheduled replay
protected dashboard -> telemetry / metrics / deployments / leads APIs
```

The initial document is recorded server-side; committed browser-only navigations need the beacon. Blocking browser JavaScript or beacons therefore preserves initial-document recording, not every SPA event. The two paths share suppression helpers. At NOMINAL quota, accepted collector visits also project into the dashboard `pageviews` ledger and, for humans, `pageview_events` in the same D1 batch. They MUST NOT be described as one identical table pipeline or as globally exactly-once delivery.

## TEL-01 — Initial documents and committed browser routes

- Successful public `GET` documents with status `200`/`304`, a D1 binding and eligible request classification MUST schedule analytics through `ctx.waitUntil()` after asset retrieval. Static assets, scanner paths, failures and speculative navigation are not human visits.
- The `X-Edge-Visit-Logged: 1` response marker and five-second `ev_init` cookie indicate scheduling eligibility, not durable database acknowledgement.
- `installEdgeTelemetry()` MUST mount once in BaseLayout. The first `astro:page-load` clears `ev_init` and refreshes optional counters without another initial beacon.
- Subsequent `astro:page-load`, `site:route-committed` and persisted `pageshow` events MUST capture the current path immediately. Same-path SPA notifications are coalesced; bfcache restoration remains eligible. Beacon dispatch is immediate, with keepalive-fetch fallback; only optional count refresh waits for idle (3,500ms timeout, or a 3,000ms timer).
- Successful speculative document `GET` responses (`200`/`304`) identified by `purpose`, `sec-purpose`, `X-Astro-Prefetch` or `astro-prefetch` query markers are eligible for the isolated `prefetch_analytics_events` logger. The query marker is not a telemetry bypass. Explicit operational bypass, sampling, kill switch and quota guards remain effective; these rows never increment committed human visits. Failed requests, static assets and `HEAD` do not record prefetch events.
- Cached experience arrows and history commits MUST emit `site:route-committed` after the successful commit. Their speculative HTML fetches MUST carry `X-Astro-Prefetch: true` and MUST NOT count as committed visits.

**Scenario:** Given an initial HTML load, when a cached job arrow commits a different pathname, then the existing collector sends that committed pathname without remounting the shell or relying on another network HTML request.

Evidence: [`edge-telemetry.ts`](../../src/scripts/edge-telemetry.ts), [`BaseLayout`](../../src/layouts/BaseLayout.astro), [`experience detail`](../../src/pages/[...lang]/experience/[slug].astro), `recordAnalyticsNonBlocking` in [`worker.ts`](../../cloudflare/worker.ts). Tests: [`timeline-telemetry.spec.ts`](../../tests/timeline-telemetry.spec.ts), [`spa-continuity.spec.ts`](../../tests/spa-continuity.spec.ts).

## TEL-02 — Public collection interfaces

| Endpoint                          | Input and outcome                                                                                                                                                                       | Boundary/failure behavior                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/telemetry/collect`     | JSON `path`, `referrer`, `trigger`/`eventType`; events normalize to `pageview`, `spa_transition`, `bfcache` or `beacon`; `202` JSON includes `recorded`, `deduped`, storage/tier fields | Non-POST methods enter the protected-method boundary first; an authorized request reaching this handler returns `405`; declared/body length over 1,024 `413`; supplied `Sec-Fetch-Site` other than `same-origin` `403`; invalid/oversized/scanner/static path `400`. Raw path limit 180. A missing fetch-site header is not independently rejected by this handler. Parse/storage exceptions become non-recorded `202`, not proof of success. |
| `GET /api/telemetry/views?path=…` | Normalizes path, sums matching `analytics_rollups.views`; falls back to human `pageviews` count when zero; JSON `path`, `views`, `cached`                                               | Cache API TTL 60s; response permits stale-while-revalidate 300s. Missing DB or survival tier returns `200`, zero and `degraded: true`; query failures are fail-open. This is not a live, exact cardinality API.                                                                                                                                                                                                                               |
| `POST /api/v1/telemetry`          | Separate compatibility ingestion, `202 {status: "queued", queued: true}`; writes `edge_telemetry_events` only                                                                           | Prefetch `204`; validates same-origin fetch metadata or same-host Origin fallback, caps declared/read body, rejects bots/budget pressure, derives visitor hash server-side. It does not feed `pageview_events`.                                                                                                                                                                                                                               |

**Scenario:** Given duplicate collection in the same suppression window, when the second beacon arrives, then it can return `202` with `recorded: false`, `deduped: true`, `storageTier: "L1_CACHE"` without a D1 write. A `202` alone MUST NOT be reported as persisted-event proof.

Evidence: `handleTelemetryCollectBeacon`, `handleTelemetryViewsRead`, `handleTelemetryIngestion` in [`worker.ts`](../../cloudflare/worker.ts). Tests: [`edge-telemetry-dedupe.test.ts`](../../tests/spec-011/edge-telemetry-dedupe.test.ts), [`odd-tasks.test.ts`](../../tests/odd-tasks.test.ts).

## TEL-03 — Identity, dedupe, attribution and meaning

- The server MUST derive visitor hashes from normalized IP/user-agent/day rather than trusting a client identity. This is pseudonymous processing, not a claim of anonymous data or legal compliance.
- L1 suppression MUST precede expensive D1 ingestion: per-isolate memory plus `caches.default`, 30-minute buckets derived from normalized IP, the first 120 user-agent characters and canonical path. TTL is 1,800s; the digest is SHA-256 truncated to 16 bytes. Cache failures fall back to available mechanisms.
- Raw `pageviews` use a unique dedupe key and previous-bucket probe to avoid a boundary duplicate; `telemetry_events` has its own unique dedupe index. L1 caches are regional/isolate-scoped, not a distributed transaction or global lock.
- UTM source/medium/campaign/content/term and normalized referrer MUST preserve the existing attribution parser, including direct fallbacks and legacy-invalid cleanup. Bot classification uses available Cloudflare signals and user-agent heuristics; absence of a provider bot signal is not proof of humanity.
- `analytics_rollups.uniques` increments per accepted deduped visit; it is NOT an exact distinct-person measure across dates, devices or routes. Admin raw distinct-hash totals also rotate with the daily visitor hash.

**Scenario:** Given the same normalized visitor/path in one suppression bucket, when document and beacon paths race, then the shared suppression mechanism may collapse the repeat; after daily hash rotation, distinct-hash analytics MUST NOT be interpreted as a stable person identifier.

Evidence: `computeVisitorHash`, `computeDedupeKey`, `parseAttribution`, `classifyVisitor` in [`worker.ts`](../../cloudflare/worker.ts); [`d1-telemetry.adapter.ts`](../../src/lib/adapters/cloudflare/d1-telemetry.adapter.ts). Tests: [`utm-attribution.test.ts`](../../tests/spec-005/utm-attribution.test.ts), [`visitor-classification.test.ts`](../../tests/spec-005/visitor-classification.test.ts), [`edge-telemetry-dedupe.test.ts`](../../tests/spec-011/edge-telemetry-dedupe.test.ts).

## TEL-04 — Progressive quota policy

The policy is application-level risk reduction, not enforcement of every provider/account limit. The highest of read/write utilization selects the tier; a recognized D1 quota exception forces WAL fallback. State resets at UTC day rollover. Defaults from `resolveQuotaConfig()`:

| Setting              | Free default | Paid code default | Unlimited code default |
| -------------------- | ------------ | ----------------- | ---------------------- |
| D1 writes/day        | 100,000      | 50,000,000        | Infinity               |
| D1 reads/day         | 5,000,000    | 250,000,000       | Infinity               |
| Worker requests/day  | 100,000      | 10,000,000        | Infinity               |
| Prefetch sample rate | 0.10         | 1.0               | 1.0                    |

These paid **daily application budgets are not the provider's monthly included allocations**. Changing `CLOUDFLARE_PLAN_TIER` does not purchase or change a Cloudflare plan. Overrides: `D1_DAILY_WRITE_BUDGET`, `D1_DAILY_READ_BUDGET`, `WORKERS_DAILY_REQUEST_BUDGET`, `D1_TIER_{CONSERVATIVE,COMPACT,SURVIVAL,WAL}_RATIO`, `D1_{BOT,PREFETCH,VISIT}_BUDGET_RATIO`, `D1_PREFETCH_SAMPLE_RATE`.

| Tier                | Default threshold       | Implemented behavior                                                                                                                                                                                        |
| ------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOMINAL`           | below 50%               | Normal document raw `pageviews` plus human `pageview_events`; collector adapter writes raw `telemetry_events` and compact rollup.                                                                           |
| `CONSERVATIVE`      | 50%                     | Prefetch writes stop; bot shedding becomes stricter. Document visits switch to the adapter, whose tier-1 path still writes raw `telemetry_events` and rollup. Do not infer rollup-only from older comments. |
| `COMPACT_ROLLUP`    | 70%                     | Adapter skips raw telemetry and directly upserts `analytics_rollups`.                                                                                                                                       |
| `CRITICAL_SURVIVAL` | 85%                     | Visits spill to R2 WAL/optional Analytics Engine; public counter and most dashboard data paths avoid normal analytics reads. Contact leads can still use D1.                                                |
| `R2_WAL_FALLBACK`   | 95% or hard quota error | Visits and web-contact leads use configured R2 WAL; recovery remains best-effort.                                                                                                                           |

Prefetch/bot/visit default budget fractions are 25%/15%/65%; these are guard thresholds, not disjoint resource reservations. Prefetch has a 3:1 prefetch-to-visit guard after 100 samples, sample-rate control and `ENABLE_PREFETCH_TELEMETRY` kill switch. Bots have their own gate and `ENABLE_BOT_TELEMETRY`; the checked-in Wrangler configuration disables bot recording. Synthetic low-quota mode is `SIMULATE_LOW_DB_QUOTA`.

`EdgeQuotaTracker` records available D1 metadata and estimated counts; quota-state upserts are amortized (25 recorded-write operations), cache synchronization has a 50-operation cadence, and cross-isolate state is reconciled using maxima. It is not an exact account-global metering service. Some dashboard service budgets and usage are estimates rather than provider billing telemetry.

**Scenario:** Given utilization at the survival threshold, when a visit is ingested, then the adapter selects the WAL path and the public counter returns a degraded response instead of spending normal D1 reads. Content delivery remains independent of analytics failure; persistence is not guaranteed if every sink is unavailable.

Evidence: [`circuit-breaker.adapter.ts`](../../src/lib/adapters/cloudflare/circuit-breaker.adapter.ts), [`prefetch-circuit-breaker.adapter.ts`](../../src/lib/adapters/cloudflare/prefetch-circuit-breaker.adapter.ts), [`bot-circuit-breaker.adapter.ts`](../../src/lib/adapters/cloudflare/bot-circuit-breaker.adapter.ts). Tests: [`prefetch-circuit-breaker.test.ts`](../../tests/spec-010/prefetch-circuit-breaker.test.ts), [`edge-telemetry-dedupe.test.ts`](../../tests/spec-011/edge-telemetry-dedupe.test.ts).

## TEL-05 — Data model and maintenance

[`schema.sql`](../../cloudflare/d1/schema.sql) describes the baseline tables; [`migrations/`](../../cloudflare/d1/migrations/) contains ten numbered migrations. They MUST NOT be described as one migration file. Bootstrap, incremental upgrade and destructive reset are distinct operations; [`reset.sql`](../../cloudflare/d1/reset.sql) is not an ordinary upgrade.

| Dataset                                                  | Responsibility and keys                                                                                              | Current scheduled retention          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `pageviews`                                              | Document raw visits, attribution, bot flag, timestamp; unique dedupe key; analytics/visitor/attribution/time indexes | Deletes older than 30 days           |
| `pageview_events`                                        | Human document events for locale/country summaries; timestamp index                                                  | Deletes older than 7 days            |
| `edge_telemetry_events`                                  | Compatibility ingestion; text ID, epoch timestamp, locale/country/UA/visitor hash                                    | Deletes older than 7 days            |
| `telemetry_events`                                       | Adapter raw visits with event/device/referrer/status; unique dedupe key and time index                               | No pruning statement in current cron |
| `analytics_rollups`                                      | `(date,path)` WITHOUT ROWID; views/uniques/human/bot counts                                                          | No current cron pruning              |
| `pageviews_daily_summary`                                | `(summary_date,path,locale,country)` WITHOUT ROWID; total views                                                      | No current cron pruning              |
| `prefetch_analytics_events`                              | Isolated speculative events; creation-time index                                                                     | Deletes older than 30 days           |
| `quota_state_daily`                                      | UTC-day estimates/tier, WITHOUT ROWID                                                                                | No current cron pruning              |
| `circuit_breaker_incidents` / `v_prefetch_daily_summary` | Daily subsystem incident, reason/shed count/completeness and reporting view                                          | No current cron pruning              |
| `contact_leads`                                          | Contact identity/message/locale plus optional geo/network/security fields; time/locale/IP/country/ASN indexes        | No current cron pruning              |
| `system_deployments`                                     | Release/worker/commit/time/environment/status/compatibility/metadata registry                                        | No current cron pruning              |

The deployment registry's seeded row is baseline metadata, not proof of the currently deployed Git commit. D1 indexes reduce scans but add write work; table row counts alone do not equal provider billed rows.

WAL records use `wal/telemetry/<UTC-date>/<isolate>-<unique>.ndjson` and `wal/leads/<uuid>.json` in the resolved R2 bucket (`R2_BUCKET`, then `CONTENT_BUCKET`, then `STORAGE_BUCKET`). Optional Analytics Engine receives telemetry only when its binding exists; it is not configured in the baseline Wrangler file. Sink errors are caught; a selected `R2_WAL` response is not a verified durable receipt.

Both configured schedules (`0 2 * * *`, `5 0 * * *`, UTC) currently call the same `handleAnalyticsRollup()`; the handler does not branch on cron name. It aggregates the preceding 24h into `pageviews_daily_summary` with additive conflict updates, prunes the rows listed above, then replays up to **20 total WAL objects**, telemetry keys first and leads using remaining slots. Successfully processed keys are removed after database work. Repeated/overlapping rollups are not idempotent; the schedules do not provide exactly-once totals or a bounded backlog-drain time.

**Scenario:** Given more than 20 WAL objects, when one scheduled pass runs, then only its bounded object set is eligible for replay; remaining objects await future passes. No claim that a day of traffic is always replayed in one invocation is valid.

Evidence: [`cron-scheduler.ts`](../../cloudflare/cron-scheduler.ts), [`deployment-registry.adapter.ts`](../../src/lib/adapters/cloudflare/deployment-registry.adapter.ts). Tests: [`deployment-registry.test.ts`](../../tests/deployment-registry.test.ts), [`edge-telemetry-dedupe.test.ts`](../../tests/spec-011/edge-telemetry-dedupe.test.ts), [`seo-aeo-and-db-compaction.test.ts`](../../tests/spec-012/seo-aeo-and-db-compaction.test.ts).

## ADM-01 — Dashboard and protected API contract

Authentication/vault rules are normative in [EDGE-03](current-edge-operations.md#edge-03--admin-boundary-and-vault). The localized static admin shell is [`admin/index.astro`](../../src/pages/[...lang]/admin/index.astro); the Worker also contains an authorized HTML fallback. Their implementation is not interchangeable with the public content router.

The dashboard MUST retain staged/apply filters, human/bot segmentation, date ranges/custom dates, country/path/search, raw visit pagination, summary cards, top paths/countries/referrers/UTM, lead details, deployment information, circuit-breaker warnings and service/quota panels. It supports theme/language selection, local-time display and data exports. Auto-polling is paused by default, with explicit 15/30/60-second options.

A full refresh requests telemetry, metrics, deployments and leads with `Promise.allSettled`; table-only pagination requests only telemetry with `page_only=1`, preserving previously cached aggregates. UI authentication/network failures MUST NOT be interpreted as zero real traffic or successful backend persistence.

| Protected endpoint       | Query/response contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/telemetry`         | `range` defaults `all`: `1d`/`24h`, `2d`/`48h`, `3d`/`72h`, `7d`/`1w`, `30d`/`1m`, `custom` with `from`,`to`; `country`,`segment` (`human`,`bot`,`all`), prefix `path`, text `search`; `page` default 1, `limit` default 50 clamped 10–100 for valid numeric input; `page_only=1`/`true`; `fresh=true` or `refresh=1`. Returns `status`,`surface`,`timestamp`,`page_only`,`pagination`,`filters`,`stats`,`top_pages`,`top_countries`,`utm_attributions`,`top_referrers`,`pageviews`,`edge_events`,`prefetches`,`daily_summaries`,`circuit_breakers`,`degradation_tier`,`quotas`. |
| `/api/metrics`           | Compact rollups (latest 30), summary fallback, incidents/data-quality warnings, circuit-breaker status, degradation snapshot and quota estimates.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/api/leads`             | `{status:"ok", leads:[…]}`; latest 50 lead records including personal/security fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/api/deployments`       | `{deployments:[…]}`; latest 20 registry records.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/api/status`, `/status` | Authenticated health/surface/environment/timestamp/active-deployment object. Health here is an application response, not a comprehensive infrastructure probe.                                                                                                                                                                                                                                                                                                                                                                                                                   |

Most telemetry detail totals query raw `pageviews`. New accepted SPA/bfcache visits join that ledger at NOMINAL quota, gated by the authoritative telemetry insert and the document ledger dedupe keys; human visits also feed the daily-summary buffer. This adds raw/index write work, accounted through batch metadata. CONSERVATIVE and higher tiers still omit this dashboard projection, and historical missing rows are not backfilled; the raw table is therefore not a complete ledger of every committed route. `page_only` skips group-by/top/referrer/UTM/daily-summary work, but still runs exact filtered totals and its paginated raw query; it is not a zero-scan operation. Prefetch totals count all matching isolated rows, not just the latest 15 displayed records. Its rows and totals share date, country, path and supported text-search filters (path, country, referrer, visitor hash, purpose). Human/bot segmentation and UTM search do not apply to speculative events, whose schema has neither classification nor UTM columns. Other supplementary datasets do not all share these filters.

**Scenario:** Given staged dashboard filters, when the operator applies them, then the active filter query changes; when only the raw table page changes, then the UI requests `page_only=1` and retains cached summary panels rather than fetching all four APIs.

## ADM-02 — Cache, refresh and presentation integrity

- Authentication MUST run before access to protected cached data. Telemetry responses use a filter/page/page-only cache key, in-memory and Cache API TTL 120s. Fresh telemetry bypass has a per-key 15-second cooldown.
- Metrics, leads and deployments have their own 120-second isolate snapshots tied to the DB binding. Their explicit fresh parameter bypass is separate; the telemetry cooldown MUST NOT be described as protecting every API.
- Client-facing protected data responses use private/no-store; the internal Cache API copy uses a public TTL only for internal storage. Unauthorized responses and admin HTML remain no-store/noindex. Full dashboard fetches, including enabled polling, request fresh telemetry, metrics, deployments and leads with browser `cache: "no-store"`; server snapshot/cooldown rules still apply. Pagination requests only telemetry and does not claim a full synchronization.
- `/api/telemetry` never synthesizes visits. An observed empty result returns `status: "ok"` with zero totals and empty arrays. Missing/failed D1 returns HTTP `503` with `status: "unavailable"`; quota-protected reads return HTTP `503` with `status: "degraded"`. Failed/degraded responses are not stored in telemetry snapshots. The dashboard labels refresh failures/partial results and preserves the prior successful synchronization time; successful full refreshes use the telemetry snapshot timestamp, including cached snapshots.
- Several service usage panels are estimates/configured budgets, not live Cloudflare billing measurements. Compare provider/account metrics separately when authorized.

**Scenario:** Given the same telemetry filter/page key is refreshed twice within 15 seconds, when a cached result exists, then the second request can reuse it rather than bypass D1 protection. Given no matching raw pageviews, then the API returns an empty observed result instead of generated UI rows; an unavailable database is explicitly distinguished from zero traffic.

Evidence: `handleAdminDashboardRequest` in [`worker.ts`](../../cloudflare/worker.ts), [`admin/index.astro`](../../src/pages/[...lang]/admin/index.astro). Existing tests: [`admin-prefetch.test.ts`](../../tests/admin-prefetch.test.ts), [`admin-boundary.test.ts`](../../tests/admin-boundary.test.ts), [`odd-tasks.test.ts`](../../tests/odd-tasks.test.ts). These do not establish exhaustive field-level UI/API parity.

## Verification boundaries

This documentation change inspects source and test anchors; it does not freshly run runtime suites, query private records or inspect an authenticated owner session. [Production delivery evidence](../../odd/tasks/production-spa-delivery.md) retains unresolved production D1 persistence, interactive Access and deployed-settings checks; pre-redaction commit identities in historical logs are not current Git references.

Preserve local deterministic tests for dedupe, quota thresholds, bot/prefetch suppression, auth rejection and cached job beacons. Production acceptance requires separately authorized, narrowly scoped owner-observed persisted-event/rollup evidence, with duplicates, bot shedding and synthetic fallback distinguished. Never publish private telemetry or use a destructive reset to obtain that evidence.
