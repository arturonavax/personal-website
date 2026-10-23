# Current website specification index

These contracts document the website implemented at source baseline **`418703353838524a963362b081869510022a53ae`**, dated **2026-10-23**. Their purpose is accurate, maintainable specification of existing features and behavior, not a promise of byte-identical reconstruction or universal performance.

## Reading order and authority

1. Read this index and the relevant current domain contract.
2. Follow its source/test references for exact implementation details.
3. Use `docs/` for everyday workflows and [verification](../../docs/verification.md) for checks.
4. Read historical specs and task logs only for rationale and evolution.

`MUST`/`SHALL` requirements describe behavior to preserve; explicit limitations describe gaps, not newly requested features or instructions to replicate bugs. Scenario tables are acceptance expectations, not claims that every scenario ran during this documentation update.

If code, tests, and a contract disagree, inspect and record the discrepancy before changing behavior. Source at the stated baseline describes what currently exists; tests show only what they actually assert. Documentation is not permission to alter production or resolve a product decision silently.

## Current contracts

| Contract                                                           | Scope                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [Platform, content, public features, and SEO](current-platform.md) | Build, routes/locales, content schemas/visibility, feeds/discovery, search, résumé/tools, forms and public functionality        |
| [SPA, interactions, and presentation](current-spa.md)              | Persistent shell, cached job navigation, Matrix, theme, input/focus/scroll behavior, visual surfaces and accessibility          |
| [Telemetry, data, quotas, and admin](current-telemetry-admin.md)   | Committed visits, dedupe, quota degradation, WAL/rollups, dashboard data contracts, query/cache/polling behavior                |
| [Edge, security, and operations](current-edge-operations.md)       | Worker routing, services/bindings, auth/vault, headers/abuse controls, infrastructure dependencies, safe operational boundaries |

## Future frontend redesign

The [redesign preservation contract](../../docs/frontend-redesign.md) defines RED-01–RED-04: visual freedom versus functional invariants, a capability checklist, evidence expectations and operational boundaries. It adds a change-control layer to the current contracts; it does not authorize a redesign or claim future regressions are impossible.

## Coverage and evidence

This matrix identifies ownership and representative checks. Detailed contracts contain the requirement IDs, observable scenarios, source anchors, and limitations. A test path means an existing check, not a fresh PASS or complete domain coverage.

| Feature family                                              | Contract         | Representative evidence                                                                                                         |
| ----------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| SSG/build, locales, schemas, content visibility             | Platform         | `astro.config.mjs`, `src/content.config.ts`, `tests/odd-tasks.test.ts`                                                          |
| Private content hydration/manifests/bundles                 | Platform         | `scripts/r2-pull.mjs`, `scripts/lib/r2-content.mjs`, `tests/spec-012/seo-aeo-and-db-compaction.test.ts`                         |
| Public routes, collections, pagination and search           | Platform         | `src/pages/[...lang]/`, `src/data/searchIndex.ts`, `tests/spec-006/spec-006.test.ts`                                            |
| Canonical/hreflang, graphs, sitemap, robots, Markdown/AEO   | Platform + Edge  | `SEOHead.astro`, `schema-builder.ts`, `tests/spec-012/seo-aeo-and-db-compaction.test.ts`                                        |
| Résumé, maker, exports, attribution/UTM, print              | Platform + SPA   | `src/utils/resumeExporters.ts`, resume pages, existing resume/UTM tests                                                         |
| Persistent controls and browser lifecycle                   | SPA              | `BaseLayout.astro`, `tests/spa-continuity.spec.ts`, `tests/spec-009/spec-009.test.ts`                                           |
| Cached experience arrows/history/route event                | SPA + Telemetry  | experience detail page, `tests/spa-html-cache.test.ts`, `tests/timeline-telemetry.spec.ts`                                      |
| Matrix clocks, lanes/tails, pointer lens, zoom and fallback | SPA              | Matrix component/scripts, `tests/matrix-rain.test.ts`, `tests/matrix-worker.test.ts`, zoom/software browser suites              |
| Theme prepaint/reveal and reduced motion                    | SPA              | ThemeToggle/theme-clip, `tests/theme-clip.test.ts`, SPA browser suite                                                           |
| Article/list/detail surfaces and scalable corners           | SPA              | ArticleLayout/global CSS, `tests/blog-surfaces.spec.ts`, `tests/experience-surfaces.spec.ts`, `tests/geometric-corners.spec.ts` |
| Visits, speculative traffic, dedupe and counters            | Telemetry        | edge-telemetry/Worker/adapter, `tests/spec-011/edge-telemetry-dedupe.test.ts`                                                   |
| Quota tiers, optional bot/prefetch budgets, WAL             | Telemetry        | circuit breakers/cron, spec-010/spec-011 tests                                                                                  |
| Admin panels/query API/cache/pagination                     | Telemetry + Edge | admin page/Worker, `tests/admin-boundary.test.ts`, `tests/deployment-registry.test.ts`                                          |
| Auth/vault/path normalization and static bypass             | Edge             | Worker/isolate-admin-build/wrangler, `tests/admin-boundary.test.ts`                                                             |
| Search/storage/captcha/email and edge services              | Platform + Edge  | ports/factories/adapters, spec-003/spec-005 tests                                                                               |
| Current setup, external inputs, checks and proof limits     | All              | guides, package scripts/config, [verification](../../docs/verification.md)                                                      |

