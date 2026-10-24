# Current frontend, SPA continuity, and visual behavior

Status: current-state contract for source baseline `4187033` (2026-10-23). Read the [specification index](README.md) for precedence and evidence levels. This describes existing behavior, not a promise that every device can present every frame.

## Scope and boundaries

The frontend is statically rendered Astro HTML with justified browser modules, native custom elements, Nano Stores, and `ClientRouter`. It is **not** a zero-client-JavaScript application. Public route/content rules belong to [Platform](current-platform.md); visit recording and admin data belong to [Telemetry and admin](current-telemetry-admin.md); delivery and security belong to [Edge operations](current-edge-operations.md).

Requirements below preserve current behavior. Existing test files are regression anchors; listing one is not a claim that it was rerun during documentation work. Content-dependent browser cases need visible local fixtures or the owner's content; skipped cases are not proof of production behavior.

## SPA-01 — Route shell and lifecycle ownership

The application MUST mount one `ClientRouter` through `src/layouts/BaseLayout.astro`. Ordinary internal navigation MUST retain Astro's routing/persistence metadata through the Worker HTML delivery pipeline. Replacing internal navigation with unconditional document reloads is not equivalent behavior.

| Persisted identity                                     | Current owner                                         | State behavior                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matrix-background`                                    | `MatrixBackground.astro`                              | Retain the actual canvas, renderer, lane phases, and animation clock.                                                                                                       |
| `language-banner`                                      | `LanguageSuggestionBanner.astro`                      | Retain dismissal and already-animated state; refresh route counterpart and localized copy.                                                                                  |
| `page-index-nav`, `backtotop`                          | Floating action stack                                 | Retain controls, rebuild route-dependent sections and controls.                                                                                                             |
| Search, shortcuts, coffee, judges, contact modal roots | Modal portal; optional roots depend on available data | Retain eligible roots, but ordinary `astro:before-swap` closes open dialogs and clears body scroll locking. Persistence does not promise an open modal survives navigation. |
| `page-navigation-beacon`                               | BaseLayout navigation module                          | One loading HUD with timers, not a new indicator per route.                                                                                                                 |

Setup MUST be idempotent. Rebind DOM-local controls after `astro:after-swap`/`astro:page-load` where their owners require it; global delegates/listeners use their existing singleton guards. Custom elements that own listeners MUST clean up on disconnect. Preserve the current Nano Store atoms for search, shortcuts, and sponsorship state rather than adding duplicate state owners.

Ordinary SPA navigation MUST present the live foreground and Matrix, not freeze them in root/named transition snapshots. The final `global.css` rule sets `view-transition-name: none !important` outside explicit theme transitions. Theme switching is the deliberate snapshot exception.

**Scenario:** Given a booted Matrix and a visible language suggestion, when navigating between About, Experience, Services, and Projects through actual header links, then the document does not reload, the canvas identity and theme survive, and the suggestion/HUD do not replay their entrance animations. Existing evidence: `tests/spa-continuity.spec.ts`; `tests/spa-html-cache.test.ts` verifies delivery preservation separately.

## SPA-02 — Cached experience detail navigation

`src/pages/[...lang]/experience/[slug].astro` MUST keep its adjacent-job navigation path separate from a full Astro page swap:

1. Warm adjacent HTML with low-priority fetches carrying `X-Astro-Prefetch: true`. Cache successful HTML in the page navigation closure; failed warming is ignored.
2. Ignore overlapping navigation while `isTransitioning` is set. Show the shared beacon immediately for a committed arrow action.
3. Use cached HTML or fetch the target. Wait for the 130ms exit animation before parsing with `DOMParser`.
4. Update the document title, language-link destinations, suggestion target, custom TOC payload, milestone bar, sticky experience header, and article contents/classes. Use `history.pushState` for new actions, not `popstate` restoration.
5. Reinitialize timeline controls, simulation cards, and the page index. Emit `site:route-committed` only after the route and controls have committed; this is the telemetry hook for cached navigation.
6. Reset scroll to the top if the old position exceeds 140px. Finish the entry animation and remove temporary transforms, opacity, transition, and `will-change` after 240ms.

The current exit/entry distances are 16px below 640px viewport width and 36px above it; direction follows past/future navigation. Exit duration is 130ms and entry duration is 220ms. The canvas and outside shell MUST NOT be part of the replaced article.

Back/Forward on an experience route MUST reenter this path with `isPop=true`, without pushing a duplicate history entry. If fetching/parsing fails or an expected article is absent, use exposed Astro `navigate()`; `location.assign()` is only the last fallback if that router bridge is unavailable. A failed fetch MUST NOT be reported as a committed cached visit.

The cache path synchronizes the selected title/language/TOC/control fields listed above; it is **not a generic full-head replacement**. Do not infer that every metadata element is refreshed by this path. Full HTML requests still receive the statically generated route metadata.

**Scenario:** Given two adjacent visible jobs, when following past/future arrows and then Back/Forward, then the URL, title, job content, controls, and route-commit notification follow the selected job without replacing the Matrix. Existing evidence: `tests/spa-continuity.spec.ts`, `tests/timeline-telemetry.spec.ts`.

Keyboard arrows and H/L follow the same route path, excluding input/textarea/select/contenteditable focus, open dialogs, and Ctrl/Meta/Alt combinations. Swipe navigation MUST retain its conservative gesture boundary: one touch, start at least 28px from either screen edge, duration 80–400ms, horizontal distance at least 95px, vertical deviation at most 45px, and horizontal dominance at least 2.8× vertical displacement. Ignore swipes originating inside inputs, dialogs, code, buttons, links, or simulation cards; respect modal isolation. Left advances future; right selects past.

## SPA-03 — Matrix identity, clock, and fallback

`MatrixBackground.astro` MUST own a single persisted, `aria-hidden`, pointer-transparent, fixed background at z-index 0. It is hidden below the `md` breakpoint and in print. Foreground surfaces MUST remain above it and mask glyphs where opacity is required.

Boot is deferred until the first pointer/wheel/touch/key/scroll interaction, or 5.5 seconds after window load. Initial setup skips animation for reduced-motion preference and `navigator.webdriver === true`; browser tests that inspect active rendering must explicitly account for this guard. An already initialized singleton reuses its canvas and synchronizes only theme/visibility.

Where available, transfer the canvas once to a dedicated module Worker using OffscreenCanvas. Main-thread messages are `init`, `resize`, `theme`, `pointer`, `pause`, and `resume`; the Worker also supports `visibility`. Ordinary route lifecycle events MUST NOT terminate/recreate the Worker, clear rain state, or reset its render clock.

The Worker MUST own a bounded `setTimeout` frame loop, not depend on owner-window `requestAnimationFrame` rendering opportunities. Target interval is `1000/60`ms. Allow only one scheduled timer. Every frame uses elapsed time capped to two intervals; discard stalled-clock debt instead of jumping through unseen glyph positions. Resize/theme/resume scheduling MUST remain idempotent.

Without usable OffscreenCanvas/Worker support, use the same `MatrixGrid` renderer on the persistent canvas with main-thread `requestAnimationFrame`, gated near 60Hz and with the same two-frame elapsed cap. A missing 2D context leaves the decorative animation absent; public content remains usable. Initialization attempts a 2D fallback after a caught transfer/setup error, but this is not proof that every post-transfer browser failure can recover the canvas.

Visibility is an intentional exception to continuous movement: hidden documents pause rendering and clear elapsed-time debt; resuming does not catch up through hidden time. No renderer can guarantee uninterrupted physical display presentation when the OS, browser, software rasterizer, or main-thread fallback is stalled. The contract is independent scheduling and preserved state, not universal 60/120fps certification.

**Scenario:** Given an initialized worker canvas, when navigation overlaps long main-thread work, then worker drawing continues independently and canvas/Worker identities survive. Given hidden-page suspension, when resuming, then no large catch-up jump occurs. Existing evidence: `tests/matrix-worker.test.ts`, `tests/spa-continuity.spec.ts`, `tests/matrix-software.spec.ts`.

## SPA-04 — Rain model, tails, depth, and pointer lens

`src/scripts/matrix-grid.ts` is the one rain algorithm for Worker and fallback. It MUST draw fractionally moving **glyph trains**, not type letters into a fixed stationary grid or accumulate ghost frames.

| Parameter            | Baseline behavior                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Font sizes           | 18, 21, 24, 28 CSS px; lane probabilities 20%, 35%, 30%, 15%.                                                                                                          |
| Cell separation      | `fontSize + ceil(fontSize × 0.24)`; one atlas blit for each separated glyph.                                                                                           |
| Falling speed        | 6.5 rows/second × independent lane multiplier 0.8–1.2; positions integrate elapsed time.                                                                               |
| Tail length          | 12–16 glyphs per train.                                                                                                                                                |
| Train spacing        | Tail length + 14–26 rows; multiple trains can occupy a tall lane.                                                                                                      |
| Initial distribution | Stratified golden-ratio phase plus random jitter, not one dense entrance wave followed by a global wait.                                                               |
| Mutation             | Independent lane cadence 120–240ms. Every visible tail glyph changes on its head's mutation tick, not a sparse subset.                                                 |
| Tail energy          | Random target 0.6–1, smoothed with an 80ms time constant; fade `(1 - index/tailLength)^1.65` plus a moving glint; head alpha 1.                                        |
| Pointer lens         | 360px radius, radial displacement with cubic falloff and target strength 0.18. Center follows the latest target with `1-exp(-elapsed/300)`; strength uses 80ms easing. |

Both light and dark palettes MUST be rasterized at boot into per-font-size glyph atlases. Theme changes select atlas rows without repeatedly rasterizing text. Dark rain uses gold `#D48B38` tails and bright `#FEF08A` heads; light rain uses garnet `#7A1C16` tails and `#8B1E17` heads. Container opacity is 0.28 in the selected dark theme and 0.2 in light, independent of OS color preference.

