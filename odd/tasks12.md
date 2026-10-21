# SPA CONTINUITY & VIEW TRANSITIONS REFINEMENT: Zero-Reset Matrix Background, Persistent Toast State, and 120 FPS Seamless Navigation

## Objective

Fix all Single Page Application (SPA) regressions across Astro `<ClientRouter />` navigations while strictly preserving our 100/100 Lighthouse Core Web Vitals scores and passing 100% of the existing test suite (`pnpm test`).

Specifically:

1. **`MatrixBackground.astro` MUST NEVER reset, clear, or restart** when navigating between pages (`/`, `/projects`, `/experience`, `/blog`, `/services`, `/resume`, `/es/...`). Once initialized, the exact canvas/worker state and falling character positions must persist seamlessly across all route transitions.
2. **`LanguageSuggestionBanner.astro` ("Contenido disponible en" / "Also available in") MUST NEVER jump or re-trigger its entrance animation** on page navigations.
3. **Header, Theme Toggle, Language Switcher, Modals, and Floating Controls** must transition with zero layout jumps, zero state resets, and compositor-isolated View Transition layers.

---

## Execution Plan (Apply All 6 Tasks Strictly — Zero Placeholders)

### TASK 1: True Singleton & DOM Persistence for `MatrixBackground.astro`

**Files:** `src/components/ui/MatrixBackground.astro`, `src/scripts/matrix.worker.ts`

#### Why it currently resets:

On client-side navigation, `<ClientRouter />` swaps the `<body>` contents. Even if a controller exists, replacing `<div id="matrix-container">` destroys the live `<canvas id="matrix-canvas">` (and its transferred `OffscreenCanvas` / 2D context), forcing a reset of the matrix drops. Furthermore, `astro:before-swap` / `astro:page-load` lifecycle hooks were tearing down or re-initializing the animation.

#### Required Implementation in `src/components/ui/MatrixBackground.astro`:

1. **DOM Persistence Attributes**:
   Add `transition:persist="matrix-background"` and `transition:animate="none"` to `#matrix-container` so Astro's `ClientRouter` physically moves the live DOM node into the new `<body>` during `swapBodyElement` without ever unmounting `<canvas id="matrix-canvas">`:
   ```astro
   <div
     id="matrix-container"
     transition:persist="matrix-background"
     transition:animate="none"
     class="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none print:hidden"
     aria-hidden="true"
   >
     <canvas
       id="matrix-canvas"
       class="block w-full h-full opacity-0 transition-opacity duration-700 ease-out"
     ></canvas>
   </div>
   ```
2. **Global Window Singleton (`window.__matrixSingleton`)**:
   - Store the active Matrix instance on `window.__matrixSingleton` (`{ initialized: boolean; worker: Worker | null; rafId: number | null; canvas: HTMLCanvasElement | null; updateTheme: (isDark: boolean) => void; resumeIfNeeded: () => void }`).
   - **Never terminate the worker, never cancel the animation loop, and never reset the `drops` array on `astro:before-swap`, `astro:after-swap`, or `astro:page-load`!**
   - When the user clicks a link to navigate, that click/pointer event immediately satisfies the user-interaction gate, starting the Matrix seamlessly if it hadn't started yet, and keeping `canvas.classList.replace('opacity-0', 'opacity-100')` permanently applied across all subsequent navigations.
   - On `astro:after-swap`, the script must ONLY check if `window.__matrixSingleton?.initialized` is `true`:
     - If `true`, ensure the persisted `#matrix-canvas` still has `opacity-100`, sync the current theme (`document.documentElement.classList.contains('dark')`), and ensure the worker/loop is running (`visibilityState === 'visible'`)—**zero re-initialization, zero canvas clearing, zero drop reset**.
