# ROLE & OBJECTIVE

Act as a Staff Astro v7 & Frontend Performance Architect (120 FPS / Zero CLS / SPA App-Shell Specialist).
Eliminate all visual jumps, re-mount flickers, and delayed entrance animations on client-side page transitions (`<ClientRouter />`) for `PageIndexNav.astro`, `LanguageSuggestionBanner.astro`, `BackToTopButton.astro`, `Header.astro`, and `BaseLayout.astro`.

Every route change must behave like a native 120 FPS Single Page Application (SPA): persistent HUD chrome must never unmount, re-animate, or shift coordinates when navigating between pages, while `<main id="main-content">` swaps seamlessly.

---

## TASK 1: PERSISTENT SPA APP-SHELL IN `src/layouts/BaseLayout.astro`

**File to modify**:

- `src/layouts/BaseLayout.astro`

**Instructions**:

1. Treat all global HUD chrome and modals in `BaseLayout.astro` as a persistent SPA App Shell using `transition:persist`:
   - Add `transition:persist="matrix-bg"` to `<MatrixBackground />` (if rendered).
   - Add `transition:persist="page-index-nav"` to `<PageIndexNav />`.
   - Add `transition:persist="back-to-top"` to `<BackToTopButton />`.
   - Add `transition:persist="language-banner"` to `<LanguageSuggestionBanner />`.
   - Add `transition:persist` to global modals (`<UniversalSearchModal />`, `<ShortcutsModal />`, `<CoffeeSponsorshipModal />`, `<ContactFormModal />`, `<OnlineJudgesModal />`) so their DOM nodes and listeners are initialized once per session instead of being destroyed and recreated on every route change.
2. Expose current page metadata on `<html>` or `<body data-current-locale={lang} data-current-path={Astro.url.pathname}>` and synchronize those attributes in the `astro:after-swap` inline listener in `<head>` so persisted components can read the incoming document's locale, `alternate` hreflang links (`link[rel="alternate"][hreflang]`), and UI strings synchronously before the browser paints.

---

## TASK 2: ZERO-JUMP PERSISTENT `PageIndexNav.astro` WITH PRE-PAINT `astro:after-swap` SYNC

**File to modify**:

- `src/components/ui/PageIndexNav.astro`

**Root Cause to Fix**:
Currently, `PageIndexNav.astro` is destroyed on every route change and re-scans headings inside `astro:page-load` (which fires _after_ the View Transition completes), causing the floating button to pop/jump in and out after navigation.

**Instructions**:

1. Make `PageIndexNav.astro` work as a single persistent HUD instance (`transition:persist="page-index-nav"`).
2. Store localized UI labels (`en` and `es` translations for the index title/aria-labels) in `data-i18n-en` and `data-i18n-es` attributes on the root container so the persistent instance updates its labels instantly when the `<html lang>` changes across routes.
3. Replace late `astro:page-load` DOM reconstruction with a two-phase lifecycle:
   - **Pre-Paint Route Sync (`astro:after-swap`)**: Immediately upon `astro:after-swap` (before the browser paints the new page), close any open drawer/popover without layout shift, scan `<main id="main-content">` for sections/headings, rebuild the internal TOC list, and set visibility (`data-has-sections="true|false"`).
   - **Initial Mount**: Run the same scan once on initial script execution if DOM is ready.
4. **Eliminate Layout Shifts on Show/Hide**:
   - Never toggle `display: none` (`hidden`) right after a transition frame in a way that causes adjacent floating buttons to jump. Use GPU compositor properties (`opacity`, `transform: translate3d(...)`, `pointer-events-none`) with a fixed, reserved coordinate slot, and suppress CSS transition animations during the exact frame of `astro:after-swap` by toggling a temporary `.no-transition` class (`transition: none !important`) for 1 animation frame (`requestAnimationFrame`).
5. Clean up any previous `IntersectionObserver` instance before observing the new page's headings so zero observers leak across SPA navigations.

---

## TASK 3: ZERO-FLICKER SESSION STATE MACHINE FOR `LanguageSuggestionBanner.astro`

**File to modify**:

- `src/components/ui/LanguageSuggestionBanner.astro`

**Root Cause to Fix**:
Currently, `LanguageSuggestionBanner.astro` is re-created on every page load and re-runs its entrance transition on `astro:page-load` whenever the user navigates between pages without dismissing it, making the "Contenido disponible en..." toast jump on every click.

**Instructions**:

1. Design `LanguageSuggestionBanner.astro` to persist across the entire SPA session (`transition:persist="language-banner"`).
2. Pre-embed the localized banner templates/strings for all supported locales (`en`, `es`) in `data-i18n` attributes on the banner root so it can dynamically update its target link and text without unmounting.
3. Implement a strict **Session State Machine** in `window.__langBannerState`:
   - `hasAnimatedIn`: boolean (tracks if the entrance animation has already played once in this session).
   - `isDismissed`: boolean (synced with `localStorage` / `sessionStorage`).
4. **Behavior on Initial Load vs. Route Changes (`astro:after-swap`)**:
   - Read the current page locale from `document.documentElement.lang` and find the matching alternate URL from `document.head.querySelectorAll('link[rel="alternate"][hreflang]')`.
   - If the user's preferred browser language already matches `document.documentElement.lang`, OR if `isDismissed` is true, OR if the current page does not have a translation in the suggested locale (e.g., missing `hreflang` link): hide the banner immediately in `astro:after-swap` (before paint, with zero animation).
   - If the banner SHOULD be visible and `hasAnimatedIn === false` (first page of the session): play the smooth compositor entrance animation once and set `hasAnimatedIn = true`.
   - If the banner is ALREADY visible (`hasAnimatedIn === true`) when the user navigates to another page: **DO NOT re-run the entrance animation and DO NOT hide/re-show the banner**. Simply update the `href` of the CTA anchor in-place during `astro:after-swap` to point to the new page's translated equivalent URL so the toast remains rock-solid in the viewport.
   - When the user clicks the CTA link inside the banner to switch languages, immediately mark the banner as handled/hidden before navigation starts so it never flashes on the destination locale.

---

## TASK 4: COORDINATED FLOATING HUD STACK & PERSISTENT `Header.astro` / `BackToTopButton.astro`

**Files to modify**:

- `src/components/ui/BackToTopButton.astro`
- `src/components/common/Header.astro`
- `src/components/common/LanguageSwitcher.astro`
- `src/styles/global.css`

**Instructions**:

1. **`BackToTopButton.astro`**:
   - Ensure the listener registration is idempotent (`window.__backToTopInitialized`) so `transition:persist="back-to-top"` attaches the passive scroll listener only once per session.
   - On `astro:after-swap`, synchronously evaluate `window.scrollY` and update visibility without triggering a bounce/jump animation.
   - Ensure non-overlapping fixed coordinates with `PageIndexNav.astro` and `LanguageSuggestionBanner.astro` so showing/hiding `BackToTopButton` never pushes or shifts `PageIndexNav` or `LanguageSuggestionBanner`.
2. **`Header.astro` & `LanguageSwitcher.astro`**:
   - Synchronize active nav link states (`aria-current="page"`, active indicator styles) and the `LanguageSwitcher` target URLs inside `astro:after-swap` (reading `window.location.pathname` and `<head>` `link[rel="alternate"][hreflang]`) so the header updates at the exact instant of DOM swap with zero delay.
3. **View Transition Layer Isolation in `src/styles/global.css`**:
   - Assign dedicated `view-transition-name` rules to the persistent HUD elements (`header`, `page-index-nav`, `language-banner`, `back-to-top`).
   - During standard route navigations (`html:not(.theme-transitioning)`), disable browser crossfade/morph animations on those HUD layers (`animation: none !important; mix-blend-mode: normal !important;`) so only `<main id="main-content">` transitions while the HUD stays pinned at 120 FPS without ghosting or jumping.
   - Preserve the full `::view-transition-old(root)` / `::view-transition-new(root)` WAAPI circular reveal when `html.theme-transitioning` is active.

---

## TASK 5: REGRESSION TESTS FOR SPA PERSISTENCE & ZERO JUMPS

**Files to modify**:

- `tests/spec-006/spec-006.test.ts` (or `tests/spec-007/spec-007.test.ts`)
- `tests/odd-tasks.test.ts`

**Instructions**:

1. Add tests verifying that `BaseLayout.astro` declares `transition:persist` on `PageIndexNav`, `LanguageSuggestionBanner`, and `BackToTopButton`.
2. Verify that `PageIndexNav.astro` and `LanguageSuggestionBanner.astro` synchronize state on `astro:after-swap` and do not re-trigger entrance animations on subsequent route changes when already visible.
3. Run the full verification suite:
   ```bash
   pnpm run typecheck
   pnpm test
   pnpm run build
   npx tsx scripts/audit-codebase.ts
   ```
