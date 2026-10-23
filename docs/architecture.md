# Current architecture and system boundaries

The site is an Astro static build plus a Cloudflare Worker serving Static Assets and dynamic APIs. The current behavior contracts start at the [specification index](../openspec/specs/README.md); historical design documents are not evidence that every proposal is implemented.

## Read the system in execution order

```text
Private editorial content/assets -> build-time R2 sync -> Astro SSG -> dist/
                                                              -> admin HTML isolation
Browser -> asset-routing rules -> Worker document/API handling -> ASSETS / D1 / R2 / AI
Browser -> persistent Astro shell -> vanilla interactive modules / Matrix Worker
```

1. `package.json` and the lockfile define the toolchain; the inspected baseline uses Astro 7.3.4, Tailwind 4.3.3, TypeScript 5.9.3 and pnpm 12.5.1.
2. `scripts/r2-pull.mjs` hydrates ignored editorial directories. Git is not a backup of the site's private content.
3. `astro.config.mjs` builds static directory-form HTML with trailing slashes and EN/ES routes. `scripts/isolate-admin-build.mjs` moves administrative HTML into the protected build vault.
4. `cloudflare/entrypoint.ts`/`worker.ts` handle documents, canonical redirects, APIs, auth and background work. `wrangler.jsonc` is the deployed-binding/routing declaration.
5. `BaseLayout.astro` supplies a persistent ClientRouter shell and shared controls. Ordinary navigation and cached experience-arrow navigation have different commit pipelines but the same continuity and telemetry invariants.

## Architecture map

| Boundary                                                    | Source of truth                                                               | Contract                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Routes, collections, visibility, search index, feeds        | `src/pages/`, `src/content.config.ts`, `src/utils/visibility.ts`, `src/data/` | [Platform](../openspec/specs/current-platform.md)               |
| Persistent UI, Matrix, theme, dialogs, keyboard, print      | `src/layouts/`, `src/components/`, `src/scripts/`, `src/lib/navigation/`      | [SPA](../openspec/specs/current-spa.md)                         |
| Visit collection, aggregation, quota degradation, dashboard | `cloudflare/worker.ts`, `cron-scheduler.ts`, telemetry adapters               | [Telemetry/admin](../openspec/specs/current-telemetry-admin.md) |
| Auth, vault, resource bindings, build/release and recovery  | `wrangler.jsonc`, `cloudflare/`, `scripts/`, D1 SQL                           | [Edge operations](../openspec/specs/current-edge-operations.md) |

## Ports and adapters

`src/lib/ports/` contains storage, search, telemetry, captcha, edge delivery and email contracts. `src/lib/adapters/factory.ts` selects these concrete runtime implementations:

| Factory   | Preferred implementation when configured  | Fallback                 |
| --------- | ----------------------------------------- | ------------------------ |
| Storage   | R2 binding; optional S3-compatible driver | Local filesystem adapter |
| Search    | Workers AI + Vectorize bindings           | Static-memory search     |
| Telemetry | D1 binding                                | SQLite fallback adapter  |
| Captcha   | Turnstile secret configuration            | Honeypot adapter         |

The `APP_*_DRIVER` environment names select supported alternatives. Missing cloud bindings can cause factory fallback; they do not prove production equivalence, durable storage, or adequate abuse protection. The fallback directory is `src/lib/adapters/fallback/`, not the historical `in-memory/` tree. Email and deployment flows also have direct Worker/platform integration; not every line of application code is provider-independent.

## Static does not mean zero JavaScript

There are no React/Vue-style hydrated islands in this baseline. There **is** delivered client JavaScript for ClientRouter, telemetry, Matrix, theme transitions, modals, navigation, search, filters, resume editing/export and other interactions. Nano Stores coordinates shared UI state; a dedicated Worker supports independent decorative rendering.

Minimize bytes and main-thread work while preserving the accepted behavior. Do not delete client modules to satisfy an inaccurate “0KB baseline” label. Similarly, TypeScript configuration and ports do not certify that every source file has no `any`.

## Document requests versus asset bypass

`assets.run_worker_first` currently starts with `/*` and excludes explicit static paths. Public HTML intentionally passes through the Worker so initial visits can be recorded server-side. Serving `env.ASSETS` from a Worker is not the same as bypassing Worker execution. Narrowing interception to `/admin` alone would change public document telemetry.

Telemetry persistence is generally scheduled with `ctx.waitUntil()` and failures are isolated from public content delivery. This avoids awaiting database writes in the document path; it is not a measurable guarantee of zero overhead or zero lost events. Browser-cache/custom-timeline navigations additionally notify the collector after a committed route.

## Evidence and limitations

- [Content workflow](content-sync.md), [SEO/i18n](seo-and-i18n.md), [SPA continuity](spa-continuity.md), [Cloudflare](cloudflare-edge.md), and [security](security.md) are operator-oriented guides to the contracts.
- `pnpm check`, `pnpm test`, `pnpm run audit` and browser suites cover different layers; a static assertion is not a full browser or production integration test.
- Performance targets require current measurements. No architecture diagram certifies universal 100/100 scores, fixed TTFB, or uninterrupted FPS on every device.
- Account-side Access/DNS/WAF settings, private R2 content, secrets, and production D1 state remain external inputs. Their presence in an old task log is not current verification.