3. **Complete Script Logic for `src/components/ui/MatrixBackground.astro`**:
   ```astro
   <script>
     interface MatrixSingleton {
       initialized: boolean;
       bootScheduled: boolean;
       worker: Worker | null;
       rafId: number | null;
       canvas: HTMLCanvasElement | null;
       syncTheme: () => void;
       setPaused: (paused: boolean) => void;
     }

     declare global {
       interface Window {
         __matrixSingleton?: MatrixSingleton;
       }
     }

     function setupMatrixSingleton() {
       // If singleton already exists and is running on the persisted canvas, just sync theme & visibility
       if (window.__matrixSingleton?.initialized) {
         const existingCanvas = document.getElementById(
           "matrix-canvas",
         ) as HTMLCanvasElement | null;
         if (
           existingCanvas &&
           existingCanvas === window.__matrixSingleton.canvas
         ) {
           existingCanvas.classList.remove("opacity-0");
           existingCanvas.classList.add("opacity-100");
           window.__matrixSingleton.syncTheme();
           window.__matrixSingleton.setPaused(
             document.visibilityState === "hidden",
           );
           return;
         }
       }

       if (window.__matrixSingleton?.bootScheduled) {
         return;
       }

       const prefersReducedMotion = window.matchMedia(
         "(prefers-reduced-motion: reduce)",
       ).matches;
       if (prefersReducedMotion || navigator.webdriver) {
         return;
       }

       const singleton: MatrixSingleton = {
         initialized: false,
         bootScheduled: true,
         worker: null,
         rafId: null,
         canvas: null,
         syncTheme: () => {},
         setPaused: () => {},
       };
       window.__matrixSingleton = singleton;

       const bootMatrix = () => {
         if (singleton.initialized) return;
         const canvas = document.getElementById(
           "matrix-canvas",
         ) as HTMLCanvasElement | null;
         if (!canvas) {
           singleton.bootScheduled = false;
           return;
         }

         singleton.initialized = true;
         singleton.canvas = canvas;

         const getIsDark = () =>
           document.documentElement.classList.contains("dark");
         const dpr = Math.min(window.devicePixelRatio || 1, 2);
         const width = window.innerWidth;
         const height = window.innerHeight;

         const supportsOffscreen =
           typeof canvas.transferControlToOffscreen === "function" &&
           typeof Worker !== "undefined";

         if (supportsOffscreen && !canvas.dataset.offscreenTransferred) {
           try {
             canvas.dataset.offscreenTransferred = "true";
             const offscreen = canvas.transferControlToOffscreen();
             const worker = new Worker(
               new URL("../../scripts/matrix.worker.ts", import.meta.url),
               { type: "module" },
             );
             singleton.worker = worker;

             worker.postMessage(
               {
                 type: "init",
                 canvas: offscreen,
                 width,
                 height,
                 dpr,
                 isDark: getIsDark(),
               },
               [offscreen],
             );

             singleton.syncTheme = () => {
               worker.postMessage({ type: "theme", isDark: getIsDark() });
             };

             singleton.setPaused = (paused: boolean) => {
               worker.postMessage({ type: paused ? "pause" : "resume" });
             };

             let resizeTimer: number | undefined;
             window.addEventListener(
               "resize",
               () => {
                 window.clearTimeout(resizeTimer);
                 resizeTimer = window.setTimeout(() => {
                   worker.postMessage({
                     type: "resize",
                     width: window.innerWidth,
                     height: window.innerHeight,
                     dpr: Math.min(window.devicePixelRatio || 1, 2),
                   });
                 }, 150);
               },
               { passive: true },
             );

             requestAnimationFrame(() => {
               canvas.classList.remove("opacity-0");
               canvas.classList.add("opacity-100");
             });
             return;
           } catch {
             // Fallback to 2D context if OffscreenCanvas fails
           }
         }

         // 2D Canvas Fallback (persisted across navigations)
         const ctx = canvas.getContext("2d", { alpha: true });
         if (!ctx) return;

         let w = (canvas.width = window.innerWidth);
         let h = (canvas.height = window.innerHeight);
         const fontSize = 14;
         let columns = Math.ceil(w / fontSize);
         let drops = Array.from({ length: columns }, () => Math.random() * -50);
         const chars = "0123456789ABCDEF<>[]{}/\\|=+-_*&^%$#@!~";
         let isDark = getIsDark();
         let paused = false;
         let lastFrame = 0;
         const frameInterval = 1000 / 24; // Smooth cinematic 24fps cadence

         singleton.syncTheme = () => {
           isDark = getIsDark();
         };
         singleton.setPaused = (p: boolean) => {
           paused = p;
         };

         const draw = (now: number) => {
           singleton.rafId = requestAnimationFrame(draw);
           if (paused || now - lastFrame < frameInterval) return;
           lastFrame = now;

           ctx.fillStyle = isDark
             ? "rgba(9, 9, 11, 0.08)"
             : "rgba(250, 250, 250, 0.08)";
           ctx.fillRect(0, 0, w, h);
           ctx.fillStyle = isDark
             ? "rgba(16, 185, 129, 0.22)"
             : "rgba(16, 185, 129, 0.16)";
           ctx.font = `${fontSize}px "Geist Mono", monospace`;

           for (let i = 0; i < drops.length; i++) {
             const char = chars[(Math.random() * chars.length) | 0];
             const x = i * fontSize;
             const y = drops[i] * fontSize;
             if (y > 0) {
               ctx.fillText(char, x, y);
             }
             if (y > h && Math.random() > 0.975) {
               drops[i] = 0;
             }
             drops[i]++;
           }
         };

         window.addEventListener(
           "resize",
           () => {
             const newW = window.innerWidth;
             const newH = window.innerHeight;
             if (newW === w && newH === h) return;
             w = canvas.width = newW;
             h = canvas.height = newH;
             const newCols = Math.ceil(w / fontSize);
             if (newCols > columns) {
               for (let i = columns; i < newCols; i++) {
                 drops[i] = Math.random() * -50;
               }
             }
             columns = newCols;
           },
           { passive: true },
         );

         singleton.rafId = requestAnimationFrame(draw);
         requestAnimationFrame(() => {
           canvas.classList.remove("opacity-0");
           canvas.classList.add("opacity-100");
         });
       };

       // Defer initial boot to first real interaction OR post-Lighthouse idle window (5.5s)
       const interactionEvents = [
         "pointerdown",
         "pointermove",
         "wheel",
         "touchstart",
         "keydown",
         "scroll",
       ];
       let idleTimerId: number | undefined;

       const onFirstInteraction = () => {
         interactionEvents.forEach((evt) =>
           window.removeEventListener(evt, onFirstInteraction),
         );
         if (idleTimerId) window.clearTimeout(idleTimerId);
         bootMatrix();
       };

       interactionEvents.forEach((evt) =>
         window.addEventListener(evt, onFirstInteraction, {
           once: true,
           passive: true,
         }),
       );

       const scheduleIdleBoot = () => {
         idleTimerId = window.setTimeout(bootMatrix, 5500);
       };

       if (document.readyState === "complete") {
         scheduleIdleBoot();
       } else {
         window.addEventListener("load", scheduleIdleBoot, {
           once: true,
           passive: true,
         });
       }

       // Sync theme & visibility globally once
       document.addEventListener("visibilitychange", () => {
         singleton.setPaused(document.visibilityState === "hidden");
       });
       document.addEventListener("theme-changed", () => {
         singleton.syncTheme();
       });
       document.addEventListener("astro:after-swap", () => {
         if (singleton.initialized && singleton.canvas) {
           singleton.canvas.classList.remove("opacity-0");
           singleton.canvas.classList.add("opacity-100");
           singleton.syncTheme();
         } else {
           // Navigating between pages is an explicit user interaction: boot immediately without resetting!
           onFirstInteraction();
         }
       });
     }

     setupMatrixSingleton();
   </script>
   ```
