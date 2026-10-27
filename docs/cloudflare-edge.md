# Cloudflare edge operations and quota policy

The site deploys as **Workers with Static Assets**. Public documents intentionally pass through the Worker; selected static assets bypass it. Analytics and search are designed to fail without blocking public content, but the project does not promise zero latency, exactly-once telemetry, unlimited free usage or lossless recovery under every failure.

The normative current behavior is in [edge operations](../openspec/specs/current-edge-operations.md) and [telemetry/admin](../openspec/specs/current-telemetry-admin.md). Read the [specification index](../openspec/specs/README.md) before older SPEC/task documents.

## Request path

```text
request -> configured Static Assets/Worker routing
  excluded static asset -> asset response (no Worker visit recording)
  Worker request -> normalize and protect vault/admin -> route policy/API
                 -> public ASSETS response + background visit analytics
```

[`wrangler.jsonc`](../wrangler.jsonc) uses `assets.run_worker_first: ["/*", ...negative asset globs]`, not an admin-only allowlist. Exclusions cover compiled assets, fonts, remote assets, downloads, brand icons and selected discovery files. Restricting Worker-first to admin alone would remove the current initial-document telemetry path.

- Entrypoint: [`cloudflare/entrypoint.ts`](../cloudflare/entrypoint.ts) -> [`worker.ts`](../cloudflare/worker.ts).
- Static output: `dist`, auto-trailing-slash handling, static404 page; successful HTML is wrapped for headers and narrowly scoped JSD filtering.
- Immutable assets/fonts: one-year caching. Public documents: revalidation, not an extra URL-only application HTML cache.
- Runtime R2 `/cdn-assets/` objects: Cache API lookup before object fetch. Build-time editorial R2 synchronization is a separate flow; see [content sync](content-sync.md).
- Search: optional AI/Vectorize, 350ms static-search fallback. Missing index/model availability must not remove the static path.
- Admin: authenticated internal ASSETS vault lookup; no public vault URL bypass. Missing protected HTML returns private `503`, not an inline or unvaulted fallback dashboard.

## Bindings and account-side dependencies

| Binding or setting      | Local source responsibility                               | Not established by this documentation                     |
| ----------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `ASSETS`                | Public output and private admin shell                     | Correct built artifact until inspected                    |
| `DB`                    | Visits, summaries, quotas, leads and registry             | Remote schema, current contents or account-global billing |
| `STORAGE_BUCKET`        | Runtime objects/WAL                                       | Editorial content backup, lifecycle or available capacity |
| `AI`, `VECTORIZE_INDEX` | Semantic search integration                               | Index population, account eligibility or zero-cost usage  |
| `EMAIL`, email handler  | Capability binding and inbound handler                    | DNS/email routing/verified sender configuration           |
| Access variables        | Expected issuer/audience/allowlist and require-auth flags | Actual Access application/policy or owner login           |
| Custom domains          | Apex/admin/blog declarations in Wrangler                  | Other DNS aliases, CDN rules, WAF or registrar settings   |
| Logs/traces             | Enabled with 1% trace sampling                            | Complete request coverage or account log retention        |

Source disables `workers.dev` and version preview URLs. This is a checked-in setting, not fresh deployed API readback. Do not copy account IDs, private records or credential values into examples/reports.

## Telemetry and `/admin`