Each draw clears the logical surface before drawing current positions. Train identities remain stable until leaving the viewport; old offscreen train state is pruned. A resized/narrowed viewport MUST NOT discard existing lane identities. New width adds lanes only when needed; lanes outside current width remain available for later expansion.

Pointer listeners MUST coalesce to at most one small message per owner frame, ignore touch pointers, and deactivate the lens on window leave/blur. Pointer messages update targets only; they do not teleport the lens or reset rain state.

The exposed density/opacity component attributes are not the active algorithm's density controls: baseline lane packing and train spacing govern quantity, and CSS governs container opacity. Do not assume changing the data attributes retunes `MatrixGrid`.

**Scenario:** Given a viewport with falling trains, when observing consecutive frames, then glyph coordinates move fractionally, the head and tail recode at the same lane cadence, and tails fade without doubled letters. Given a fast pointer movement, then the lens center eases toward the latest target instead of snapping. Existing evidence: `tests/matrix-rain.test.ts`.

## SPA-05 — Live zoom and viewport geometry

`src/scripts/matrix-viewport.ts` MUST observe window resize, `visualViewport.resize`, canvas ResizeObserver changes, and rearmed resolution media queries. Ignore transient disconnected or zero-size canvas measurements during swaps.

For logical width/height and current DPR, backing scale is `min(dpr || 1, 1, sqrt(1920×1080 / max(1,width×height)))`; each backing dimension is floored and at least 1. This caps raster work rather than allocating full high-DPR resolution on large displays. After every resize, reset the context transform and scale by the actual floored backing dimensions divided by logical dimensions. Do not reuse an outdated DPR transform when rounded backing dimensions happen to match.

