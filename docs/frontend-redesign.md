# Frontend redesign preservation contract

Change the presentation without silently removing website capabilities or weakening its architecture. This contract is preparation for a later redesign, **not authorization to implement one**. Read it with the [current specification index](../openspec/specs/README.md) and [verification guide](verification.md).

Documentation and tests reduce regression risk; they do not guarantee that nothing can ever break. The current contracts describe source baseline `418703353838524a963362b081869510022a53ae`. Record a fresh implementation/content baseline when the redesign actually starts.

## RED-01 — Separate visual choices from functional invariants

A redesign MUST distinguish deliberate presentation changes from behavioral changes. Layout, palette, typography, illustration, spacing, card composition, and decorative effects MAY evolve. Existing pixel expectations and the current Matrix aesthetic parameters are baseline descriptions, not a permanent ban on new art direction. Deliberate changes MUST update affected visual assertions and specifications together, rather than delete tests or capabilities to make them pass.

Functional behavior, accessibility, discovery, security, data contracts, and performance principles MUST remain intact unless a separate explicit scope decision authorizes a change. Do not replace native functionality with heavier dependencies just to match a mockup. Keep static generation, minimal justified client JavaScript, typed service boundaries, self-hosted assets/fonts, and fail-open public content delivery.

Given a new visual direction, when the implementation changes, then existing capabilities remain available and their observable states remain testable. A screenshot comparison alone does not prove functional preservation.

## RED-02 — Preserve capabilities and ownership

The redesign MUST account for every applicable row, using the linked current contract for exact semantics and known limits. This table is a non-regression checklist, not a new implementation of those contracts.

| Preserve                                                  | Observable acceptance                                                                                                                                                                    | Contract / representative checks                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public routes, locales, content visibility and navigation | Existing deep links, EN/ES variants, list/detail views, taxonomy, filters, pagination and language choices remain usable; hidden/draft content does not become public                    | [Platform](../openspec/specs/current-platform.md); spec-006/spec-012 tests                                                                          |
| SEO and machine-readable content                          | Canonical/trailing-slash behavior, reciprocal existing translations, metadata/graphs, sitemap/robots/feeds/search index and Markdown negotiation are retained                            | Platform + [Edge](../openspec/specs/current-edge-operations.md); `tests/spec-012/seo-aeo-and-db-compaction.test.ts`                                 |
| Ordinary SPA and cached experience-job navigation         | Navigate through ordinary pages, job arrows, deep links and browser history without duplicate owners, broken controls, reloads introduced by the redesign, or lost route state           | [SPA](../openspec/specs/current-spa.md); `tests/spa-continuity.spec.ts`, `tests/spa-html-cache.test.ts`                                             |
| Continuous Matrix rendering                               | One persistent canvas/Worker clock; navigation does not reset rain or lens state; resizing, zoom/DPR and theme changes retain coherent rendering                                         | SPA; `tests/matrix-rain.test.ts`, `tests/matrix-worker.test.ts`, `tests/matrix-zoom.spec.ts`, `tests/matrix-software.spec.ts`                       |
| Theme and readable surfaces                               | Persisted theme, prepaint protection, reduced-motion fallback and transition completion remain correct; decorative layers never obscure content or controls                              | SPA; `tests/theme-clip.test.ts`, `tests/spa-continuity.spec.ts`                                                                                     |
| Global controls and accessibility                         | Toasts, language suggestions, header, search, dialogs, contact/coffee controls, shortcuts, TOC, focus and scroll behavior work after repeated swaps; typing/modal input remains isolated | SPA + Platform; `tests/spec-009/spec-009.test.ts` and browser/manual checks                                                                         |
| Résumé and tools                                          | Public résumé, maker inputs, exports, UTM/link options, downloads and cross-browser print remain usable; print is checked separately from screen appearance                              | Platform + SPA; exporter/UTM tests and explicit print checks                                                                                        |
| Visual containment                                        | Readable article/service/experience surfaces, timeline layering, scalable corner geometry where retained, responsive gutters and keyboard targets remain coherent                        | SPA; `tests/blog-surfaces.spec.ts`, `tests/experience-surfaces.spec.ts`, `tests/geometric-corners.spec.ts`                                          |
| Committed visits                                          | SSR/ordinary SPA/cached arrows/bfcache preserve their distinct recording paths; speculative fetches are not committed visits and no second ingestion owner appears                       | [Telemetry/admin](../openspec/specs/current-telemetry-admin.md); `tests/timeline-telemetry.spec.ts`, `tests/spec-011/edge-telemetry-dedupe.test.ts` |
| Admin and protected APIs                                  | Dashboard capabilities, filters/pagination, refresh/caching/quota controls and API shapes remain available only through the current authorization boundary                               | Telemetry/admin + Edge; `tests/admin-boundary.test.ts`, `tests/deployment-registry.test.ts`                                                         |
| Security and edge delivery                                | No exposed admin HTML/vault, credential leakage, weakened guards/headers/captcha checks, or accidental removal of public HTML visit interception/static asset bypass                     | Edge; admin-boundary and relevant spec-005 tests                                                                                                    |
| Content and provider budgets                              | Private R2 content/assets/CVs stay external to Git; build hydration and service fallbacks remain; no per-frame/per-interaction backend requests or bypassed quota guards are introduced  | Platform + Telemetry/admin + Edge; existing content/quota tests                                                                                     |