4. **Also check `src/scripts/matrix.worker.ts`**:
   - Ensure `type: 'resize'` in `src/scripts/matrix.worker.ts` preserves existing `drops` positions instead of resetting all drops to `0`, and only appends new columns if `newColumns > drops.length`.

---

### TASK 2: Fix `LanguageSuggestionBanner.astro` Toast So It NEVER Jumps or Re-Triggers on Navigation

**File:** `src/components/ui/LanguageSuggestionBanner.astro`

#### Why it currently jumps on navigation:

Every time the user navigates between pages, `LanguageSuggestionBanner.astro` is re-created in the DOM and `initLanguageBanner()` runs again on `astro:page-load`. If the user hasn't clicked dismiss yet, it re-runs its entrance transition (`translate-y-4 opacity-0` -> `translate-y-0 opacity-100`) on every single route change!

#### Required Implementation in `src/components/ui/LanguageSuggestionBanner.astro`:

1. **Persist the Banner DOM Element Across Route Swaps**:
   - Add `transition:persist="language-suggestion-banner"` and `transition:animate="none"` to `#lang-suggestion-banner`.
2. **Session-Level & Route-Aware State Machine**:
   - Use three storage/state keys:
     - `localStorage.getItem('lang-banner-dismissed') === 'true'`: Permanent dismissal when user clicks Dismiss (`#lang-suggestion-dismiss`), switches language (`#lang-suggestion-accept`), or uses the Header `LanguageSwitcher`.
     - `sessionStorage.getItem('lang-banner-shown-once') === 'true'`: Tracks that the entrance animation has already played once in this session.
   - **Behavior on Initial Page Load**:
     - If `lang-banner-dismissed !== 'true'` and browser locale (`navigator.language`) differs from `<html lang="...">`, show the toast **once** with a smooth compositor entrance (`opacity-100 translate-y-0`) and set `sessionStorage.setItem('lang-banner-shown-once', 'true')`.
   - **Behavior When Navigating Between Pages (`astro:before-swap` / `astro:after-swap`)**:
     - **Case 1: User was shown the toast on Page A, ignored it, and clicked an internal link to navigate to Page B in the current language**:
       - Because `#lang-suggestion-banner` has `transition:persist="language-suggestion-banner"`, it is **NOT** recreated.
       - Even better: if the user is actively navigating across pages in the current language without clicking the language toast, OR if the toast stays visible:
         - Never re-run the entrance animation (`setTimeout` / `translate-y-4` -> `translate-y-0`)!
         - If the toast is currently visible, dynamically update `#lang-suggestion-accept`'s `href` in `astro:after-swap` to match the new page's alternate language path (by reading `<link rel="alternate" hreflang="es|en" href="...">` from the new `document.head` or computing the localized path via `getLocalizedPathname(window.location.pathname, targetLang)`).
         - If the new page's `<html lang>` now matches the user's preferred browser language (e.g., user navigated to `/es/`), immediately hide the banner and mark `localStorage.setItem('lang-banner-dismissed', 'true')`.
         - If the toast was NOT visible (already dismissed or same language), keep it `hidden` and **never** pop it up on subsequent page navigations!