An initial successful document schedules server analytics through `waitUntil()`. The active browser path is `/api/telemetry/collect`; the retired `/api/v1/telemetry` ingestion route returns JSON `404` without writing. The old `edge_telemetry_events` table remains untouched while migration decisions are paused. The mounted browser collector handles Astro transitions, cached timeline commits and bfcache; speculative job fetches carry a prefetch marker. L1 suppression and authoritative D1 dedupe reduce repeated work. See [TEL-01–03](../openspec/specs/current-telemetry-admin.md#tel-01--initial-documents-and-committed-browser-routes).

Successful speculative HTML GETs (`200`/`304`), including `astro-prefetch` query markers, can record isolated prefetch rows through `waitUntil()` without counting a human visit. Failed/HEAD/static requests do not. Existing sampling, circuit breakers and kill switches still apply.

Admin APIs expose telemetry, metrics, leads and deployment registry data behind the same auth boundary. `/api/leads` returns HTTP 503 with `status: unavailable` or `degraded` and an error when records cannot be read, rather than an apparently successful empty list. Provider-usage meters return null with `quotas.usage_evidence: unavailable` when local bindings cannot measure them; D1 counters remain local estimates, not billing facts. Contact submission acknowledges success only after D1 or R2 WAL persistence; if both sinks are unavailable it returns 503 rather than claiming receipt. Polling is **manual by default**, optionally 15/30/60s. Ordinary snapshots are 120s; telemetry's explicit fresh bypass has a 15s per-key cooldown. Table-only pagination skips group-by summaries but still computes filtered totals. Metrics/leads/deployments use separate snapshot rules. Full refreshes and enabled polling request fresh data from all four APIs with browser no-store; server cooldown still applies. The synchronization timestamp reflects the successful telemetry snapshot, not the click/poll time, and does not advance on partial failures or table-only pagination.

**Interpretation warning:** empty telemetry queries now return real zeros/empty arrays, never synthetic visits. Missing/failed D1 returns `503 unavailable`; quota-protected reads return `503 degraded`. Those failures are not cached and the dashboard marks a failed/partial refresh rather than reporting a successful new synchronization. Prefetch counts and recent rows share supported date/country/path/search filters; human/bot and UTM filters are not applicable to the isolated speculative schema. At NOMINAL quota, committed SPA visits now join the document `pageviews` ledger and human summary buffer in the ingestion batch. Higher tiers omit that projection to preserve quota; old SPA rows are not backfilled. Raw tables and rollups therefore still differ. A populated dashboard or `202` collector response is not proof of a new persisted production visit. Quota panels contain estimates as well as configured limits.

## Free-tier safeguards

[`resolveQuotaConfig()`](../src/lib/adapters/cloudflare/circuit-breaker.adapter.ts) defaults to 100,000 D1 writes/day,5 million reads/day and100,000 Worker requests/day for the free policy. Utilization thresholds 50/70/85/95% progressively shed speculative/bot data, reduce raw analytics and spill to R2 WAL. Bot telemetry is disabled in the baseline Wrangler configuration; an unset sampling-rate setting defaults to 1% even when the enable switch is absent. These are application budgets and estimates, not a provider-enforced spending cap.

- Lower-priority prefetch/bot recording has independent guards and switches.
- Human visit priority does not guarantee an unbounded number of human writes.
- R2 WAL consumes storage and object operations; its failure is caught, not magically recovered.
- Web contacts make one full-schema D1 insert attempt before R2 WAL fallback; they do not retry a reduced historical schema. Each lead WAL object is inserted independently, including identical submissions. Without a stored WAL key, D1 success followed by R2 deletion failure can duplicate a lead on retry: replay is at-least-once, not globally exactly once. Telemetry event retries remain conditional/idempotent.
- Both daily cron triggers replay WAL first, rebuild current and six previous complete UTC-day summaries from raw human events, then prune; repeated runs do not double-count overlapping events. Replay is capped at 20 total objects per invocation. `pageview_events` and `telemetry_events` raw detail is retained for seven days; other datasets have their own retention. A late event outside the rebuilt days is not backfilled into the daily summary.
- The existing adapter `(date,path)` upsert includes coarse desktop/mobile and Windows/macOS/iOS/Android/Linux/other counters. Raw accepted `telemetry_events` now stores bounded country, region, OS, device, browser and browser language (not UA/version); old rows retain explicit unknown values. Raw unrecognized UA/device/OS remain unknown even though legacy rollups use their fixed `other` OS bucket; the first bounded Accept-Language preference (including valid script/region tags and optional quality) is not the route locale. WAL replay conditionally updates one aggregate per successfully inserted raw event; this can cost more statements than a per-file combined upsert, but repeated objects and duplicate keys cannot inflate views. Old WAL without an OS bucket maps to `other`. Cron zeros only these dimensions after 30 days, retaining historical views. NOMINAL human documents now use the same adapter as the collector and populate rollups when the raw insert is accepted; bot and degraded-tier coverage remain partial. Per-visit fields survive R2 WAL replay, while COMPACT_ROLLUP intentionally sheds raw detail. Counts are not distinct devices or legal-compliance evidence. The historical `0011_aggregate_device_os.sql` migration was applied to the configured remote D1 and verified by schema and migration-ledger readback before compaction; that statement is historical, not the current remote schema. Read-only inspection on 2026-10-27 found the compact baseline and `bot_category` present. These new repairs have not been deployed, so their live counters and visit persistence remain unverified.
- Full authenticated `/api/telemetry` snapshots expose separate fixed-window `coverage` subsets: device/OS from the last 30 UTC rollup dates and bots/AI from the last seven days of nominal-tier bot `pageviews`. Each carries its source, availability and collection state; page-only pagination skips those reads. Historical bots without `bot_category` remain unknown, not presumed non-AI. These subsets are not filtered pageview totals, and disabled or quota-shed bot ingestion never means bots did not visit. The compact `0001_initial_schema.sql` baseline contains device/OS rollups and bot classification for an empty database. The single compact `0001_initial_schema.sql` baseline includes the visit-dimension columns for new/reset databases. Read-only remote inspection on 2026-10-27 found an older schema with `bot_category`, but not the new per-visit dimension columns. Repository compaction does not change that remote schema. `CREATE TABLE IF NOT EXISTS` does not add columns to existing tables, and an existing 0001 ledger entry will not rerun rewritten SQL. Do not treat this baseline or reset as an in-place upgrade; an existing database needs a separately planned schema transition or authorized destructive reset before code writing these columns can operate. `wrangler.jsonc` keeps bot ingestion disabled pending verified production schema; after owner-authorized schema activation, explicitly set `ENABLE_BOT_TELEMETRY=true` to collect a deterministic 1% sample (`BOT_TELEMETRY_SAMPLE_RATE=0.01`). The gate runs before the per-isolate bot breaker and writes no unsampled bot event; it is not globally exact, is not a bot-traffic estimator, and never raises the Worker/D1 Free-tier cap. The API exposes the configured sample rate instead of extrapolating totals. The bilingual `/admin` coverage panel shows fixed unfiltered 30-day device/OS and seven-day sampled bot/AI subsets with source and unavailable/disabled states, preserving table filters and pagination. D1 Free storage is [500 MB per database, 5 GB per account](https://developers.cloudflare.com/d1/platform/limits/), not 5 GB for a single database; the dashboard displays D1 storage usage as unmeasured rather than inventing a 12.4 MB measurement or claiming account-wide Free-plan compliance.
- No baseline Analytics Engine dataset binding exists; its optional code sink is not a configured redundant backup.

[EDGE-06](../openspec/specs/current-edge-operations.md#edge-06--free-tier-policy-and-external-limits) records provider links checked 2026-10-23 and distinguishes code budgets from provider allowances. In brief: D1 row/index work, Worker CPU/requests, R2 operations/storage, AI neurons and optional Vectorize dimensions all matter. Provider Vectorize eligibility wording is currently inconsistent between official pages; verify the account rather than promise all optional integrations are free.

## Safe local workflow

Run commands only after understanding their inputs and side effects:

| Intent                  | Existing command       | Important boundary                                                       |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------ |
| Types                   | `pnpm check`           | Local diagnostics                                                        |
| Unit/integration tests  | `pnpm test`            | Bun test suite; browser specs require their own runner/server            |
| Architecture guard      | `pnpm audit`           | Source-level checks; not a security/performance certification            |
| Static build            | `pnpm build`           | Prebuild can pull remote content; build relocates admin HTML             |
| Production-like preview | `pnpm dev-prod`        | Check/build + local Wrangler port 8788; default bind 0.0.0.0 exposes LAN |
| Local schema bootstrap  | `pnpm db:schema:local` | Existing schema must be considered; not an upgrade/reset substitute      |

For an existing database, inspect migration history before changing its schema. `db:reset:local` is **destructive**, even locally; there is deliberately no package shortcut for remote reset or remote schema replay. The single tracked baseline is for new/reset databases, not an upgrade to existing tables or ledgers. Remote D1 maintenance needs separate target-specific authorization; no remote operation is performed by this repository change. `content:push`, pruning, `cv:publish`, deployment, secret changes and remote DB operations mutate external state and require scoped authorization. This guide does not authorize any of them.

### Remote D1 change gate

The configured production `DB` binding is `personal-website-analytics` in `wrangler.jsonc`; `env.local` reuses its ID but is not an independent remote database. A local migration run does not migrate production. Any later remote operation requires its own target-specific decision. `reset.sql` drops only the known application objects; unknown objects survive. A list of unapplied migration files is **not** proof that existing tables lack columns: reconcile actual schema and migration tracking before any operation. The migration directory has only `0001_initial_schema.sql` for new databases. Existing remote tables and an older ledger are not upgraded by applying the rewritten baseline: `CREATE TABLE IF NOT EXISTS` leaves existing tables unchanged, and an existing 0001 entry does not rerun. A reset discards visits, leads and the old deployment registry; `reset.sql` rebuilds the schema and seeds only `0001_initial_schema.sql` in Wrangler's ledger. The synthetic deployment metadata seed does not certify a real production deployment. The local `schema.sql` bootstrap does not populate migration history, while `reset.sql` does. No remote reset or migration is part of this compaction.

A future destructive reset is a separate operational decision for a named database; it loses stored visits, leads and registry records. Do not infer remote execution or success from this guide, a local fixture or the rewritten files. This task authorizes repository compaction without backups or verification, not a remote reset, migration, deployment or production certification. A database with the older schema cannot be made compatible by replaying 0001.

Wrangler remains the runtime/deployment configuration here. `cf` can be used for separately authorized account/content operations, but `cf dev/build/deploy` is not a drop-in replacement for this Wrangler project.

## Verification and known gaps

Relevant regression anchors: [direct/WAL dedupe and cron retention](../tests/aggregate-device-os.test.ts), [dedupe/tiers/WAL](../tests/spec-011/edge-telemetry-dedupe.test.ts), [prefetch guards](../tests/spec-010/prefetch-circuit-breaker.test.ts), [successful prefetch and admin refresh](../tests/admin-prefetch.test.ts), [admin boundary](../tests/admin-boundary.test.ts), [deployment registry](../tests/deployment-registry.test.ts), [cached job collection](../tests/timeline-telemetry.spec.ts).

[Production delivery history](../odd/tasks/production-spa-delivery.md) preserves unresolved production persisted-event, interactive owner Access and deployed-settings evidence. This documentation refresh inspected source; it did not query private data, run fresh runtime tests, deploy or inspect account settings. Preserve that distinction in future reports.
