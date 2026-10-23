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
- Admin: authenticated internal ASSETS vault lookup; no public vault URL bypass.

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

An initial successful document schedules server analytics through `waitUntil()`. The mounted browser collector handles Astro transitions, cached timeline commits and bfcache; speculative job fetches carry a prefetch marker. L1 suppression and authoritative D1 dedupe reduce repeated work. See [TEL-01–03](../openspec/specs/current-telemetry-admin.md#tel-01--initial-documents-and-committed-browser-routes).

Admin APIs expose telemetry, metrics, leads and deployment registry data behind the same auth boundary. Polling is **manual by default**, optionally 15/30/60s. Ordinary snapshots are 120s; telemetry's explicit fresh bypass has a 15s per-key cooldown. Table-only pagination skips group-by summaries but still computes filtered totals. Metrics/leads/deployments use separate snapshot rules.

**Interpretation warning:** an empty/unavailable raw dataset can produce synthetic fallback rows; they are not marked by an explicit response flag. Raw document tables, SPA adapter tables and rollups also differ. A populated dashboard or `202` collector response is not proof of a new persisted production visit. Quota panels contain estimates as well as configured limits.

## Free-tier safeguards

[`resolveQuotaConfig()`](../src/lib/adapters/cloudflare/circuit-breaker.adapter.ts) defaults to 100,000 D1 writes/day,5 million reads/day and100,000 Worker requests/day for the free policy. Utilization thresholds 50/70/85/95% progressively shed speculative/bot data, reduce raw analytics and spill to R2 WAL. Bot telemetry is disabled in the baseline Wrangler configuration. These are application budgets and estimates, not a provider-enforced spending cap.

- Lower-priority prefetch/bot recording has independent guards and switches.
- Human visit priority does not guarantee an unbounded number of human writes.
- R2 WAL consumes storage and object operations; its failure is caught, not magically recovered.
- Both daily cron triggers currently run the same preceding24h additive rollup/prune/replay handler; replay is capped at 20 total objects per invocation. Repeated rollups are not idempotent. Current retention is dataset-specific, not uniformly 30 days.
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

For an existing database, inspect migration history before applying a migration. `db:reset:local` and `db:reset:remote` are **destructive**; never use them as ordinary setup/upgrade instructions. `content:push`, pruning, `cv:publish`, deployment, secret changes and remote DB operations mutate external state and require scoped authorization. This guide does not authorize any of them.

Wrangler remains the runtime/deployment configuration here. `cf` can be used for separately authorized account/content operations, but `cf dev/build/deploy` is not a drop-in replacement for this Wrangler project.

## Verification and known gaps

Relevant regression anchors: [dedupe/tiers/WAL](../tests/spec-011/edge-telemetry-dedupe.test.ts), [prefetch guards](../tests/spec-010/prefetch-circuit-breaker.test.ts), [admin boundary](../tests/admin-boundary.test.ts), [deployment registry](../tests/deployment-registry.test.ts), [cached job collection](../tests/timeline-telemetry.spec.ts).

[Production delivery history](../odd/tasks/production-spa-delivery.md) preserves unresolved production persisted-event, interactive owner Access and deployed-settings evidence. This documentation refresh inspected source; it did not query private data, run fresh runtime tests, deploy or inspect account settings. Preserve that distinction in future reports.