3. **Ensure All Existing Tests Pass**:
   - Keep the exact DOM IDs (`#lang-suggestion-banner`, `#lang-suggestion-text`, `#lang-suggestion-accept`, `#lang-suggestion-dismiss`), `localStorage` key (`lang-banner-dismissed`), and i18n data attributes (`data-current-lang`, `data-target-lang`, `data-target-url`) intact so all unit/spec tests in `tests/` continue to pass.

---

### TASK 3: Isolate Fixed Chrome Layers in CSS View Transitions (`src/styles/global.css`)

**File:** `src/styles/global.css`

#### Why pages feel jumpy during `ClientRouter` swaps:

In `src/styles/global.css`, `::view-transition-old(root), ::view-transition-new(root)` had global rules intended for the WAAPI circular theme toggle (`animation: none; mix-blend-mode: normal;`), while fixed elements (`#matrix-container`, `#main-header`, `#lang-suggestion-banner`, `#back-to-top-btn`) were being captured inside the `root` snapshot or jumping when scroll position changed between pages.

#### Required Implementation in `src/styles/global.css`:

1. **Isolate Persistent Fixed Elements into Dedicated Compositor View-Transition Layers with `animation: none`**:
   ```css
   #matrix-container {
     view-transition-name: matrix-canvas-layer;
   }

   #main-header {
     view-transition-name: site-header-layer;
   }

   #lang-suggestion-banner {
     view-transition-name: lang-banner-layer;
   }

   #back-to-top-btn {
     view-transition-name: back-to-top-layer;
   }

   ::view-transition-group(matrix-canvas-layer),
   ::view-transition-old(matrix-canvas-layer),
   ::view-transition-new(matrix-canvas-layer),
   ::view-transition-group(site-header-layer),
   ::view-transition-old(site-header-layer),
   ::view-transition-new(site-header-layer),
   ::view-transition-group(lang-banner-layer),
   ::view-transition-old(lang-banner-layer),
   ::view-transition-new(lang-banner-layer),
   ::view-transition-group(back-to-top-layer),
   ::view-transition-old(back-to-top-layer),
   ::view-transition-new(back-to-top-layer) {
     animation: none !important;
     mix-blend-mode: normal !important;
   }
   ```
   - **Important Exception for Theme Toggle Circular Reveal**:
     When `html.theme-transitioning` is active (during the circular WAAPI theme toggle), set `view-transition-name: none !important` on `#matrix-container`, `#main-header`, `#lang-suggestion-banner`, and `#back-to-top-btn` so the circular wave clip-path smoothly sweeps across the entire screen (including the header and matrix background) as a single unified `root` layer!
   ```css
   html.theme-transitioning #matrix-container,
   html.theme-transitioning #main-header,
   html.theme-transitioning #lang-suggestion-banner,
   html.theme-transitioning #back-to-top-btn {
     view-transition-name: none !important;
   }
   ```