Viewport/zoom changes MUST call the existing grid's `resize` and repaint without recreating the renderer or its lane phases. Lens coordinates remain CSS viewport coordinates. The retained lanes and time-based positions are the continuity boundary, not pixel-identical glyph placement after dimensions change.

**Scenario:** Given rain running in Worker or fallback mode, when zooming in/out without reload and changing viewport/DPR repeatedly, then the surface mapping updates, no unpainted stale regions remain, the lens remains aligned, and renderer identity does not change. Existing evidence: `tests/matrix-zoom.spec.ts`, `tests/matrix-rain.test.ts`.

## SPA-06 — Theme initialization and circular reveal

Before initial paint and before an Astro swap, BaseLayout MUST apply the resolved theme to the incoming document's classes, `data-theme`, `colorScheme`, and dark background. Resolution prefers in-memory `__currentTheme`, then local storage, then session storage; absent preference follows OS color scheme. Storage access failures MUST NOT prevent rendering. Keep after-swap/page-load synchronization and the storage listener.

ThemeToggle MUST synchronize its icon and accessible action label and persist the selected light/dark theme to both supported storage layers. Apply the theme and dispatch `theme-changed` on both window and document; Matrix theme selection is idempotent despite the two event targets.

With native View Transition support and animation enabled, the sequence MUST remain:

1. Determine the click position, falling back to the toggle center for keyboard activation; mark transition state and direction before requesting snapshots.
2. Call `document.startViewTransition` and apply the new theme in its update callback.
3. Keep old root pixels fully visible. CSS hides the new root snapshot with `clip-path: circle(0px)` before the animation's first frame, preventing a full-white prepaint flash.
4. On `transition.ready`, animate only `::view-transition-new(root)` clipPath for 420ms, easing `cubic-bezier(0.4,0,0.2,1)`, `fill: both`.
5. Use `circularThemeClip`: an inset square of side `2r`, rounded by `r`, from radius 0 to the farthest viewport corner. Negative insets are intentional. Do not scale page content or animate layout dimensions.
6. Finish/cancel/ready failure/transition-finished paths share an idempotent cleanup. Remove transition attributes/class on the next owner frame and emit exactly one `theme-transition-end` per animated change.

The root group MUST not morph/scale; old/new snapshots use normal blend mode. Theme state suppresses competing CSS transitions and temporarily folds named HUD/Matrix layers into the root snapshot. Ordinary navigation's no-snapshot rule resumes when cleanup completes.

If unsupported, reduced motion is requested, the feature flag disables animation, `window.__DISABLE_THEME_ANIMATION__` is true, or local `disable_theme_anim` equals `true`, apply the theme directly. This direct path is not an animated transition and does not need an animated completion event.

**Scenario:** Given delayed first animation-frame delivery, when changing dark to light, then old pixels remain visible until the reveal starts rather than showing a white full viewport. Given cancellation, then transition markers are removed and completion is emitted once. Existing evidence: `tests/theme-clip.test.ts`, `tests/spa-continuity.spec.ts`.

## SPA-07 — Header, anchors, loading HUD, and language suggestion

The current Header MUST remain `sticky top-0` without scroll-hide transforms. It sets `data-scrolled` after 16px for visual state and synchronizes before paint. `header-scroll.ts` retains a separately tested historical hysteresis helper; its hide policy is not the current visible header behavior. Services routes MUST activate Services, not More; blog routes activate More through the shared `nav-state.ts` resolver.

Anchor navigation MUST account for sticky header height, reveal contained sections before measuring, and coordinate programmatic scrolling with active-section state. Same-page About returns to the top without fetching a new document. Contact navigation resolves the destination section, updates active state, and scrolls rather than leaving stale section highlighting. Back-to-top and TOC are route-aware controls, not duplicate navigation routers.

