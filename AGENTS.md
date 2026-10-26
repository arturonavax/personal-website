# Project engineering instructions

Maintain a fast, accessible, bilingual personal website built with Astro SSG and Cloudflare Workers + Static Assets. Preserve the current user-visible behavior before optimizing or refactoring it.

## Read first

The current-state documentation starts at [the specification index](openspec/specs/README.md). Its baseline is source commit `418703353838524a963362b081869510022a53ae` (2026-10-23). The index explains precedence, evidence levels, and known limitations. Later Obsidian/R2, telemetry and bounded Search Console changes have their own dated evidence; the baseline date is not a claim that the integrated branch was deployed.

| Work                                              | Current contract                                                 | Practical guide                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Routes, content, SEO, public tools                | [Platform](openspec/specs/current-platform.md)                   | [Architecture](docs/architecture.md), [content](docs/content-sync.md), [SEO](docs/seo-and-i18n.md) |
| Navigation, Matrix, theme, interactions, surfaces | [SPA and presentation](openspec/specs/current-spa.md)            | [SPA continuity](docs/spa-continuity.md)                                                           |
| Visits, quotas, storage, dashboard                | [Telemetry and admin](openspec/specs/current-telemetry-admin.md) | [Cloudflare](docs/cloudflare-edge.md)                                                              |
| Routing boundaries, auth, services, operations    | [Edge operations](openspec/specs/current-edge-operations.md)     | [Security](docs/security.md)                                                                       |
| Verification and evidence                         | [Verification guide](docs/verification.md)                       | Existing tests and source anchors in each contract                                                 |

Historical `SPEC-001`–`SPEC-010` documents and `odd/tasks*.md` are decision/history records, not a current certification. Do not copy their stale code snippets, universal performance promises, or old route/security policies into new work.

## Future frontend redesign

Read [the redesign preservation contract](docs/frontend-redesign.md) before changing the frontend. Separate visual freedom from functional invariants; map every affected capability to existing owners, tests and evidence. A new visual direction is not permission to remove features, restart persistent rendering, change telemetry/API contracts, weaken security, or alter infrastructure. Keep known limitations explicit instead of treating bugs as immutable requirements.

## Architecture and scope

- Keep `output: "static"`, directory output, and trailing-slash document routes. The production entrypoint is `cloudflare/entrypoint.ts`; Astro does not provide a deployed SSR application here.
- Read versions and commands from `package.json` and `pnpm-lock.yaml`; the baseline uses Astro 7.3.4, Tailwind 4.3.3, TypeScript 5.9.3, and pnpm 12.5.1. Bun runs the unit/integration suite.
- Use the strictest Astro TypeScript configuration and typed ports under `src/lib/ports/`. Reuse adapter factories rather than importing Cloudflare implementations into presentation components. Existing legacy `any` usage is not permission to add more.
- Prefer native browser APIs and existing helpers. Add dependencies only for a justified requirement; do not add framework hydration for interactions already handled by the persistent shell.
- Public pages intentionally ship client JavaScript for the router, Matrix, theme, accessibility, tools, and telemetry. The constraint is minimal justified JavaScript and no unnecessary framework islands, NOT a literal zero-byte payload.
- Editorial collections, downloaded CVs, and remote assets are ignored by Git and hydrated from private R2 or existing local files. Never commit personal content or overwrite it with fixtures. The public repository is not a content backup.
- Configuration and provider resources are not interchangeable: the content-sync bucket and deployed storage binding have distinct roles. Do not silently merge them.
- `pnpm dev-prod` builds against existing local content without R2 reads; optional `OBSIDIAN_VAULT_PATH` staging remains local and must be separately authorized. `pnpm content:backup` creates a private local snapshot; only an explicitly authorized push publishes content. See [content sync](docs/content-sync.md).

## Non-regression invariants

### Persistent navigation and rendering

- Keep one persistent Matrix canvas/Worker, renderer clock, UI state, and installed telemetry owner across Astro route swaps. Do not remount/reset them to change appearance.
- Preserve the cached experience-job navigation path separately from Astro ClientRouter. Mark speculative requests `X-Astro-Prefetch: true`; dispatch `site:route-committed` only after the selected route commits. Keep history, controls, language state, and back/forward behavior in sync.
- Preserve Matrix lane phases through viewport/zoom/DPR changes. Baseline glyph sizes are 18/21/24/28px, base speed 6.5 rows/s, lens radius 360px, and elapsed-time pointer easing 300ms. Consult the SPA contract for tail mutation, train scheduling, caching, worker/fallback, visibility, and reduced-motion behavior.
- Keep the Matrix below readable page surfaces during loading and transitions. Worker rendering reduces main-thread interference; it does not guarantee universal frame rates on every device.
- Keep theme prepaint protection, native View Transition rounded-inset reveal, reduced-motion fallback, cached palettes, and exactly one completion notification. Do not restore obsolete snapshot/clip approaches without measurements.
- Keep toasts, language suggestions, dialogs, shortcuts, focus/scroll restoration, and the pinned header compatible with repeated navigation. Use lifecycle-safe singleton installation and cleanup for page-local listeners.

### Visual and content contracts