Given a redesigned page, when the user reaches a capability through a different visual control, then the same domain operation, state transitions and failure handling remain available. Reuse existing navigation, telemetry, export and service helpers; do not reimplement them as disconnected design-only facsimiles.

## RED-03 — Verify before claiming preservation

Before implementation, the redesign MUST record its source revision, content/visibility prerequisites, supported devices/browsers and selected checks. Record baseline failures and known limitations separately. Existing tests have partial coverage; missing tests are not permission to remove a feature.

At each coherent change, run relevant unit/integration assertions and browser scenarios. At integration, review the complete capability table, run the applicable broader checks, and record pass/fail/skip/unavailable with exact commands. A skipped post route, absent content, unavailable browser or unverified production resource MUST remain visible in the evidence, not become a claimed PASS. Do not enable hidden posts or contact production services merely to obtain coverage.

Minimum navigation exercise: ordinary pages → experience detail → adjacent job arrows → back/forward → locale change, in both themes; repeat with relevant mobile/desktop sizes, reduced motion, zoom changes and software rendering. Observe both persistence identity/clock behavior and what the user sees. Check modal/input isolation and print/export flows separately. For telemetry distinguish a client request from a persisted backend event; synthetic dashboard data is not ingestion proof.

Given an intentional visual change, when an old visual assertion fails, then update that assertion only after verifying the functional invariant it protected. Do not remove continuity, layering, geometry or accessibility checks as mere screenshot churn.

Performance acceptance MUST use comparable before/after measurements in a stated environment, not invented universal FPS/CWV scores. Preserve a measured rendering/navigation budget, stable geometry, bounded work and accessibility fallbacks; investigate new stalls, shifts or payload growth before calling the redesign equivalent. Source contracts alone cannot certify field performance.

## RED-04 — Keep change and operational boundaries explicit

A redesign MUST NOT implicitly migrate data, change persisted formats, remove public routes/API fields, replace the telemetry backend, alter authentication, enable hidden content, reset production D1, upload/prune R2, purge caches or modify DNS/Access/WAF. Those are separate decisions with their own authorization, verification and rollback.

The current contracts list limitations, including partial cached-route head synchronization, synthetic telemetry fallback, approximate quota accounting, cron behavior and content-hydration gaps. Preserve intended invariants, **not bugs as immutable requirements**. If the redesign touches a known gap, report it and agree the behavioral fix separately; never silently regress to a worse historical implementation.

Given a purely presentational change, when it is reviewed, then its runtime/service changes are either absent or explicitly justified and authorized. Keep coherent reversible commits and document rollback by behavior. Do not merge/deploy because a documentation checklist was checked.

## Design handoff record

For each redesign unit, record: affected capability rows and requirement IDs; intended visual changes; reused owners/helpers; unchanged route/data/security contracts; baseline and candidate test evidence; performance comparison; unresolved skips/gaps; and rollback boundary. Update the affected current contract and guide when an intentional decision changes their descriptions.

The [coverage index](../openspec/specs/README.md#coverage-and-evidence) identifies existing evidence. The [verification guide](verification.md) documents local versus production prerequisites and content-pull caveats. This handoff supplies traceability; it does not substitute for running the checks during the future redesign.