## Evidence boundaries

- **Source-confirmed:** implementation exists in the baseline and is linked from a current contract.
- **Test-covered:** an existing test asserts a behavior. Static source assertions and browser/runtime checks are different evidence.
- **Locally observed:** a named command/scenario passed in a stated environment. Older session results do not certify this documentation revision.
- **Production observed:** requires dated owner-authorized observation of deployed configuration and persisted effects. Local fixtures, chart contents, or historical task checkboxes are insufficient.
- **Target / unverified:** desired performance, device behavior, external policy, or production state without current evidence.

No new production verification was performed for this documentation work. The historical delivery log at `odd/tasks/production-spa-delivery.md` retains unresolved production D1 ingestion/owner Access/deployed-flag checks. Its old commit identities can predate repository history sanitization.

## External dependencies and known limits

The public source does not include the private editorial corpus, synchronized downloads/assets, secret values, live D1 records, provider account settings, DNS/Access/WAF policies, or a backup of those resources. Document their roles and names without publishing credential values. Source configuration is not evidence that every account-side setting currently matches it.

Provider limits and eligibility change. Current edge contracts separate application budget defaults from provider quotas and link official documentation. Free-tier guards are bounded protections, not a guarantee that every bound service is free or that aggregate global usage is exact.

The contracts explicitly retain known gaps such as approximate quota counters, synthetic admin fallback data, and partial runtime/production coverage. Documenting a gap does not silently authorize its repair.

## Historical specifications

The following records remain in place for traceability. Their completion claims, copied implementations, versions, or numerical targets are historical and subordinate to the current-state contracts above.

| Record                                                     | Historical scope                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `SPEC-001-big-refactor.md`                                 | Original architecture/content/i18n refactor                                                 |
| `SPEC-002-general-tasks.md`                                | General refactor and résumé maker                                                           |
| `SPEC-003-future-improves.md`                              | Decoupled services and edge roadmap                                                         |
| `SPEC-004-audit.md`                                        | Quality/performance audit targets                                                           |
| `SPEC-005-performance-content-delivery.md`                 | Content-first delivery and admin evolution                                                  |
| `SPEC-006-ux-editorial-refinements.md`                     | Editorial taxonomy, ergonomics and security changes                                         |
| `SPEC-007-frontend-stability-and-ux-polish.md`             | Earlier SPA, layout and print refinements                                                   |
| `SPEC-008-edge-performance-re-architecture-restoration.md` | Architecture restoration                                                                    |
| `SPEC-009-ux-ergonomics-and-keyboard-isolation.md`         | Keyboard/modal isolation                                                                    |
| `SPEC-010-refine-top1.md`                                  | Performance/Cloudflare evolution                                                            |
| `odd/tasks2.md`–`odd/tasks13.md`                           | Later implementation plans and outcomes, including telemetry, vault, SEO and SPA iterations |

New work should update the affected current contract and guide, with source/test evidence and any unresolved limitations. Do not append another competing current architecture to a historical file.