The navigation beacon MUST debounce ordinary display by 240ms, remain visible at least 120ms once shown, and have a 6-second safety timer. Clear it on successful swaps/page-load/pageshow and canceled/download-like flows. Timeline actions may request immediate display. Before a normal swap close mobile menus, dialogs, and ephemeral copy feedback; release body overflow. Do not preserve transient copy toasts as if they were the session language banner.

LanguageSuggestionBanner MUST offer only an available counterpart, respect session dismissal/manual override, refresh its route target/copy, and animate entrance once per session. It uses session storage, not a cross-session dismissal in local storage. Existing visible banner and floating-stack elevation MUST be synchronized into the incoming document before swap. Stack collision adjustment uses transforms and actual banner bounds rather than layout-position animation.

**Scenario:** Given a dismissed suggestion, when visiting another route, then it stays dismissed for that session. Given a visible suggestion, when switching jobs or routes, then its target matches the destination and floating controls do not jump through it. Existing evidence: `tests/spa-continuity.spec.ts`, `tests/spec-007/spec-007.test.ts`.

## SPA-08 — Modal and keyboard ergonomics

| Surface                     | Current interaction contract                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Universal search            | Open from triggers, `/` outside text input, Cmd/Ctrl+K, or a technology badge with its term. Focus search input; ArrowUp/Down navigates results; Enter activates the selected item. Close before route navigation; native dialog close restores the initiating control or main focus where available. Search engine/network behavior is specified in Platform. |
| Page index                  | Rebuild sections/custom items for the current route; `I` toggles it only outside typing/modal contexts; `P` delegates to the visible print action only on resume routes. J/K stepping uses the existing section-index state and 240ms gate rather than repeatedly measuring unstable positions mid-scroll.                                                     |
| Escape hierarchy            | Close dialog, close header details, close TOC, blur editable field, scroll to top above 40px, navigate to localized parent route at top, then open shortcuts at homepage top. Preserve `escape-router.ts` as the shared hierarchy.                                                                                                                             |
| Typing/modal isolation      | Page-index navigation shortcuts MUST ignore inputs, textareas, selects, contenteditable targets, modifier combinations, and open dialogs. Timeline H/L/arrows obey their matching isolation. A modal's own navigation does not grant global shortcuts authority.                                                                                               |
| Coffee sponsorship          | Native dialog with actual overflow hints recalculated using MutationObserver, ResizeObserver, and multi-stage layout timing. Existing payment/link/crypto-copy choices are data-driven; do not represent a future-action button as a completed payment integration.                                                                                            |
| Shortcuts and online judges | Optional data-driven modal lists; clickable destination tiles and real scroll hints. Shortcuts footer MUST not advertise unsupported J/K scrolling inside that dialog.                                                                                                                                                                                         |
| Contact modal               | Client form dialog, validation/submission state and dismissal remain usable after route setup; backend validation/abuse/notification semantics are in Edge operations.                                                                                                                                                                                         |
| Email copy                  | Native custom element binds/unbinds its own click listener. Use Clipboard API in secure contexts with existing textarea fallback; show success only after a successful copy. Status feedback is a manual popover/top-layer notification with z-index fallback and polite live announcement.                                                                    |

Native dialogs/semantic controls and visible focus states MUST remain keyboard accessible. Closed modal content MUST not participate in initial layout/paint (`global.css` containment rules). Dynamic `will-change` used during a real motion MUST be released; avoid permanently promoting every surface.

**Scenario:** Given focus in any editable field or an open dialog, when typing J/K/I/H/L, then unrelated global navigation does not consume the input. Given a coffee dialog that gains overflow after opening, then its scroll hint updates without a second open. Existing evidence: `tests/spec-009/spec-009.test.ts`, `tests/spec-006/spec-006.test.ts`.

## SPA-09 — Design system and readable content surfaces

