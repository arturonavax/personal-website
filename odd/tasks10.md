# PROMPT FOR CODING AGENT: Absolute 100/100 Performance, Zero-Bug SPA Lifecycle & Full Functional Restoration

You are a Staff Frontend Performance Architect and Senior Astro v7 / Cloudflare Edge Engineer.
Your mission is to fix ALL functional bugs, SPA lifecycle regressions, modal hydration race conditions, scroll-jumping issues, and Lighthouse 13.5 bottlenecks in this repository **without removing or stubbing out a single existing feature**. Every feature (Universal Search, Shortcuts Modal, Coffee Sponsorship Modal, Online Judges Modal, Contact Form Modal, System Telemetry Demo, Matrix Background, Typewriter Ticker, Page Index Nav, Filter Bars, Language Switcher, Theme Circular Reveal, Resume Maker/Exporter, and Cloudflare Worker Edge features) must work flawlessly with 120 FPS SPA fluidity and achieve **100/100 across all Lighthouse categories (Performance, Accessibility, Best Practices, SEO, Agentic Browsing)**.

---

## NON-NEGOTIABLE ENGINEERING RULES

1. **Zero Feature Removal:** Do not delete any modal, section, simulation, filter bar, or interactive tool. Fix their lifecycle and loading strategy instead.
2. **Zero Synchronous `<script is:inline>` Bloat in `<body>`:** Only ONE synchronous `<script is:inline>` is permitted in the entire HTML document: the critical Zero-FOUC + Cloudflare JSD Neutralizer in `<head>`. All component scripts MUST be standard Astro bundled `<script>` modules (or externalized TS modules imported by `<script>`) so Vite minifies, deduplicates, caches them under `/_astro/*`, and executes them with `defer` after HTML parsing.
3. **Deterministic SPA Cleanup (`AbortController`):** Every component script that attaches listeners to `window` or `document` or creates `IntersectionObserver` / `setInterval` / `requestAnimationFrame` MUST clean them up on `astro:before-preparation` using an `AbortController` to prevent memory leaks and duplicate handler execution across `ClientRouter` navigations.
4. **No `<template>` Race Conditions for Modals:** Do not trap modals inside an unhydrated `<template>` that breaks Astro module scripts and misses the first user click. Instead, render modals in the DOM with `hidden` + `content-visibility: hidden` + `contain: strict` when closed (zero layout/paint cost in Blink), and initialize their event bindings inside `requestIdleCallback` (with immediate synchronous fallback if a modal trigger is clicked before idle).

---

## TASK 1: Bulletproof Cloudflare JSD & Deprecation Neutralizer in `<head>`

**File:** `src/layouts/BaseLayout.astro`

Cloudflare Edge injects a 625-byte script at the end of the HTML stream that creates a hidden `1x1` `<iframe>` and loads `/cdn-cgi/challenge-platform/scripts/jsd/main.js`, which triggers Chrome deprecation warnings (`StorageType.persistent` and `Protected Audience API`, dropping Best Practices to 81/100) and causes a 177ms CPU task.

Update the synchronous `<head>` `<script is:inline>` in `src/layouts/BaseLayout.astro` to completely neutralize Cloudflare JSD injection across `appendChild`, `insertBefore`, `append`, and `HTMLScriptElement.prototype.src`:

```html
<script is:inline>
  (function () {
    // 1. Complete Neutralization of Cloudflare Edge JSD Challenge Script & 1x1 Iframe
    function isCfChallengeNode(node) {
      if (!node || node.nodeType !== 1) return false;
      var tag = node.tagName;
      if (tag === "IFRAME") {
        var w = node.width || (node.style && node.style.width);
        var h = node.height || (node.style && node.style.height);
        var vis = node.style && node.style.visibility;
        if (
          (!node.src || node.src === "about:blank") &&
          (w == 1 || w === "1px" || h == 1 || h === "1px" || vis === "hidden")
        ) {
          return true;
        }
      }
      if (tag === "SCRIPT") {
        var src =
          node.src || (node.getAttribute && node.getAttribute("src")) || "";
        var text = node.textContent || "";
        if (
          src.indexOf("/cdn-cgi/challenge-platform/") !== -1 ||
          text.indexOf("__CF$cv$params") !== -1 ||
          text.indexOf("/cdn-cgi/challenge-platform/") !== -1
        ) {
          return true;
        }
      }
      return false;
    }

    var origAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function (node) {
      if (isCfChallengeNode(node)) return node;
      return origAppendChild.call(this, node);
    };

    var origInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (node, child) {
      if (isCfChallengeNode(node)) return node;
      return origInsertBefore.call(this, node, child);
    };

    // 2. Zero-FOUC Theme Initialization & View Transition Swap Sync
    function applyTheme(doc) {
      var stored = null;
      try {
        stored = localStorage.getItem("theme");
      } catch (_) {}
      var prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      var isDark = stored ? stored === "dark" : prefersDark;
      var root = doc.documentElement;
      root.classList.toggle("dark", isDark);
      root.classList.toggle("light", !isDark);
      root.style.colorScheme = isDark ? "dark" : "light";
    }

    applyTheme(document);

    document.addEventListener("astro:before-swap", function (ev) {
      applyTheme(ev.newDocument);
    });
  })();
</script>
```