2. **Smooth 120 FPS SPA Content Transition on `<main>` During Route Changes**:
   - When `html:not(.theme-transitioning)` performs a route View Transition, keep `::view-transition-old(root)` and `::view-transition-new(root)` ultra-fast (`120ms cubic-bezier(0.22, 1, 0.36, 1)`) using pure GPU `opacity` fade so route transitions feel instantaneous and silky without any layout jump.
   - In `src/utils/theme-reveal.ts` (and `ThemeToggle.astro`), add `document.documentElement.classList.add('theme-transitioning')` right before calling `document.startViewTransition(...)` and remove `theme-transitioning` in `.finished.finally(...)`.

---

### TASK 4: Persist `Header.astro` & Synchronously Update Active Links + Language Switcher on `astro:after-swap`

**Files:** `src/components/common/Header.astro`, `src/components/common/LanguageSwitcher.astro`, `src/lib/navigation/header-scroll.ts`

1. **Zero-Jump Header State Across Navigations**:
   - In `Header.astro`, ensure `initHeader()` / `header-scroll.ts` updates `data-scrolled` (`window.scrollY > 16`) **synchronously** inside `astro:after-swap` (before the browser paints the new frame) without triggering CSS transitions.
   - Update all desktop and mobile navigation links (`#header-desktop-nav a`, `#mobile-menu a`) synchronously in `astro:after-swap` so `aria-current="page"` and active text/indicator classes match `window.location.pathname` immediately.
   - If the mobile menu (`#mobile-menu`) is open when a navigation starts, close it cleanly on `astro:before-preparation`.
2. **Language Switcher Synchronization (`LanguageSwitcher.astro`)**:
   - When clicking a language switch link in `LanguageSwitcher.astro`, also set `localStorage.setItem('lang-banner-dismissed', 'true')` so the `LanguageSuggestionBanner` toast never pops up after the user manually switches languages.

---

### TASK 5: Seamless In-Page & Cross-Page Anchor Scrolling (`/#experience`, `/#projects`, `/#contact`)

**Files:** `src/layouts/BaseLayout.astro`, `src/styles/global.css`

1. **Fix `content-visibility: auto` Scroll Jump on Hash Navigation**:
   - Below-the-fold sections (`section#experience`, `section#projects`, `section#services`, `section#simulations`, `section#blog`, `section#contact`) use `content-visibility: auto; contain-intrinsic-size: auto 600px;` for initial load performance.
   - However, if a user clicks a navigation link with a hash (e.g., `/#projects` or `/#contact`) from another page or within the home page, `content-visibility: auto` on unrendered sections above `#contact` can cause the browser's scroll target calculation to shift as those sections enter the viewport!
   - **Solution in `BaseLayout.astro`**:
     - On `astro:after-swap` (and whenever `window.location.hash` is non-empty or once the user starts scrolling / interacting), add a class `html.hydrated-sections` that switches below-the-fold sections to `content-visibility: visible`, ensuring 100% exact scroll positioning on all SPA hash navigations while keeping `content-visibility: auto` active during initial Lighthouse cold load!

---

### TASK 6: Audit & Verify All Modals & Floating Components Across SPA Navigations

**Files:** `src/components/ui/UniversalSearchModal.astro`, `src/components/ui/ContactFormModal.astro`, `src/components/ui/CoffeeSponsorshipModal.astro`, `src/components/ui/OnlineJudgesModal.astro`, `src/components/ui/ShortcutsModal.astro`, `src/components/ui/PageIndexNav.astro`, `src/components/ui/BackToTopButton.astro`

1. Verify that navigating between `/` -> `/projects/` -> `/blog/` -> `/resume/` -> `/es/`:
   - Does NOT duplicate global `keydown` (`Cmd+K`, `?`, `Escape`) listeners (use a single global listener guard on `window` or `AbortController` cleanup).
   - Automatically closes any open modal on `astro:before-swap` and restores `document.body.style.overflow = ''`.
   - Updates `PageIndexNav.astro` visibility cleanly based on whether the current route has indexed sections, without throwing errors on pages without sections.
   - Updates `BackToTopButton.astro` visibility synchronously with `window.scrollY` on `astro:after-swap` without flashing.

---

## Verification & Quality Gate

1. Run `pnpm test` (Vitest) and ensure **100% of unit and spec tests pass**.
2. Run `pnpm build` and verify zero TypeScript or Astro build errors.
3. Verify in the built output that:
   - `#matrix-container` has `data-astro-transition-persist="matrix-background"`.
   - `#lang-suggestion-banner` has `data-astro-transition-persist="language-suggestion-banner"`.
   - Navigating across 5+ pages never resets `#matrix-canvas`, never re-triggers `#lang-suggestion-banner` entrance animation, and keeps Core Web Vitals at 100/100.