The visual language MUST preserve the current semantic tokens rather than introduce a second palette/component system: Geist Sans/Mono families, garnet surfaces, restrained gold accents, precision borders, responsive type/spacing, and light/dark equivalents. `global.css` owns theme tokens, font fallback metrics, selection/scrollbars, content containment, print exclusions, and reduced-motion overrides. Print-specific resume behavior is specified in Platform.

The shared `.geometric-box` MUST use one parent geometry and two pointer-transparent full-bound pseudo-element strokes:

- Default radius is 0.25rem in the components layer. Actual responsive radius utilities remain authoritative via `border-radius: var(--geometric-radius, revert-layer)`; an explicit token may override them.
- Parent layout border width is 0. `::before` supplies the normal 1px outline, inheriting the parent's border color. `::after` supplies the 2px accent ring. Both use `inset: 0`, inherited radius, border-box sizing, and z-index 5.
- Accent visibility is a 135-degree diagonal mask selecting opposite corners. Corner extent defaults to `max(1rem, geometric-radius + 0.5rem)` or explicit `--geometric-corner-size`; stroke widths have their own existing custom properties.
- `.no-corner-accents` hides only `::after`, never the structural outline. Clipped/overflow-hidden surfaces MUST retain matching ring geometry. Hover/highlight changes the parent's border color and shadow without a second delayed child-color transition or pointer interception.

Project and post details MUST use the shared ArticleLayout composition: an unboxed max-width article with responsive outer gutters, separate back link, opaque geometric header with title/description and separated date/tags, then a separately bordered opaque prose body. Preserve first-child margin reset, code overflow handling, heading/list/blockquote styles, and tag-to-search buttons. Services retain their corresponding separate header/body presentation rather than a monolithic inconsistent article box.

Blog listing surfaces MUST preserve readable themed surfaces and content spacing; visibility is content-driven, so absence of published posts is not a rendering failure by itself. Experience detail's opaque role header MUST mask the timeline rail behind it while timeline arrows remain above it and clickable. Company tooltips and timeline branches are not alternate `.geometric-box` corner implementations.

**Scenario:** Given mobile/desktop detail pages in both themes, then header/body surfaces are separate and readable, side gutters remain, and content does not overflow horizontally. Given radius utilities at responsive breakpoints, clipped overflow, and accent opt-out, then both border rings follow the actual parent radius and links remain clickable. Existing evidence: `tests/blog-surfaces.spec.ts`, `tests/experience-surfaces.spec.ts`, `tests/geometric-corners.spec.ts`.

## SPA-10 — Supporting visual components and interactive demonstrations

These public presentation features MUST remain distinct from actual server telemetry and admin data:

| Feature               | Current behavior and boundary                                                                                                                                                                                                                                                                                                                                                                                                     | Source                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Typewriter ticker     | Render the first phrase as SSR text and reserve minimum height. With multiple phrases and motion allowed, begin after the idle/interaction gate and only while visible in an active tab. Default type/delete/pause timings are 45ms/20ms/2200ms, with a 300ms pause before the next phrase; clear timers and observers on disconnect. The shared gate waits 3500ms after load then idle availability, or releases on interaction. | `src/components/ui/TypewriterTicker.astro`, `src/utils/client-visibility.ts` |
| Optimized visual      | Reserve the source image aspect ratio and dimensions. Use Astro Image, quality 65; hero images are eager/sync/high-priority while other images are lazy/async/auto-priority. This is a build-time image component, not a client image framework.                                                                                                                                                                                  | `src/components/ui/OptimizedVisual.astro`                                    |
| Technical terms       | Render a selectable inline term with `translate="no"`/`notranslate`, optional mono styling and title; do not translate technology identifiers as prose.                                                                                                                                                                                                                                                                           | `src/components/ui/TechTerm.astro`                                           |
| Simulation cards      | Read curated `src/data/simulations.ts` steps; Run disables duplicate execution, resets step/log display, sequences highlights and canned log lines, and reenables itself on completion. Company controls open a tooltip/filter destination and View Role links to the corresponding job. Reinitialize newly replaced job cards through the existing `__initSimulationCards` hook.                                                 | `src/components/ui/SimulationCard.astro`                                     |
| System telemetry demo | Browse previous/next curated simulations and run their visual step pipeline, timer, log feed, and before/after metric rows. The custom element aborts owned listeners and clears its observer/timers on disconnect. Intersection visibility controls its ping behavior. These are illustrative data and simulated timings, not measured production requests, quota consumption, or live infrastructure monitoring.                | `src/components/ui/SystemTelemetryDemo.astro`                                |