---

## TASK 2: Fix All 5 Modals & Eliminate `<template>` Hydration Bugs

**Files:**

- `src/layouts/BaseLayout.astro`
- `src/components/ui/UniversalSearchModal.astro`
- `src/components/ui/ShortcutsModal.astro`
- `src/components/ui/CoffeeSponsorshipModal.astro`
- `src/components/ui/OnlineJudgesModal.astro`
- `src/components/ui/ContactFormModal.astro`

### Why the current implementation is broken:

In `BaseLayout.astro`, wrapping the 5 modals inside `<template id="deferred-modals-template">` causes `UniversalSearchModal`'s module script to run on `astro:page-load` while the modal DOM is still inside `<template>`, so `document.getElementById('search-modal-backdrop')` returns `null` and the search modal never initializes. Meanwhile, the other 4 modals use `<script is:inline>` which misses `astro:page-load` when cloned on first click and leaks duplicate global listeners on subsequent SPA navigations.

### Required Fix:

1. **In `src/layouts/BaseLayout.astro`:**
   - Remove `<template id="deferred-modals-template">` and `mountDeferredModals()`.
   - Render `<UniversalSearchModal lang={lang} />`, `<ShortcutsModal lang={lang} />`, `<CoffeeSponsorshipModal lang={lang} />`, `<OnlineJudgesModal lang={lang} />`, and `<ContactFormModal lang={lang} />` inside `<div id="modals-portal" class="modals-portal">`.
2. **In `src/styles/global.css`:**
   - Ensure any closed modal backdrop (`[data-modal-backdrop].hidden`, `[aria-hidden="true"]`) has `display: none !important; content-visibility: hidden !important; contain: strict;` so Blink spends **0.0 ms** computing style or layout for closed modals during initial page load.
3. **Convert all 5 Modal Scripts from `<script is:inline>` to Bundled `<script>` Modules with Clean Lifecycle:**
   - Remove `is:inline` from `ShortcutsModal.astro`, `CoffeeSponsorshipModal.astro`, `OnlineJudgesModal.astro`, and `ContactFormModal.astro`. Pass any server variables (`lang`, `turnstileSiteKey`, etc.) via `data-*` attributes on the modal root element.
   - In every modal script (`UniversalSearchModal`, `ShortcutsModal`, `CoffeeSponsorshipModal`, `OnlineJudgesModal`, `ContactFormModal`):
     - Bind an `AbortController` per page load (`let controller: AbortController | null = null;`).
     - Clean up on `document.addEventListener('astro:before-preparation', () => controller?.abort())`.
     - Initialize on `astro:page-load` so every button click (`[data-open-contact-modal]`, `[data-open-coffee-modal]`, `[data-open-judges-modal]`, `[data-open-shortcuts-modal]`, `#search-trigger`), keyboard shortcut (`Cmd+K`, `?`, `Escape`), backdrop click, and `uiState` subscription works on the **very first interaction** and across unlimited SPA navigations.

---

## TASK 3: Fix Persisted Header i18n & Active Route Desynchronization

**Files:**

- `src/layouts/BaseLayout.astro`
- `src/components/common/Header.astro`
- `src/components/common/LanguageSwitcher.astro`

### Why the current implementation is broken:

`<Header>` has `transition:persist="site-header"` in `BaseLayout.astro`. When navigating from `/en/...` to `/es/...` (or vice versa), the persisted Header DOM does not update its localized text labels, localized `href` attributes, or `LanguageSwitcher` state. Furthermore, active route highlighting (`aria-current="page"`) becomes stale.