- Reuse existing semantic color/spacing/type tokens and local Geist fonts. Do not add external font CDNs or layout-shifting image geometry.
- Shared `.geometric-box` normal/accent strokes use identical full bounds and inherited radii. Preserve responsive radius utilities, overflow clipping, pointer pass-through, and `no-corner-accents` behavior.
- Project/post details use separate header and content surfaces, not a giant transparent wrapper. Experience timeline lines remain behind opaque inner content.
- Preserve visibility filtering, existing translations, canonical/hreflang rules, semantic HTML, keyboard isolation, reduced-motion handling, and print behavior. Do not make hidden posts public to satisfy tests.

### Telemetry, admin, and quotas

- Reuse `installEdgeTelemetry()`, `/api/telemetry/collect`, and authoritative backend deduplication. Capture route paths before deferred work. Do not create a second ingestion backend or count speculative requests as committed visits.
- Retain asynchronous `waitUntil()` work and fail-open public delivery. Keep optional bot/prefetch counters separate from human visits; document their quota and accuracy limits.
- Preserve the configured Worker-first public HTML path and explicit static-asset exclusions. Restricting execution to `/admin` alone would remove initial server-side public visit interception.
- Never authorize from an email header or unverified JWT/cookie. Preserve Access issuer/audience/signature/expiry/email validation and the explicitly configured secret-token path; inspect the actual guard before changing either.
- Deny external vault URLs regardless of caller-supplied internal headers. Authorized vault retrieval uses the ASSETS binding; private responses must not become public cache entries.
- Never commit secrets or copy production credential values into examples, fixtures, generated types, or memory. Secret names are documentation; secret values are not.
- Preserve quota degradation and fallback semantics. Isolate-local counters/caches are not globally exact account usage, and free-tier configuration is not a zero-cost guarantee.
- Do not treat populated admin charts or a queued collector response as proof of persisted visits. `/api/telemetry` returns observed empty results or explicit 503 unavailable/degraded responses, not synthetic visits. Device/OS and sampled bot/AI coverage are bounded subsets, never site-wide totals; migration `0012` must precede explicit bot collection activation. D1 Free storage is 500 MB per database and 5 GB per account; the dashboard does not measure usage. Production Access and D1 persistence require separate owner-authorized evidence.

## Skills and codebase knowledge

Load matching local instructions before work:

| Domain                     | Skill                                            |
| -------------------------- | ------------------------------------------------ |
| Astro routes/content/build | `.agents/skills/astro/SKILL.md`                  |
| Visual changes             | `.agents/skills/frontend-design/SKILL.md`        |
| SEO and discovery          | `.agents/skills/seo-audit/SKILL.md`              |
| Performance measurements   | `.agents/skills/core-web-vitals/SKILL.md`        |
| Cloudflare architecture    | `.agents/skills/cloudflare/SKILL.md`             |
| Worker implementation      | `.agents/skills/workers-best-practices/SKILL.md` |
| Wrangler operations        | `.agents/skills/wrangler/SKILL.md`               |
| Security review            | `.agents/skills/security-audit/SKILL.md`         |

Use CodeGraph before structural exploration or source refactoring. Check the local `.codegraph/` index; synchronize before CLI intelligence reads. Do not index editorial Markdown into the code graph. If it is unavailable, disclose the limitation and use bounded source inspection.

Use the active Engram protocol for project resolution, recall, proactive discoveries, and session summaries. Never invent a session identity. Memory bookkeeping does not replace delivering an answer or recording verification evidence.

## Checks and delivery

- Follow [the verification guide](docs/verification.md). Observe RED before behavior fixes when a relevant deterministic test exists. For descriptive documentation, validate references and factual claims instead of inventing runtime RED/GREEN.
- Use `pnpm check`, `pnpm test`, and relevant Playwright cases when applicable. Respect an owner's explicit decision to rely on their own verification; preserve earlier failures as failures. A build may pull remote content; when remote access is not authorized, bypass the pull hook using the direct Astro commands in the verification guide. `CONTENT_SOURCE=local` does not prevent pulls when content is missing or CI flags are truthy; Wrangler custom builds can also pull.
- Normalize only the intended files before final checks/review. Do not run a repository-wide formatter over unrelated work. Treat `package.json` scripts as the command inventory; preserve build hooks and explicit remote side-effect boundaries when simplifying it. Use `pnpm check` instead of a duplicate typecheck alias and target changed files with `pnpm exec prettier`; retired remote D1/account-setting shortcuts must not be recreated as routine setup.
- Report commands actually run, skips, unavailable inputs, and failures. Targets such as LCP, CLS, INP, Lighthouse scores, or FPS are not certified by architecture alone or by a historical test count.
- Keep runtime fixes separate from documentation corrections unless explicitly authorized. Updating these specifications does not authorize deployment, account changes, destructive database resets, cache purges, or remote content uploads.
- Preserve human edits. Use Conventional Commits; never add `Co-Authored-By` or AI attribution. Push/merge/deploy only within explicit authorization.
- When behavior changes, update its current contract, guide, and test anchors together; retain old records as history. Do not mark production verification complete from local fixtures.
