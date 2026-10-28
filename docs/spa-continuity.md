# SPA continuity and visual interaction guide

The current behavior is specified in [Frontend, SPA continuity, and visual behavior](../openspec/specs/current-spa.md). This guide identifies the ownership boundaries to preserve when editing motion or navigation; it does not promise universal frame rates.

## Start with the owner, not a replacement renderer

| Concern                     | Owner                                                                      | Preserve                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Route shell                 | `src/layouts/BaseLayout.astro`                                             | ClientRouter, persistence names, pre-swap theme/banner synchronization, one telemetry installation.             |
| Ordinary route presentation | `src/styles/global.css`                                                    | Live foreground/Matrix, no root or named element snapshots outside theme reveal.                                |
| Cached job arrows           | `src/pages/[...lang]/experience/[slug].astro`                              | Article-only replacement, marked speculative fetches, route history, route-commit notification, Astro fallback. |
| Matrix scheduling           | `src/components/ui/MatrixBackground.astro`, `src/scripts/matrix.worker.ts` | One canvas/Worker, independent bounded timer, no navigation teardown or elapsed-time catch-up.                  |
| Matrix appearance           | `src/scripts/matrix-grid.ts`                                               | Shared Worker/fallback algorithm, separated moving glyph trains, live tail mutation, cached palettes.           |
| Zoom and lens               | `src/scripts/matrix-viewport.ts`, `matrix-grid.ts`                         | Actual backing-size transform, preserved lanes, CSS-coordinate pointer targets and elapsed-time easing.         |
| Theme reveal                | `src/components/common/ThemeToggle.astro`, `src/scripts/theme-clip.ts`     | Old pixels until first frame, rounded-inset reveal, idempotent cleanup.                                         |
| Banner/HUD                  | LanguageSuggestionBanner, PageIndexNav, BackToTopButton, BaseLayout        | Session-state persistence and transform-based collision handling, not repeated entry animations.                |

## Current rendering parameters

- Target scheduling: approximately 60 updates/second. Worker owns `setTimeout`; fallback uses owner-window rAF. Both cap elapsed movement at two frame intervals instead of jumping through a stall.
- Rain: 18/21/24/28px fonts, 6.5 rows/second with independent 0.8–1.2 lane speed, 12–16-glyph fading tails, independent 120–240ms recoding of head and visible tail together.
- Distribution: staggered lane phases and multiple separated trains, not a synchronized rain wave. No accumulated ghost frames or multiple letters occupying one glyph cell.
- Pointer: 360px lens radius; center follows with a 300ms time constant, strength/energy smooth with 80ms. Touch movement is not treated as a hover lens.
- Raster budget: at most scale 1 and approximately 1920×1080 backing pixels, irrespective of high display DPR. Every resize resets transform using actual rounded backing dimensions.
- Theme: both glyph palettes cached at boot; selected dark-theme opacity 0.28, light 0.2. Circular native View Transition reveal is 420ms with `fill: both`; new root is clipped to zero radius before the first animated frame.

For exact formulas, fallback behavior, current color values, and the distinction between data attributes and active density controls, use SPA-03 through SPA-06 in the contract.

## Navigation is not visibility suspension

A normal route change MUST NOT stop the worker, replace the transferred canvas, reset train phases, or restart the idle boot. It may synchronize theme and resume an existing renderer idempotently. Hidden-page suspension intentionally pauses drawing and discards elapsed debt. The main-thread fallback cannot keep rendering while that thread is blocked; neither path can force an OS/browser/software rasterizer to present a frame.

Matrix is decorative, hidden below `md`, hidden in print, and initially skipped for reduced motion or webdriver. Active-animation browser tests account for the automation guard; an idle screenshot is not sufficient proof that rendering broke.

## Interaction details that must not regress