### Required Fix:

1. Remove `transition:persist="site-header"` from `<Header>` in `src/layouts/BaseLayout.astro` (keep `transition:name="site-header"` or let Astro swap the header cleanly with zero animation flicker since `::view-transition` is controlled), **OR** if persisting `<Header>`, store localized label maps (`data-labels-en`, `data-labels-es`) on nav items and synchronize all `href`s, text labels, `aria-current="page"`, and `LanguageSwitcher` state inside an `astro:after-swap` / `astro:page-load` handler.
2. Removing `transition:persist="site-header"` while keeping `Header.astro`'s script as a bundled `<script>` module (not `is:inline`) is cleaner, guarantees 100% accurate i18n labels/links on every route, and eliminates ~5 KB of inline JS from every HTML page.
3. Convert `Header.astro` and `LanguageSwitcher.astro` scripts from `<script is:inline>` to standard bundled `<script>` modules with `AbortController` cleanup on `astro:before-preparation`.

---

## TASK 4: Eliminate the 82.6 KB Inline Script Bloat & 2,414 ms `Style & Layout` Block

**Files:**

- `src/components/ui/SystemTelemetryDemo.astro`
- `src/components/ui/PageIndexNav.astro`
- `src/components/ui/ExperienceFilterBar.astro`
- `src/components/ui/ProjectsFilterBar.astro`
- `src/components/ui/CaseStudiesFilterBar.astro`
- `src/components/ui/BlogFilterBar.astro`
- `src/components/ui/LanguageSuggestionBanner.astro`
- `src/components/ui/BackToTopButton.astro`
- `src/components/ui/EdgeViewCounter.astro`
- `src/components/ui/LinkGenerator.astro`
- `src/components/ui/ResumeExportBar.astro`
- `src/components/ui/ResumeAttributionBar.astro`

### Why the current implementation is slow:

Lighthouse `script-treemap-data` shows **14 inline scripts totaling 82,652 bytes** embedded directly in `index.html` (`SystemTelemetryDemo` alone is ~20.5 KB inline, `PageIndexNav` + filters are another ~45 KB inline). Inline scripts in `<body>` pause the HTML parser and force synchronous style & layout recalculation on all 1,573 DOM nodes before First Contentful Paint.

### Required Fix:

1. **Remove `is:inline` from ALL the components listed above.**
2. Move any server-passed configuration (`define:vars={{ ... }}`) to `data-*` attributes (or a `<script type="application/json" data-config>` tag which the browser parser never executes synchronously) and read them from a standard Astro `<script>` module.
3. **In `src/components/ui/SystemTelemetryDemo.astro`:**
   - Do NOT initialize the telemetry simulation or DOM counters synchronously during page load.
   - Use an `IntersectionObserver` (`rootMargin: '200px'`) so the telemetry simulation loop (`setInterval` / `requestAnimationFrame`) ONLY starts when `#telemetry` is near or inside the viewport, and pauses immediately when scrolled out of view or when `document.hidden` is `true`.
4. **In `src/components/ui/MatrixBackground.astro` and `src/components/ui/TypewriterTicker.astro`:**
   - Delay starting the `TypewriterTicker` interval and `MatrixBackground` canvas/worker animation until after the initial paint & LCP settle (e.g., wrap their start in `requestIdleCallback(..., { timeout: 1200 })` after `astro:page-load`). Render the first ticker string statically in HTML so there is zero layout/text mutation in `#about` during the LCP measurement window.

---

## TASK 5: Fix Scroll Jumping on Anchor Navigation & Optimize CSS Containment

**Files:**

- `src/styles/global.css`
- `src/components/ui/PageIndexNav.astro`
- `src/components/ui/ExperienceTimeline.astro`

### Why the current implementation breaks scroll & layout:

1. Setting `content-visibility: auto; contain-intrinsic-size: auto 640px;` on `main section:not(#about)` causes severe scroll jumping when clicking anchor links (`#contact`, `#ai-engineering`, `#case-studies`) because off-screen sections expand from `640px` to `1,500px+` mid-scroll.
2. In `ExperienceTimeline.astro`, rendering dozens of hidden/collapsible bullet points and SVG tech icons per role inflates the initial DOM node count to 1,573 elements.

### Required Fix:

1. **In `src/styles/global.css`:**
   - Replace the generic `640px` intrinsic size with accurate section-specific intrinsic heights or `contain: layout style;` so scroll offsets remain stable, AND before smooth-scrolling to any `#hash` anchor in `PageIndexNav.astro` or `Header.astro`, temporarily add a class `html.is-anchor-scrolling main section { content-visibility: visible !important; }` so the browser calculates the exact `getBoundingClientRect().top` before calling `window.scrollTo({ top, behavior: 'smooth' })`, removing the class once scrolling finishes (`scrollend`).
   ```css
   /* src/styles/global.css */
   #about {
     content-visibility: visible !important;
     contain: style;
   }

   main section:not(#about) {
     content-visibility: auto;
     contain-intrinsic-size: auto 900px;
   }

   html.is-anchor-scrolling main section,
   html.is-anchor-scrolling footer {
     content-visibility: visible !important;
   }
   ```
2. **In `src/components/ui/PageIndexNav.astro` and `src/components/common/Header.astro`:**
   - Intercept clicks on same-page hash links (`a[href^="#"]` or `a[href*="/#"]` when on the home page):
     1. Add `document.documentElement.classList.add('is-anchor-scrolling')`.
     2. Force layout read of the target element (`target.getBoundingClientRect()`).
     3. Scroll smoothly to the exact target offset (`window.scrollTo({ top: targetTop - headerOffset, behavior: 'smooth' })`).
     4. Remove `is-anchor-scrolling` on `scrollend` (with a `setTimeout` fallback of `800ms`).

---

## TASK 6: Optimize Vite/Rollup Chunking & Preload Critical Assets

**Files:**

- `astro.config.mjs`
- `src/components/common/SEOHead.astro`
- `public/_headers`
- `public/llms.txt`

1. **In `astro.config.mjs`:**
   - Consolidate all shared client utilities, nanostores, and component scripts into a clean, flat bundle structure (`experimentalMinChunkSize: 20000`) so `network-dependency-tree-insight` has a maximum depth of 1 hop (`HTML -> core-client.js`) and completes in `< 600 ms`.
2. **In `src/components/common/SEOHead.astro`:**
   - Keep `<link rel="preload" href="/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin="anonymous" />` and `<link rel="preload" href="/fonts/GeistMono-Variable.woff2" as="font" type="font/woff2" crossorigin="anonymous" />`.
3. **In `public/llms.txt`:**
   - Ensure `public/llms.txt` contains standard Markdown links (`- [Title](https://arturonavax.dev/...): Description`) under H2 sections so Lighthouse 13.5's `llms-txt` audit scores `1` (100/100 in Agentic Browsing).
4. **In `public/_headers` and `cloudflare/worker.ts`:**
   - Ensure `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` and `Cross-Origin-Opener-Policy: same-origin` are present on all document responses, and `/_astro/*` + `/fonts/*` return `Cache-Control: public, max-age=31536000, immutable`.

---

## TASK 7: Verification & Acceptance Criteria

After applying all changes, run the following verification steps:

1. **Unit & Specification Tests:**
   Run `pnpm test` (Vitest) and update any test in `tests/odd-tasks.test.ts` or `tests/spec-*` that previously asserted the presence of `is:inline` or `#deferred-modals-template` so tests validate the new bundled module architecture and direct hidden modal portal.
2. **Production Build Inspection:**
   Run `pnpm build` and verify:
   - `dist/index.html` contains **only 1** `<script>` tag in `<head>` (the Zero-FOUC + Cloudflare JSD guard) and **0** `<script is:inline>` blocks in `<body>` (excluding `<script type="application/ld+json">`).
   - Uncompressed `dist/index.html` size is reduced by at least 80 KB.
   - `dist/_astro/` contains consolidated JS bundles without tiny `< 1 KB` waterfall chunks.
3. **Functional E2E Verification:**
   - Clicking Search (`#search-trigger`) or pressing `Cmd+K` immediately opens `UniversalSearchModal` on the very first attempt, filters results, and closes on `Escape`.
   - Pressing `?` immediately opens `ShortcutsModal`.
   - Clicking "Sponsor Coffee", "Online Judges", and "Contact" buttons opens their respective modals on the first click.
   - Switching language (`EN` <-> `ES`) updates 100% of the page including all `Header` navigation items, active states, and modal labels without requiring a hard refresh.
   - Clicking any section in `PageIndexNav` scrolls smoothly and lands on the exact section header with zero scroll jumping.