The two simulation presentations sequence steps using `step.durationMs × 25 + 150`ms delays, visually ping a step for 400ms, and show completion highlights for approximately 2 seconds. Their elapsed timer measures browser presentation duration, not the source system's actual latency. A local curated demonstration MUST NOT be described as an executable integration with the represented companies or backend systems.

**Scenario:** Given a simulation display, when Run is activated twice before completion, then only the first starts a pipeline; steps/logs advance and the control becomes available on completion. Given a typewriter leaving view or disconnecting, then its owned loop stops while the SSR phrase/content remains available. Typewriter structure has source-level anchors in `tests/spec-007/spec-007.test.ts`; the complete demonstration interaction currently needs a targeted browser/manual check and is not claimed covered by that test.

## Verification map and limits

| Requirement  | Source of behavior                                                                                      | Regression anchors                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| SPA-01/02    | `BaseLayout.astro`, experience detail inline navigation, `src/stores/uiState.ts`, global snapshot rules | `spa-continuity.spec.ts`, `spa-html-cache.test.ts`, `timeline-telemetry.spec.ts`                                |
| SPA-03/04/05 | `MatrixBackground.astro`, `matrix.worker.ts`, `matrix-grid.ts`, `matrix-viewport.ts`                    | `matrix-worker.test.ts`, `matrix-rain.test.ts`, `matrix-zoom.spec.ts`, `matrix-software.spec.ts`                |
| SPA-06       | `ThemeToggle.astro`, `theme-clip.ts`, BaseLayout prepaint and global theme rules                        | `theme-clip.test.ts`, `spa-continuity.spec.ts`                                                                  |
| SPA-07/08    | Header, LanguageSuggestionBanner, PageIndexNav, modal components, `src/lib/navigation/`                 | `spec-006/spec-006.test.ts`, `spec-007/spec-007.test.ts`, `spec-009/spec-009.test.ts`, `spa-continuity.spec.ts` |
| SPA-09       | `global.css`, ArticleLayout, service/experience detail, blog index                                      | `blog-surfaces.spec.ts`, `experience-surfaces.spec.ts`, `geometric-corners.spec.ts`                             |

Source paths in the table are under `src/components/{common,ui}/`, `src/layouts/`, `src/pages/[...lang]/`, `src/scripts/`, `src/stores/`, or `src/styles/` as named above; test paths are under `tests/`. A passing source-assertion unit test does not replace browser interaction, visual inspection, or field data. Worker drawing measurements do not by themselves prove presentation on a real display. Local browser continuity does not establish the production Worker retained the same HTML/script metadata; verify the actual serving path independently.

## Discovery controls — subsequent navigation fix

The actual `universal-search-modal` custom-element root persists across route swaps. Locale changes update localized labels through the existing owner rather than replacing its listener-owned input/results subtree. Search must continue typing, clearing, keyboard selection and closing after repeated page and language changes, retaining one cached search index owner (`tests/search-navigation.spec.ts`). The floating Page Index label is “Index” below 640px and “Page Index” from 640px; Spanish retains “Índice”. Existing desktop-left eligibility and gutter geometry remain unchanged (`tests/page-index-responsive.spec.ts`).