- Ordinary wheel scrolling remains native. Back-to-top changes its visibility classes on crossing 400px, rather than rewriting them on every scroll event; route-swap prepaint synchronization and native smooth top scrolling (instant with reduced motion) remain separate. `tests/scroll-performance.spec.ts` checks the stable visible state without asserting a hardware FPS threshold.
- Contact visibility owns the Contact → About transition: after Contact has entered the viewport, leaving the visible area below the pinned header removes only `#contact` via history replacement, including manual, interrupted, and programmatic scrolls, without waiting for the top. Preserve the query and router state; initial observation before reaching Contact must not cancel a pending contact anchor. Back-to-top also reconciles on completion. It uses the shared navigation-state hook, does not emit a committed visit, respects reduced motion, and cancels stale completion before navigation. Non-home routes keep their route-specific menu state. Coverage: `tests/back-to-top.test.ts` and `tests/back-to-top.spec.ts`.
- The site header is currently pinned `sticky top-0`; it does not implement the historical scroll-hide helper. Services activates Services, not More.
- Persisted modal identity does not mean dialogs remain open during navigation. Normal swaps close dialogs, unlock body scrolling, and hide ephemeral copy feedback.
- Language suggestion dismissal and entrance-once state are session-scoped; incoming route targets/copy must update without a fresh toast animation.
- Escape follows the shared hierarchy; global navigation keys must not consume typing or leak through modal contexts.
- Project and blog/post details share separate opaque header/prose surfaces. Experience role headers must cover the rail behind them without blocking arrows.
- Geometric accents and normal borders share full bounds and actual responsive radius. Never repair alignment with class-substring radius detection or divergent negative offsets.

## Admin dashboard lifecycle

The admin script installs page-local controls on each `astro:page-load`, disposes timers and listeners on departure, and ignores stale filter/poll/pagination responses. Language anchors now use the installed Astro ClientRouter for one navigation owner (including redirects, history and swap lifecycle), while the persistent Matrix and collector survive swaps. The switch saves explicit language preference without overriding private Back/Forward URL locale; query and fragment travel with the language anchor. Native Astro navigation scrolls to the fragment (or the top) and handles Back/Forward; there is no language-specific pixel restoration hook. `tests/spa-continuity.spec.ts` exercises redirected URLs and the mobile no-reload path. Contact leads distinguish an observed empty list from an unavailable read; unmeasured provider quotas display unknown rather than zero or estimated account usage. The desktop index measures the active content edge rather than assuming every route uses the default 5xl width, and falls back to the floating index when the left gutter cannot fit it. Local browser fixtures in `tests/admin-dashboard-reliability.spec.ts` check these boundaries without production contacts.

### Local verification boundary

The latest recorded unit run passed 554 tests and Astro reported zero diagnostics across 143 files. The mobile language no-reload check passed. A stricter Forward-to-anchor viewport assertion failed; it was removed because native history owns the restored position, while explicit language arrival still checks the destination anchor. The adjusted browser case was not rerun at the owner's request. Guarded apex browser integration was not obtained: the isolated build could not resolve Astro's CLI. None of this certifies production Access configuration, live provider observations, or FPS gains.

## Focused checks

Use the existing test runners and an explicitly prepared local server described in the [current documentation index](../openspec/specs/README.md). Browser suites honor `PLAYWRIGHT_BASE_URL` (default localhost:8788); some also support `CHROMIUM_EXECUTABLE_PATH`. Do not treat Bun discovering a guarded Playwright file as execution of that browser suite.

| Change                               | Minimum relevant evidence                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Rain/tails/lens                      | `tests/matrix-rain.test.ts` and browser visual inspection.                                             |
| Worker clock or message lifecycle    | `tests/matrix-worker.test.ts`, `tests/spa-continuity.spec.ts`.                                         |
| Resize, zoom, DPR, fallback          | `tests/matrix-zoom.spec.ts`, `tests/matrix-software.spec.ts`.                                          |
| Theme geometry/prepaint/cancellation | `tests/theme-clip.test.ts`, `tests/spa-continuity.spec.ts`.                                            |
| Worker-delivered navigation          | `tests/spa-html-cache.test.ts`, real header/job-arrow cases in `tests/spa-continuity.spec.ts`.         |
| Cached visits                        | `tests/timeline-telemetry.spec.ts` plus ingestion proof from the telemetry contract.                   |
| Header/banner/keyboard/modal         | `tests/spec-007/spec-007.test.ts`, `tests/spec-009/spec-009.test.ts`, browser interaction.             |
| Detail surfaces/corners              | `tests/blog-surfaces.spec.ts`, `tests/experience-surfaces.spec.ts`, `tests/geometric-corners.spec.ts`. |

Test content must exist and be visible; a content-dependent skip is an unverified case. Check both themes, mobile/desktop, history restoration, live zoom, delayed navigation, and a software-rendered browser where available. Separate renderer activity from screen presentation and local results from production delivery. Historical local raster/cadence observations are not current field Core Web Vitals certification.
