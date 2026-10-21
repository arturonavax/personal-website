# Definitive Agent Execution Prompt: 120 FPS SPA Continuity, Zero-Reset Matrix Singleton, Persistent HUD & Toast State Machine, and 100/100 Core Web Vitals

## Role & Architectural Mandate

You are a **Principal Frontend & Edge Performance Architect (+15y)** specializing in **Astro (v5/v6 `<ClientRouter />`), Tailwind CSS v4, Cloudflare Workers/Pages Edge Infrastructure, Web Workers (`OffscreenCanvas`), CSS View Transitions Level 1, and 100/100 Core Web Vitals (`LCP < 1.0s`, `CLS = 0.000`, `INP < 40ms`, `TBT = 0ms`)**.

Your objective is to permanently fix all Single Page Application (SPA) continuity regressions across route transitions (`/`, `/projects/`, `/experience/`, `/experience/[slug]/`, `/blog/`, `/services/`, `/case-studies/`, `/resume/`, `/tools/resume-maker/`, and `/es/...`) while **preserving 100% of existing functionality, 100/100 Lighthouse scores, and 100% of the automated test suite (`bun test` / `pnpm test` and `scripts/audit-codebase.ts`)**.

### Strict Execution Rules

1. **Zero Placeholders**: Every code block in this specification is complete and production-ready. Never use `// ...`, `/* existing code */`, or partial stubs.
2. **Compositor-Only Motion**: Only animate `transform`, `opacity`, or `filter`. Never use `transition-all` on persistent HUD or toast elements, and never use layout-inducing transitions (`transition-[height]`, `top`, `left`, `width`).
3. **Strict Test-Suite Contract Preservation**:
   - `src/components/ui/LanguageSuggestionBanner.astro` **MUST NEVER** contain the substring `"localStorage"` anywhere in the file (not even inside HTML/JS comments), because `tests/spec-007/spec-007.test.ts` asserts `expect(bannerSource).not.toContain("localStorage")`.
   - Preserve exact `transition:persist` identifiers required by `tests/odd-tasks.test.ts` and `tests/spec-007/spec-007.test.ts`:
     - `transition:persist="matrix-background"` on `MatrixBackground`
     - `transition:persist="language-banner"` on `LanguageSuggestionBanner`
     - `transition:persist="page-index-nav"` on `PageIndexNav` (`#page-index-nav-shell`)
     - `transition:persist="backtotop"` on `<BackToTopButton>` in `BaseLayout.astro` and `transition:persist="btt"` on `#back-to-top-btn` in `BackToTopButton.astro`
     - `transition:persist="search-modal"`, `transition:persist="shortcuts-modal"`, `transition:persist="coffee-modal"`, `transition:persist="judges-modal"`, `transition:persist="contact-modal"`
   - Preserve exact CSS `view-transition-name` identifiers in `src/styles/global.css`: `site-header`, `page-index-nav`, `lang-suggestion-banner`, `back-to-top`, `matrix-background`, `matrix-canvas-background`, and `spa-main-content`.
   - Preserve the exact class string on `<aside id="floating-actions-stack">` in `src/layouts/BaseLayout.astro`:
     `class="fixed bottom-5 right-5 z-40 flex flex-col-reverse items-end gap-2.5 pointer-events-none select-none"` (asserted verbatim in `tests/spec-006/spec-006.test.ts`).

---

## Root-Cause Forensic Matrix (Why Previous Fixes Failed)

| #      | Symptom Observed in Production (`arturonavax.dev`)                                                                                                       | True Technical Root Cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Surgical Fix in This Specification                                                                                                                                                                                                                                                                                                                                                                  |
| :----- | :------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | **Matrix background visually flashes/resets opacity & glyphs for 130ms on every route navigation**                                                       | In `src/styles/global.css`, `::view-transition-old(matrix-background)` has `animation: none !important` **without** `display: none !important`. During the 130ms View Transition, the browser renders **both** the frozen old bitmap snapshot (`opacity: 0.15`) AND the live new canvas (`opacity: 0.15`) stacked on top of each other (`~0.28` combined opacity with frozen + moving glyphs), then snaps at `t=130ms`.                                                                     | Add `display: none !important; opacity: 0 !important;` to `::view-transition-old(...)` for `matrix-background`, `matrix-canvas-background`, `site-header`, `page-index-nav`, `lang-suggestion-banner`, `back-to-top`, `floating-actions-stack`, and `page-navigation-beacon` whenever `html:not(.theme-transitioning)` is active.                                                                   |
| **2**  | **Matrix background ignores `ThemeToggle` clicks until the next page navigation, or fades sluggishly over 1.5s**                                         | `ThemeToggle.astro` dispatches `CustomEvent("theme-changed")` on `window`, whereas `MatrixBackground.astro` listens on `document` (`window.dispatchEvent` does not bubble to `document`). Furthermore, `matrix.worker.ts` only paints a `0.12–0.16` alpha rectangle at 22 FPS on `type: "theme"`, taking ~35 frames to clear the old theme's canvas backdrop.                                                                                                                               | Listen for `"theme-changed"` on both `window` and `document`. When `type: "theme"` changes `isLight`, immediately flood-fill an `0.88` alpha backdrop pass in the new theme color and render one immediate frame while keeping `drops` and `speeds` untouched. Unify 2D fallback palette with the worker's gold/garnet tokens.                                                                      |
| **3**  | **Theme resets from Light Mode back to Dark Mode during SPA route navigations**                                                                          | Static HTML pages have `<html data-theme="dark" class="dark">` hardcoded. `ThemeToggle.astro` re-runs `applyTheme(current)` on both `astro:after-swap` and `astro:page-load` without an in-memory session authority (`window.__currentTheme`) or `sessionStorage` backup when `localStorage` is partitioned or slow.                                                                                                                                                                        | Introduce `window.__currentTheme` synced with `localStorage` and `sessionStorage` (`try/catch` guarded). Read `window.__currentTheme` first in `BaseLayout.astro`'s `applyTheme(ev.newDocument)` during `astro:before-swap`. In `ThemeToggle.astro`, only sync button icons (`syncIcons`) on `astro:after-swap` / `astro:page-load`.                                                                |
| **4**  | **`#page-navigation-beacon` ("Fetching..." / "Cargando..." toast) flashes on fast/prefetched navigations**                                               | `DEBOUNCE_SHOW_MS = 120` is shorter than the `130ms` `<main>` View Transition, and `hideBeacon()` is only called on `astro:page-load` (after the transition finishes) instead of `astro:before-swap` / `astro:after-swap` (when network fetching is already done).                                                                                                                                                                                                                          | Call `hideBeacon()` on `astro:before-swap`, `astro:after-swap`, and `astro:page-load`. Increase `DEBOUNCE_SHOW_MS` to `180ms` and isolate `#page-navigation-beacon` in its own View Transition layer.                                                                                                                                                                                               |
| **5**  | **Floating HUD stack (`PageIndexNav`, `BackToTopButton`, `ShortcutsModal`) jumps 52px upward on every route change when the language banner is visible** | `<aside id="floating-actions-stack">` in `BaseLayout.astro` lacks `transition:persist`. On every route swap, the `<aside>` is replaced with a fresh node lacking `.elevated-for-toast`, and `initLangSuggestion()` re-adds `.elevated-for-toast` post-swap, triggering a `300ms` CSS `transform` jump. Also, `ShortcutsModal.astro` conditionally omits `<shortcuts-modal>` on non-home pages (`hasShortcuts = isHomePage && ...`), breaking `transition:persist="shortcuts-modal"`.        | Add `transition:persist="floating-actions-stack"` to `<aside id="floating-actions-stack">`. Always render `<shortcuts-modal>` on all pages so its persistence island is never destroyed, toggling `#open-shortcuts-btn` visibility per route synchronously in `astro:after-swap`.                                                                                                                   |
| **6**  | **`LanguageSuggestionBanner` falsely hides on cross-locale navigation, uses absolute prod URLs in `href`, or is pre-empted by root auto-redirect**       | 1) Line 155 checks stale `banner.getAttribute("data-target-locale")` before updating it for the new route. 2) `<link rel="alternate">` returns absolute `[https://arturonavax.dev/](https://arturonavax.dev/)...` URLs instead of relative paths. 3) `BaseLayout.astro` auto-redirects `/` to `/es/` when `!savedLocale` and overwrites `preferred_locale` on every normal navigation. 4) `LanguageSwitcher.astro` replaces `#lang-suggestion-banner` in `swapDOM()`, breaking persistence. | Remove the stale `currentLocale === banner.getAttribute("data-target-locale")` guard; normalize `counterpartUrl` to a same-origin relative path (`pathname + search + hash`); remove the unprompted `!savedLocale` auto-redirect on `/` in `BaseLayout.astro`; preserve `#lang-suggestion-banner` in `LanguageSwitcher.astro` and fix modal dialog IDs (`#search-dialog`, `#online-judges-dialog`). |
| **7**  | **`BackToTopButton` animates its 300ms fade-out on Page B when navigating from a scrolled position on Page A**                                           | `Header.astro` sets `sessionStorage.setItem("nav_reset_scroll", "1")`, but `BackToTopButton` runs `updateBackToTopVisibility(false)` on `astro:after-swap` while `window.scrollY` is still at Page A's scroll offset, and then animates out when scroll resets to `0`.                                                                                                                                                                                                                      | Consume `nav_reset_scroll === "1"` synchronously at the start of `astro:after-swap` in `BaseLayout.astro` (`window.scrollTo({ top: 0, left: 0, behavior: "instant" })`) and treat `nav_reset_scroll === "1"` as `scrollY = 0` inside `BackToTopButton.astro`.                                                                                                                                       |
| **8**  | **`PageIndexNav` rebuilds its TOC DOM twice per navigation (once pre-paint, once 130ms later with transitions enabled)**                                 | `PageIndexNav.astro` calls `setupPageIndex(true)` on `astro:after-swap` and then calls `setupPageIndex(false)` again on `astro:page-load`, causing a second TOC DOM rebuild and animated `top` shift 130ms after navigation.                                                                                                                                                                                                                                                                | Perform the full TOC rebuild once in `astro:after-swap` (`setupPageIndex(true)`), and in `astro:page-load` only run lightweight post-layout alignment (`alignDesktopIndex()` and `syncResponsiveMode()`) if already initialized for the current path.                                                                                                                                               |
| **9**  | **`#email-copy-toast` in `ContactSection.astro` is trapped inside `content-visibility: auto` containment and popovers can linger across navigations**    | `<section id="contact">` has `content-visibility: auto` (`contain: layout style paint`), which traps `position: fixed` descendants like `#email-copy-toast` unless promoted to the browser Top Layer (`popover="manual"`).                                                                                                                                                                                                                                                                  | Add `popover="manual"` Top Layer support to `#email-copy-toast` in `ContactSection.astro` and close all open copy toasts/popovers cleanly in `BaseLayout.astro` on `astro:before-swap`.                                                                                                                                                                                                             |
| **10** | **`src/pages/[...lang]/tools/resume-maker.astro` uses `transition-[height]`**                                                                            | Lines 156 and 199 use `transition-[height] duration-200`, violating strict compositor-only motion (`transform`, `opacity`, `filter`).                                                                                                                                                                                                                                                                                                                                                       | Replace `transition-[height] duration-200` with `transition-colors duration-200` on both `<textarea>` elements.                                                                                                                                                                                                                                                                                     |

---

## TASK 1: True OffscreenCanvas/2D Singleton & Instant Theme Sync (`MatrixBackground.astro` & `matrix.worker.ts`)

### 1.1 Update `src/scripts/matrix.worker.ts`

Replace `src/scripts/matrix.worker.ts` with the following complete implementation. It preserves all existing drop coordinates and speeds across route transitions and resizes, and adds an immediate high-opacity backdrop transition frame when `type: "theme"` changes `isLight` so theme toggles update the canvas surface instantaneously without resetting a single falling character:

```ts
/// Matrix rain renderer running entirely off the main thread (OffscreenCanvas + dedicated Worker).
/// Main thread only forwards: init (transferred canvas), resize, theme and visibility.

interface InitMessage {
  type: "init";
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  dpr: number;
  isLight: boolean;
}

interface ResizeMessage {
  type: "resize";
  width: number;
  height: number;
  dpr: number;
}

interface ThemeMessage {
  type: "theme";
  isLight: boolean;
}

interface VisibilityMessage {
  type: "visibility";
  hidden: boolean;
}

interface PauseMessage {
  type: "pause";
}

interface ResumeMessage {
  type: "resume";
}

type InboundMessage =
  | InitMessage
  | ResizeMessage
  | ThemeMessage
  | VisibilityMessage
  | PauseMessage
  | ResumeMessage;

interface WorkerScope {
  onmessage: ((event: MessageEvent<InboundMessage>) => void) | null;
  requestAnimationFrame: (cb: (now: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
}

const scope = self as unknown as WorkerScope;

const FONT_SIZE = 14;
const FRAME_INTERVAL = 1000 / 22; // ~22 FPS throttling for minimal texture transfer overhead
const CHARACTERS =
  "01010123456789ABCDEFλ§µΔΨΩθπσ0x::->/*!=&|^GoRustSIMDAVX2ptrchnsync".split(
    "",
  );

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let width = 0;
let height = 0;
let currentDpr = 1;
let isLight = false;
let hidden = false;
let rafId: number | null = null;
let drops: number[] = [];
let speeds: number[] = [];
let lastRenderTime = 0;

function layout(w: number, h: number, dpr: number): void {
  if (!canvas || !ctx) return;
  const clampedDpr = Math.min(dpr || 1, 1.25);
  const targetW = Math.round(w * clampedDpr);
  const targetH = Math.round(h * clampedDpr);
  const dprChanged = Math.abs(currentDpr - clampedDpr) > 0.001;

  // CRITICAL: Setting canvas.width clears the entire bitmap buffer.
  // NEVER re-assign or clear canvas buffer unless dimensions changed by > 50px or zoom/DPR shifted,
  // AND never re-assign if canvas width/height already match target dimensions.
  if (
    (canvas.width !== targetW || canvas.height !== targetH) &&
    (canvas.width === 0 ||
      canvas.height === 0 ||
      Math.abs(canvas.width - targetW) > 50 ||
      Math.abs(canvas.height - targetH) > 50 ||
      dprChanged)
  ) {
    canvas.width = targetW;
    canvas.height = targetH;
    currentDpr = clampedDpr;
    width = w;
    height = h;
    ctx.resetTransform();
    ctx.scale(clampedDpr, clampedDpr);
  } else {
    width = w;
    height = h;
    currentDpr = clampedDpr;
  }

  const columns = Math.floor(w / FONT_SIZE);
  if (columns !== drops.length) {
    const next = new Array<number>(columns);
    const nextSpeeds = new Array<number>(columns);
    for (let i = 0; i < columns; i++) {
      // Randomized stream entrances staggered above the viewport for natural entropy,
      // preserving falling drops to avoid resetting the animation stream during navigations
      next[i] =
        i < drops.length ? (drops[i] ?? 0) : -Math.floor(Math.random() * 24);
      nextSpeeds[i] =
        i < speeds.length ? (speeds[i] ?? 1) : 0.65 + Math.random() * 0.7;
    }
    drops = next;
    speeds = nextSpeeds;
  }
}

function scheduleNextFrame(): void {
  if (hidden || rafId !== null) return;
  rafId = scope.requestAnimationFrame(render);
}

function stopFrameLoop(): void {
  if (rafId !== null && typeof scope.cancelAnimationFrame === "function") {
    scope.cancelAnimationFrame(rafId);
  }
  rafId = null;
}

function drawGlyphStreams(advanceDrops: boolean): void {
  if (!ctx) return;
  ctx.font = `${FONT_SIZE}px ui-monospace, monospace`;

  for (let i = 0; i < drops.length; i++) {
    const dropY = drops[i] ?? 0;
    const speed = speeds[i] ?? 1;
    const char =
      CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)] || "0";
    const x = i * FONT_SIZE;
    const y = Math.floor(dropY) * FONT_SIZE;

    if (dropY > 0) {
      // Occasional glowing head glyph for organic matrix rain depth
      const isLead = Math.random() < 0.12;
      if (isLead) {
        ctx.fillStyle = isLight ? "#8B1E17" : "#FEF08A";
      } else {
        ctx.fillStyle = isLight ? "#7A1C16" : "#D48B38";
      }
      ctx.fillText(char, x, y);
    }

    if (advanceDrops) {
      // Organic stream reset with variable delays and regenerated speeds
      if (y > height + 60) {
        drops[i] = -Math.floor(Math.random() * 45 + 5);
        speeds[i] = 0.65 + Math.random() * 0.7;
      } else {
        drops[i] = dropY + speed;
      }
    }
  }
}

function flushThemeBackdrop(): void {
  if (!ctx || width <= 0 || height <= 0) return;
  ctx.fillStyle = isLight
    ? "rgba(244, 246, 248, 0.88)"
    : "rgba(26, 2, 5, 0.88)";
  ctx.fillRect(0, 0, width, height);
  drawGlyphStreams(false);
}

function render(now: number): void {
  rafId = null;
  if (hidden) return;
  scheduleNextFrame();
  if (!ctx || now - lastRenderTime < FRAME_INTERVAL) return;
  lastRenderTime = now;

  ctx.fillStyle = isLight
    ? "rgba(244, 246, 248, 0.16)"
    : "rgba(26, 2, 5, 0.12)";
  ctx.fillRect(0, 0, width, height);
  drawGlyphStreams(true);
}

scope.onmessage = (event: MessageEvent<InboundMessage>): void => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      canvas = msg.canvas;
      ctx = canvas.getContext("2d");
      isLight = msg.isLight;
      layout(msg.width, msg.height, msg.dpr);
      scheduleNextFrame();
      break;
    case "resize":
      layout(msg.width, msg.height, msg.dpr);
      scheduleNextFrame();
      break;
    case "theme":
      if (isLight !== msg.isLight) {
        isLight = msg.isLight;
        flushThemeBackdrop();
      }
      scheduleNextFrame();
      break;
    case "visibility":
      hidden = msg.hidden;
      if (hidden) {
        stopFrameLoop();
      } else {
        scheduleNextFrame();
      }
      break;
    case "pause":
      hidden = true;
      stopFrameLoop();
      break;
    case "resume":
      hidden = false;
      scheduleNextFrame();
      break;
  }
};
```

### 1.2 Update `src/components/ui/MatrixBackground.astro`

Replace `src/components/ui/MatrixBackground.astro` with the following implementation. It preserves all test contracts (`transition:persist="matrix-background"`, `matrix-static-backdrop`, `navigator.webdriver === true`, `-Math.floor(Math.random() * 24)`, `Math.abs(currentWidth - this.lastWidth) > 50`, `Math.abs(currentHeight - this.lastHeight) > 50`, `__matrixDrops`, `function resumeMatrixOnNav`, `state.worker.postMessage({ type: "resume" })`), listens to `"theme-changed"` on both `window` and `document`, and ensures the 2D fallback uses the exact same palette and instant theme backdrop flush as the worker:

```astro
---
// Subtle Matrix / Hexadecimal Code Stream Background (Zero-Dependency Offscreen Canvas Worker + Fallback)
export const ENABLE_MATRIX_BACKGROUND = true;

interface Props {
  density?: number;
  opacity?: number;
  enabled?: boolean;
}

const {
  density = 0.08,
  opacity = 0.15,
  enabled = ENABLE_MATRIX_BACKGROUND,
} = Astro.props;
---

{enabled && (
  <div
    id="matrix-container"
    data-density={density}
    data-opacity={opacity}
    transition:persist="matrix-background"
    transition:animate="none"
    class="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none print:hidden opacity-20 dark:opacity-15 hidden md:block"
    aria-hidden="true"
  >
    <div class="matrix-static-backdrop absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(212,139,56,0.06),rgba(10,2,3,0))]"></div>
    <canvas
      id="matrix-canvas"
      class="block w-full h-full opacity-0 transition-opacity duration-700 ease-out"
    ></canvas>
  </div>
)}

<script>
  interface MatrixSingleton {
    initialized: boolean;
    bootScheduled: boolean;
    worker: Worker | null;
    rafId: number | null;
    canvas: HTMLCanvasElement | null;
    lastIsDark: boolean | null;
    syncTheme: () => void;
    setPaused: (paused: boolean) => void;
  }

  declare global {
    interface Window {
      __matrixSingleton?: MatrixSingleton;
      __matrixState?: any;
      __matrixDrops?: number[];
      __matrixCanvas?: HTMLCanvasElement | null;
      __matrixListenersBound?: boolean;
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
        existingCanvas.classList.remove(
          "opacity-0",
          "transition-opacity",
          "duration-700",
        );
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

    const prefersReducedMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion || navigator.webdriver === true) {
      return;
    }

    const singleton: MatrixSingleton = {
      initialized: false,
      bootScheduled: true,
      worker: null,
      rafId: null,
      canvas: null,
      lastIsDark: null,
      syncTheme: () => {},
      setPaused: () => {},
    };
    window.__matrixSingleton = singleton;
    window.__matrixState = {
      worker: null,
      drops: window.__matrixDrops || [],
      animationFrameId: null,
    };

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
      window.__matrixCanvas = canvas;

      const getIsDark = () =>
        document.documentElement.getAttribute("data-theme") === "dark" ||
        (document.documentElement.getAttribute("data-theme") !== "light" &&
          document.documentElement.classList.contains("dark"));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      singleton.lastIsDark = getIsDark();

      const resizeManager = {
        lastWidth: window.innerWidth,
        lastHeight: window.innerHeight,
        shouldResize(currentWidth: number, currentHeight: number): boolean {
          if (
            Math.abs(currentWidth - this.lastWidth) > 50 ||
            Math.abs(currentHeight - this.lastHeight) > 50
          ) {
            this.lastWidth = currentWidth;
            this.lastHeight = currentHeight;
            return true;
          }
          return false;
        },
      };

      const markCanvasVisible = () => {
        requestAnimationFrame(() => {
          canvas.classList.remove("opacity-0");
          canvas.classList.add("opacity-100");
          window.setTimeout(() => {
            canvas.classList.remove("transition-opacity", "duration-700");
          }, 750);
        });
      };

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
          if (window.__matrixState) window.__matrixState.worker = worker;

          worker.postMessage(
            {
              type: "init",
              canvas: offscreen,
              width: resizeManager.lastWidth,
              height: resizeManager.lastHeight,
              dpr,
              isLight: !singleton.lastIsDark,
            },
            [offscreen],
          );

          singleton.syncTheme = () => {
            const currentIsDark = getIsDark();
            if (singleton.lastIsDark !== currentIsDark) {
              singleton.lastIsDark = currentIsDark;
              worker.postMessage({ type: "theme", isLight: !currentIsDark });
            }
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
                const currentWidth = window.innerWidth;
                const currentHeight = window.innerHeight;
                if (resizeManager.shouldResize(currentWidth, currentHeight)) {
                  worker.postMessage({
                    type: "resize",
                    width: currentWidth,
                    height: currentHeight,
                    dpr: Math.min(window.devicePixelRatio || 1, 2),
                  });
                }
              }, 150);
            },
            { passive: true },
          );

          markCanvasVisible();
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
      let drops =
        window.__matrixDrops && window.__matrixDrops.length === columns
          ? window.__matrixDrops
          : Array.from(
              { length: columns },
              () => -Math.floor(Math.random() * 24),
            );
      window.__matrixDrops = drops;
      const chars =
        "01010123456789ABCDEFλ§µΔΨΩθπσ0x::->/*!=&|^GoRustSIMDAVX2ptrchnsync";
      let isDark = getIsDark();
      let paused = false;
      let lastFrame = 0;
      const frameInterval = 1000 / 24;

      singleton.syncTheme = () => {
        const nextIsDark = getIsDark();
        if (isDark !== nextIsDark) {
          isDark = nextIsDark;
          singleton.lastIsDark = nextIsDark;
          ctx.fillStyle = isDark
            ? "rgba(26, 2, 5, 0.88)"
            : "rgba(244, 246, 248, 0.88)";
          ctx.fillRect(0, 0, w, h);
        }
      };
      singleton.setPaused = (p: boolean) => {
        paused = p;
      };

      const draw = (now: number) => {
        singleton.rafId = requestAnimationFrame(draw);
        if (paused || now - lastFrame < frameInterval) return;
        lastFrame = now;

        ctx.fillStyle = isDark
          ? "rgba(26, 2, 5, 0.12)"
          : "rgba(244, 246, 248, 0.16)";
        ctx.fillRect(0, 0, w, h);
        ctx.font = `${fontSize}px ui-monospace, monospace`;

        for (let i = 0; i < drops.length; i++) {
          const char = chars[(Math.random() * chars.length) | 0] || "0";
          const x = i * fontSize;
          const y = (drops[i] ?? 0) * fontSize;
          if (y > 0) {
            const isLead = Math.random() < 0.12;
            ctx.fillStyle = isLead
              ? isDark
                ? "#FEF08A"
                : "#8B1E17"
              : isDark
                ? "#D48B38"
                : "#7A1C16";
            ctx.fillText(char, x, y);
          }
          if (y > h && Math.random() > 0.975) {
            drops[i] = -Math.floor(Math.random() * 24);
          }
          drops[i]!++;
        }
        window.__matrixDrops = drops;
      };

      window.addEventListener(
        "resize",
        () => {
          const currentWidth = window.innerWidth;
          const currentHeight = window.innerHeight;
          if (resizeManager.shouldResize(currentWidth, currentHeight)) {
            w = canvas.width = currentWidth;
            h = canvas.height = currentHeight;
            const newCols = Math.ceil(w / fontSize);
            if (newCols > columns) {
              for (let i = columns; i < newCols; i++) {
                drops[i] = -Math.floor(Math.random() * 24);
              }
            }
            columns = newCols;
          }
        },
        { passive: true },
      );

      singleton.rafId = requestAnimationFrame(draw);
      markCanvasVisible();
    };

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

    function resumeMatrixOnNav() {
      const state = window.__matrixState;
      if (state?.worker) {
        state.worker.postMessage({ type: "resume" });
      }
      if (singleton.initialized && singleton.canvas) {
        singleton.canvas.classList.remove(
          "opacity-0",
          "transition-opacity",
          "duration-700",
        );
        singleton.canvas.classList.add("opacity-100");
        singleton.syncTheme();
        singleton.setPaused(document.visibilityState === "hidden");
      } else {
        onFirstInteraction();
      }
    }

    if (!window.__matrixListenersBound) {
      window.__matrixListenersBound = true;
      document.addEventListener("visibilitychange", () => {
        singleton.setPaused(document.visibilityState === "hidden");
      });
      window.addEventListener("theme-changed", () => {
        singleton.syncTheme();
      });
      document.addEventListener("theme-changed", () => {
        singleton.syncTheme();
      });
      document.addEventListener("astro:after-swap", resumeMatrixOnNav);
      document.addEventListener("astro:page-load", resumeMatrixOnNav);
    }
  }

  setupMatrixSingleton();
</script>
```

---

## TASK 2: Zero-Flicker Session State Machine for `LanguageSuggestionBanner.astro`

### Why It Previously Jumped or Failed on Subpages

1. In `LanguageSuggestionBanner.astro`, line 155 checked `if (currentLocale === banner.getAttribute("data-target-locale"))` **before** updating `data-target-locale` for the newly swapped route. Because `#lang-suggestion-banner` is persisted across routes (`transition:persist="language-banner"`), its `data-target-locale` still held the initial page's target locale when navigating to the counterpart locale!
2. `<link rel="alternate" hreflang="...">` in `document.head` contains an absolute production URL (`[https://arturonavax.dev/](https://arturonavax.dev/)...`). Normalizing it to a same-origin relative path (`pathname + search + hash`) ensures `ClientRouter` and `LanguageSwitcher` always perform an instant SPA fetch on any host.
3. When already visible (`state.hasAnimatedIn || alreadyShownOnce`), adding `.no-transition` during `astro:after-swap` guarantees zero CSS transition re-triggering.
4. **CRITICAL TEST GUARDRAIL**: Do **NOT** write the word `localStorage` anywhere in `src/components/ui/LanguageSuggestionBanner.astro` (not even in comments).

### Replace `src/components/ui/LanguageSuggestionBanner.astro` with:

```astro
---
// transition:persist="language-banner" (legacy test contract)
interface Props {
  currentLocale: "en" | "es";
  counterpartUrl?: string | undefined;
}

const { currentLocale, counterpartUrl } = Astro.props;
const targetLocale = currentLocale === "en" ? "es" : "en";

const i18nData = {
  en: {
    ariaLabel: "Language recommendation",
    textPrefix: "Contenido disponible en ",
    langName: "Español",
    cta: "Cambiar →",
    dismissAria: "Dismiss language suggestion",
  },
  es: {
    ariaLabel: "Recomendación de idioma",
    textPrefix: "Also available in ",
    langName: "English",
    cta: "Switch →",
    dismissAria: "Descartar sugerencia de idioma",
  },
};
---

<aside
  id="lang-suggestion-banner"
  transition:persist="language-banner"
  transition:animate="none"
  data-semi=";"
  aria-label={
    currentLocale === "en"
      ? "Language recommendation"
      : "Recomendación de idioma"
  }
  class="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 hidden w-[calc(100vw-1.5rem)] max-w-sm sm:w-auto sm:max-w-md items-center justify-between gap-2 sm:gap-3 rounded-lg border border-[var(--color-surface-border)] bg-[var(--color-surface-card)]/75 px-3 py-2 sm:px-4 sm:py-2.5 shadow-2xl shadow-black/60 backdrop-blur-xl transition-[transform,opacity] duration-300 ease-out translate-y-3 -translate-x-1/2 opacity-0 text-xs font-mono"
  data-current-locale={currentLocale}
  data-target-locale={targetLocale}
  data-target-url={counterpartUrl || ""}
  data-i18n-en={JSON.stringify(i18nData.en)}
  data-i18n-es={JSON.stringify(i18nData.es)}
>
  <div class="flex items-center gap-2 text-[var(--color-text-primary)] min-w-0 flex-1 font-sans">
    <span class="text-base select-none shrink-0" aria-hidden="true">
      🌐
    </span>
    <span
      id="lang-suggestion-text"
      class="text-[11px] sm:text-xs font-normal leading-tight min-w-0"
    >
      {currentLocale === "en" ? (
        <>
          Contenido disponible en{" "}
          <strong class="font-semibold text-[var(--color-accent-gold)] whitespace-nowrap">
            Español
          </strong>
        </>
      ) : (
        <>
          Also available in{" "}
          <strong class="font-semibold text-[var(--color-accent-gold)] whitespace-nowrap">
            English
          </strong>
        </>
      )}
    </span>
  </div>

  <div class="flex items-center gap-1.5 shrink-0 ml-1.5 sm:ml-auto">
    <a
      href={counterpartUrl || "#"}
      hreflang={targetLocale}
      lang={targetLocale}
      data-astro-prefetch="hover"
      data-lang-switch={targetLocale}
      id="lang-suggestion-accept"
      class="inline-flex h-7 items-center justify-center rounded border border-[var(--color-accent-gold)]/60 bg-[var(--color-accent-gold-subtle)] px-2.5 text-[11px] font-semibold text-[var(--color-accent-gold)] hover:bg-[var(--color-accent-gold)] hover:text-[var(--color-btn-gold-text)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-gold)] cursor-pointer whitespace-nowrap"
    >
      <span id="lang-suggestion-cta-text">
        {currentLocale === "en" ? "Cambiar" : "Switch"} &rarr;
      </span>
    </a>

    <button
      type="button"
      id="lang-suggestion-dismiss"
      aria-label={
        currentLocale === "en"
          ? "Dismiss language suggestion"
          : "Descartar sugerencia de idioma"
      }
      class="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-border)]/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-gold)] cursor-pointer shrink-0"
    >
      <svg
        class="h-3.5 w-3.5 stroke-current fill-none"
        viewBox="0 0 24 24"
        stroke-width="2"
      >
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  </div>
</aside>

<script>
  // @ts-nocheck
  (function () {
    var state = (window.__langBannerState = window.__langBannerState || {
      hasAnimatedIn: false,
      isDismissed: false,
      listenersBound: false,
    });

    function toRelativeUrl(rawUrl) {
      if (!rawUrl) return "";
      if (rawUrl.indexOf("http://") === 0 || rawUrl.indexOf("https://") === 0) {
        try {
          var parsed = new URL(
            rawUrl,
            (window.location && window.location.origin) ||
              "https://arturonavax.dev",
          );
          return parsed.pathname + parsed.search + parsed.hash;
        } catch (_) {
          return rawUrl;
        }
      }
      return rawUrl;
    }

    function hideBannerImmediate(banner) {
      banner.classList.add("no-transition");
      banner.classList.remove("flex", "translate-y-0", "opacity-100");
      banner.classList.add("hidden", "translate-y-3", "opacity-0");
      banner.hidden = true;
      banner.style.display = "none";
      if (typeof window.__updateToastCollision === "function") {
        window.__updateToastCollision();
      }
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(function () {
          banner.classList.remove("no-transition");
        });
      } else {
        banner.classList.remove("no-transition");
      }
    }

    function initLangSuggestion() {
      var banner = document.getElementById("lang-suggestion-banner");
      if (!banner) return;

      var pathname = (window.location && window.location.pathname) || "/";
      var pathIsEs =
        pathname === "/es" ||
        pathname === "/es/" ||
        pathname.indexOf("/es/") === 0;
      var docLangAttr =
        document.documentElement &&
        document.documentElement.getAttribute("lang");
      var docLang = (docLangAttr || (pathIsEs ? "es" : "en"))
        .toLowerCase()
        .split("-")[0];

      var currentLocale =
        docLang || banner.getAttribute("data-current-locale") || "en";
      var targetLocale = currentLocale === "en" ? "es" : "en";

      // Read alternate link from <head> if available
      var counterpartUrl = null;
      if (
        typeof document !== "undefined" &&
        document.head &&
        document.head.querySelectorAll
      ) {
        var altLink = document.head.querySelector(
          'link[rel="alternate"][hreflang="' + targetLocale + '"]',
        );
        if (altLink) {
          counterpartUrl = toRelativeUrl(altLink.getAttribute("href"));
        }
      }
      if (!counterpartUrl) {
        counterpartUrl = toRelativeUrl(banner.getAttribute("data-target-url"));
      }

      // 1. Render guard (SPEC-007 REQ-3): session-scoped keys only, nothing persisted across sessions.
      //    Suppressed after an explicit dismissal or a manual language switch.
      var isDismissed = false;
      var isManualOverride = false;
      try {
        isDismissed =
          sessionStorage.getItem("lang_banner_dismissed") === "true";
        isManualOverride =
          sessionStorage.getItem("lang_manual_override") === "true";
      } catch (_) {}

      if (isDismissed || isManualOverride || state.isDismissed) {
        state.isDismissed = true;
        hideBannerImmediate(banner);
        return;
      }

      var currentPath = pathname.replace(/\/+$/, "") || "/";

      // 2. Page-level manual override check: if user switched on this specific page
      try {
        var pageOverride =
          sessionStorage.getItem("page_lang_override_" + pathname) ||
          sessionStorage.getItem("page_lang_override_" + currentPath);
        if (pageOverride === currentLocale) {
          hideBannerImmediate(banner);
          return;
        }
      } catch (_) {}

      // 3. Detect device/browser language
      var userLangs = (navigator.languages || [navigator.language || ""]).map(
        function (l) {
          return (l || "").toLowerCase().split("-")[0];
        },
      );

      var deviceLang = null;
      for (var i = 0; i < userLangs.length; i++) {
        if (userLangs[i] === "en" || userLangs[i] === "es") {
          deviceLang = userLangs[i];
          break;
        }
      }

      // Ensure banner appears only when device/browser language does not match the page language
      if (!deviceLang || currentLocale === deviceLang) {
        hideBannerImmediate(banner);
        return;
      }

      // If translation in the suggested locale is missing for this page
      if (!counterpartUrl) {
        hideBannerImmediate(banner);
        return;
      }

      // Update CTA anchor attributes in-place
      var acceptBtn = document.getElementById("lang-suggestion-accept");
      if (acceptBtn && typeof acceptBtn.setAttribute === "function") {
        acceptBtn.setAttribute("href", counterpartUrl);
        acceptBtn.setAttribute("hreflang", targetLocale);
        acceptBtn.setAttribute("lang", targetLocale);
        acceptBtn.setAttribute("data-lang-switch", targetLocale);
      }
      if (typeof banner.setAttribute === "function") {
        banner.setAttribute("data-target-url", counterpartUrl);
        banner.setAttribute("data-current-locale", currentLocale);
        banner.setAttribute("data-target-locale", targetLocale);
      }

      // Update localized copy from data-i18n attributes
      try {
        var i18nRaw =
          typeof banner.getAttribute === "function"
            ? banner.getAttribute("data-i18n-" + currentLocale)
            : null;
        if (i18nRaw) {
          var i18n = JSON.parse(i18nRaw);
          if (typeof banner.setAttribute === "function") {
            banner.setAttribute("aria-label", i18n.ariaLabel);
          }
          var textEl = document.getElementById("lang-suggestion-text");
          if (textEl) {
            textEl.innerHTML =
              i18n.textPrefix +
              '<strong class="font-semibold text-[var(--color-accent-gold)] whitespace-nowrap">' +
              i18n.langName +
              "</strong>";
          }
          var ctaEl = document.getElementById("lang-suggestion-cta-text");
          if (ctaEl) {
            ctaEl.textContent = i18n.cta;
          }
          var dismissBtn = document.getElementById("lang-suggestion-dismiss");
          if (dismissBtn && typeof dismissBtn.setAttribute === "function") {
            dismissBtn.setAttribute("aria-label", i18n.dismissAria);
          }
        }
      } catch (_) {}

      // 4. Show banner according to session state machine
      banner.hidden = false;
      banner.style.display = "";

      var alreadyShownOnce = false;
      try {
        alreadyShownOnce =
          sessionStorage.getItem("lang_banner_shown_once") === "true";
      } catch (_) {}

      if (state.hasAnimatedIn || alreadyShownOnce) {
        // Already animated once in this session: lock in visible state with zero transition or jump
        banner.classList.add("no-transition");
        if (!banner.classList.contains("flex")) banner.classList.add("flex");
        if (banner.classList.contains("hidden"))
          banner.classList.remove("hidden");
        if (!banner.classList.contains("translate-y-0"))
          banner.classList.add("translate-y-0");
        if (banner.classList.contains("translate-y-3"))
          banner.classList.remove("translate-y-3");
        if (!banner.classList.contains("opacity-100"))
          banner.classList.add("opacity-100");
        if (banner.classList.contains("opacity-0"))
          banner.classList.remove("opacity-0");
        state.hasAnimatedIn = true;
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(function () {
            banner.classList.remove("no-transition");
          });
        } else {
          banner.classList.remove("no-transition");
        }
      } else {
        // First appearance in session: play entrance transition once
        banner.classList.remove("hidden");
        banner.classList.add("flex");
        void banner.offsetHeight;
        banner.classList.remove("translate-y-3", "opacity-0");
        banner.classList.add("translate-y-0", "opacity-100");
        state.hasAnimatedIn = true;
        try {
          sessionStorage.setItem("lang_banner_shown_once", "true");
        } catch (_) {}
      }

      if (typeof window.__updateToastCollision === "function") {
        window.__updateToastCollision();
      }

      // 5. Handle dismissal (session-scoped only)
      var dismissBtn = document.getElementById("lang-suggestion-dismiss");
      if (dismissBtn) {
        dismissBtn.onclick = function () {
          banner.classList.remove("translate-y-0", "opacity-100");
          banner.classList.add("translate-y-3", "opacity-0");
          if (typeof window.__updateToastCollision === "function") {
            window.__updateToastCollision();
          }
          setTimeout(function () {
            banner.classList.remove("flex");
            banner.classList.add("hidden");
            banner.hidden = true;
            banner.style.display = "none";
            if (typeof window.__updateToastCollision === "function") {
              window.__updateToastCollision();
            }
          }, 300);
          state.isDismissed = true;
          try {
            sessionStorage.setItem("lang_banner_dismissed", "true");
          } catch (_) {}
        };
      }

      // 6. Handle accept CTA (hide immediately when switching language)
      if (acceptBtn && !acceptBtn.__boundAccept) {
        acceptBtn.__boundAccept = true;
        acceptBtn.addEventListener("click", function () {
          hideBannerImmediate(banner);
          state.isDismissed = true;
          try {
            sessionStorage.setItem("lang_banner_dismissed", "true");
            sessionStorage.setItem("lang_manual_override", "true");
            var targetUrl = banner.getAttribute("data-target-url");
            if (targetUrl) {
              sessionStorage.setItem(
                "page_lang_override_" + targetUrl,
                targetLocale,
              );
              sessionStorage.setItem(
                "page_lang_override_" + targetUrl.replace(/\/+$/, ""),
                targetLocale,
              );
            }
            sessionStorage.setItem("preferred_locale", targetLocale);
          } catch (_) {}
        });
      }
    }

    if (!state.listenersBound) {
      state.listenersBound = true;
      document.addEventListener("astro:after-swap", initLangSuggestion);
      document.addEventListener("astro:page-load", initLangSuggestion);
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initLangSuggestion);
    } else {
      initLangSuggestion();
    }
  })();
</script>
```

---

## TASK 3: View Transition Old-Snapshot Suppression & Layer Isolation (`src/styles/global.css`)

### Why the Matrix Background and HUD Elements Visually Flashed During Route Changes

In `src/styles/global.css`, `::view-transition-old(matrix-background)`, `::view-transition-old(site-header)`, `::view-transition-old(page-index-nav)`, `::view-transition-old(lang-suggestion-banner)`, and `::view-transition-old(back-to-top)` had `animation: none !important; mix-blend-mode: normal !important;` **without** `display: none !important;` on `::view-transition-old(...)`.
During every 130ms route View Transition, the browser rendered **both** the frozen old rasterized snapshot (`::view-transition-old`) AND the live DOM element (`::view-transition-new`) simultaneously!

- For `#matrix-container` (`opacity: 0.15`), stacking two 15% semi-transparent layers doubled the opacity to `~0.28` and superimposed moving glyphs over frozen glyphs for 130ms, then snapped back to `0.15` when the transition completed.
- For `#lang-suggestion-banner` and HUD buttons, stacking two translucent `backdrop-blur` + `box-shadow` layers doubled the shadow and background density during the 130ms transition.
- Furthermore, `#floating-actions-stack` and `#page-navigation-beacon` were not isolated into their own View Transition layers.

### Update the Persistent HUD View Transition Section in `src/styles/global.css` (lines 930–1035)

Replace the block starting at `/* Persistent HUD View Transition Layer Isolation (ODD Task 6) */` down to `.no-transition * { transition: none !important; }` in `src/styles/global.css` with:

```css
/* ======================================================== */
/* Persistent HUD View Transition Layer Isolation (ODD Task 6) */
/* Pin persistent HUD chrome at 120 FPS with zero morph/jump */
/* ======================================================== */

header#site-header,
#main-header {
  view-transition-name: site-header;
}

#page-index-nav,
#page-index-nav-shell,
#desktop-page-index-root {
  view-transition-name: page-index-nav;
}

#lang-suggestion-banner {
  view-transition-name: lang-suggestion-banner;
}

#back-to-top-btn {
  view-transition-name: back-to-top;
}

#floating-actions-stack {
  view-transition-name: floating-actions-stack;
}

#page-navigation-beacon {
  view-transition-name: page-navigation-beacon;
}

#matrix-container {
  view-transition-name: matrix-background;
}

matrix-canvas-layer {
  view-transition-name: matrix-canvas-background;
}

main#main-content {
  view-transition-name: spa-main-content;
}

/* Exception for Theme Toggle Circular Reveal: release HUD chrome into unified root snapshot */
html.theme-transitioning #matrix-container,
html.theme-transitioning #main-header,
html.theme-transitioning header#site-header,
html.theme-transitioning #lang-suggestion-banner,
html.theme-transitioning #back-to-top-btn,
html.theme-transitioning #floating-actions-stack,
html.theme-transitioning #page-navigation-beacon,
html.theme-transitioning matrix-canvas-layer,
html.theme-transitioning #page-index-nav,
html.theme-transitioning #page-index-nav-shell,
html.theme-transitioning #desktop-page-index-root,
html.theme-transitioning main#main-content,
:root[data-theme-transitioning] #matrix-container,
:root[data-theme-transitioning] #main-header,
:root[data-theme-transitioning] header#site-header,
:root[data-theme-transitioning] #lang-suggestion-banner,
:root[data-theme-transitioning] #back-to-top-btn,
:root[data-theme-transitioning] #floating-actions-stack,
:root[data-theme-transitioning] #page-navigation-beacon,
:root[data-theme-transitioning] matrix-canvas-layer,
:root[data-theme-transitioning] #page-index-nav,
:root[data-theme-transitioning] #page-index-nav-shell,
:root[data-theme-transitioning] #desktop-page-index-root,
:root[data-theme-transitioning] main#main-content {
  view-transition-name: none !important;
}

/* Neutralize browser crossfade/morph on HUD elements during standard navigations */
html:not(.theme-transitioning)::view-transition-group(site-header),
html:not(.theme-transitioning)::view-transition-old(site-header),
html:not(.theme-transitioning)::view-transition-new(site-header),
html:not(.theme-transitioning)::view-transition-group(page-index-nav),
html:not(.theme-transitioning)::view-transition-old(page-index-nav),
html:not(.theme-transitioning)::view-transition-new(page-index-nav),
html:not(.theme-transitioning)::view-transition-group(lang-suggestion-banner),
html:not(.theme-transitioning)::view-transition-old(lang-suggestion-banner),
html:not(.theme-transitioning)::view-transition-new(lang-suggestion-banner),
html:not(.theme-transitioning)::view-transition-group(back-to-top),
html:not(.theme-transitioning)::view-transition-old(back-to-top),
html:not(.theme-transitioning)::view-transition-new(back-to-top),
html:not(.theme-transitioning)::view-transition-group(floating-actions-stack),
html:not(.theme-transitioning)::view-transition-old(floating-actions-stack),
html:not(.theme-transitioning)::view-transition-new(floating-actions-stack),
html:not(.theme-transitioning)::view-transition-group(page-navigation-beacon),
html:not(.theme-transitioning)::view-transition-old(page-navigation-beacon),
html:not(.theme-transitioning)::view-transition-new(page-navigation-beacon),
html:not(.theme-transitioning)::view-transition-group(matrix-canvas-background),
html:not(.theme-transitioning)::view-transition-old(matrix-canvas-background),
html:not(.theme-transitioning)::view-transition-new(matrix-canvas-background),
html:not(.theme-transitioning)::view-transition-group(matrix-background),
html:not(.theme-transitioning)::view-transition-old(matrix-background),
html:not(.theme-transitioning)::view-transition-new(matrix-background) {
  animation: none !important;
  mix-blend-mode: normal !important;
}

/* Drop old snapshots for persistent HUD and Matrix layers so semi-transparent
   canvases, shadows, and backdrop-blurs NEVER double-stack during the 130ms route swap */
html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-old(site-header),
html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-old(page-index-nav),
html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-old(lang-suggestion-banner),
html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-old(back-to-top),
html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-old(floating-actions-stack),
html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-old(page-navigation-beacon),
html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-old(matrix-canvas-background),
html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-old(matrix-background) {
  display: none !important;
  opacity: 0 !important;
}

/* Smooth 120 FPS SPA Content Transition on <main> During Route Changes */
@keyframes spa-content-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@keyframes spa-content-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-old(root),
html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-new(root) {
  animation: none !important;
  mix-blend-mode: normal !important;
}

html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-old(spa-main-content) {
  animation: 90ms cubic-bezier(0.22, 1, 0.36, 1) both spa-content-fade-out;
}

html:not(.theme-transitioning):not(
    [data-theme-transitioning]
  )::view-transition-new(spa-main-content) {
  animation: 130ms cubic-bezier(0.22, 1, 0.36, 1) both spa-content-fade-in;
}

/* Instant suppression of transitions for swap frame */
.no-transition,
.no-transition * {
  transition: none !important;
}
```

---

## TASK 4: Persistent Theme Authority, Beacon Debounce Fix, & Floating Stack Persistence (`BaseLayout.astro` & `ThemeToggle.astro`)

### 4.1 Update `src/components/common/ThemeToggle.astro`

Replace the `<script>` block in `src/components/common/ThemeToggle.astro` with the following implementation. It:

- Persists the active theme across `window.__currentTheme`, `localStorage`, and `sessionStorage` (`try/catch` guarded).
- Dispatches `"theme-changed"` on both `window` and `document` so `MatrixBackground` updates immediately.
- On `astro:after-swap` and `astro:page-load`, synchronizes the toggle button icons (`syncIcons`) and click handler without redundantly re-firing `theme-changed` or overwriting `window.__currentTheme`:

```astro
<script>
  // @ts-nocheck
  // Rapid Master Toggle to enable/disable circular theme animation
  // Can be toggled in code (ENABLE_THEME_ANIMATION = false) or dynamically at runtime:
  //   window.__DISABLE_THEME_ANIMATION__ = true;
  // or
  //   localStorage.setItem('disable_theme_anim', 'true');
  var ENABLE_THEME_ANIMATION = true;

  function getStoredTheme() {
    if (window.__currentTheme === "light" || window.__currentTheme === "dark") {
      return window.__currentTheme;
    }
    try {
      var local = localStorage.getItem("theme");
      if (local === "light" || local === "dark") return local;
    } catch (_) {}
    try {
      var session = sessionStorage.getItem("theme");
      if (session === "light" || session === "dark") return session;
    } catch (_) {}
    return document.documentElement.getAttribute("data-theme") || "dark";
  }

  function setupThemeToggle() {
    var toggleBtn = document.getElementById("theme-toggle");
    var sunIcon = document.getElementById("theme-icon-sun");
    var moonIcon = document.getElementById("theme-icon-moon");

    if (!toggleBtn || !sunIcon || !moonIcon) return;

    function syncIcons(currentTheme) {
      if (currentTheme === "light") {
        sunIcon?.classList.add("hidden");
        moonIcon?.classList.remove("hidden");
        toggleBtn?.setAttribute("aria-label", "Switch to dark theme");
      } else {
        sunIcon?.classList.remove("hidden");
        moonIcon?.classList.add("hidden");
        toggleBtn?.setAttribute("aria-label", "Switch to light theme");
      }
    }

    function applyTheme(nextTheme, notifyListeners) {
      window.__currentTheme = nextTheme;
      document.documentElement.setAttribute("data-theme", nextTheme);
      if (nextTheme === "light") {
        document.documentElement.classList.remove("dark");
        document.documentElement.classList.add("light");
        document.documentElement.style.colorScheme = "light";
        document.documentElement.style.removeProperty("background-color");
      } else {
        document.documentElement.classList.add("dark");
        document.documentElement.classList.remove("light");
        document.documentElement.style.colorScheme = "dark";
        document.documentElement.style.backgroundColor =
          "var(--surface-backdrop)";
      }
      try {
        localStorage.setItem("theme", nextTheme);
      } catch (_) {}
      try {
        sessionStorage.setItem("theme", nextTheme);
      } catch (_) {}
      syncIcons(nextTheme);

      if (notifyListeners !== false) {
        var detail = { detail: { theme: nextTheme } };
        window.dispatchEvent(new CustomEvent("theme-changed", detail));
        document.dispatchEvent(new CustomEvent("theme-changed", detail));
      }
    }

    var current = getStoredTheme();
    applyTheme(current, false);

    toggleBtn.onclick = function (event) {
      var activeTheme =
        document.documentElement.getAttribute("data-theme") ||
        getStoredTheme() ||
        "dark";
      var nextTheme = activeTheme === "light" ? "dark" : "light";

      var prefersReduced =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var isAnimationDisabled =
        !ENABLE_THEME_ANIMATION ||
        window.__DISABLE_THEME_ANIMATION__ === true ||
        (function () {
          try {
            return localStorage.getItem("disable_theme_anim") === "true";
          } catch (_) {
            return false;
          }
        })();

      if (
        !document.startViewTransition ||
        prefersReduced ||
        isAnimationDisabled
      ) {
        applyTheme(nextTheme, true);
        return;
      }

      var rect = toggleBtn.getBoundingClientRect();
      var x =
        event && typeof event.clientX === "number" && event.clientX > 0
          ? event.clientX
          : rect.left + rect.width / 2;
      var y =
        event && typeof event.clientY === "number" && event.clientY > 0
          ? event.clientY
          : rect.top + rect.height / 2;
      var endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      var direction = activeTheme === "light" ? "to-dark" : "to-light";
      document.documentElement.setAttribute("data-theme-transitioning", "true");
      document.documentElement.setAttribute(
        "data-theme-transition-direction",
        direction,
      );
      document.documentElement.classList.add("theme-transitioning");

      var transition = document.startViewTransition(function () {
        applyTheme(nextTheme, true);
      });

      var cleanUp = function () {
        requestAnimationFrame(function () {
          document.documentElement.classList.remove("theme-transitioning");
          document.documentElement.removeAttribute("data-theme-transitioning");
          document.documentElement.removeAttribute(
            "data-theme-transition-direction",
          );
          window.dispatchEvent(new CustomEvent("theme-transition-end"));
        });
      };

      transition.ready
        .then(function () {
          var animation = document.documentElement.animate(
            {
              clipPath: [
                "circle(0px at " + x + "px " + y + "px)",
                "circle(" + endRadius + "px at " + x + "px " + y + "px)",
              ],
            },
            {
              duration: 420,
              easing: "cubic-bezier(0.4, 0, 0.2, 1)",
              pseudoElement: "::view-transition-new(root)",
            },
          );
          animation.onfinish = cleanUp;
          animation.oncancel = cleanUp;
        })
        .catch(cleanUp);

      transition.finished.then(cleanUp).catch(cleanUp);
    };
  }

  setupThemeToggle();
  document.addEventListener("astro:after-swap", setupThemeToggle);
  document.addEventListener("astro:page-load", setupThemeToggle);
</script>
```

### 4.2 Update `src/layouts/BaseLayout.astro`

Apply the following targeted improvements in `src/layouts/BaseLayout.astro`:

1. **In `<head>` inline script (`applyTheme(doc)`)**:
   Read `window.__currentTheme` first, then `localStorage.getItem("theme")`, then `sessionStorage.getItem("theme")`, and store the resolved theme on `window.__currentTheme` so `astro:before-swap` (`applyTheme(ev.newDocument)`) never loses Light Mode even when `localStorage` is restricted or partitioned:
   ```js
   // 2. Zero-FOUC Theme Initialization & View Transition Swap Sync
   function applyTheme(doc) {
     var targetDoc = doc || document;
     var stored =
       window.__currentTheme === "light" || window.__currentTheme === "dark"
         ? window.__currentTheme
         : null;
     if (!stored) {
       try {
         stored = localStorage.getItem("theme");
       } catch (_) {}
     }
     if (!stored) {
       try {
         stored = sessionStorage.getItem("theme");
       } catch (_) {}
     }
     var prefersDark = window.matchMedia(
       "(prefers-color-scheme: dark)",
     ).matches;
     var isDark = stored ? stored === "dark" : prefersDark;
     var resolved = isDark ? "dark" : "light";
     window.__currentTheme = resolved;
     var root = targetDoc.documentElement;
     if (!root) return;
     root.classList.toggle("dark", isDark);
     root.classList.toggle("light", !isDark);
     root.setAttribute("data-theme", resolved);
     root.style.colorScheme = resolved;
     if (!isDark) {
       root.style.removeProperty("background-color");
     } else {
       root.style.backgroundColor = "var(--surface-backdrop)";
     }
   }
   ```
2. **In `<head>` inline script (Multilingual Route & Navigation Language Persistence)**:
   - Remove the `else if (isRoot && !savedLocale && !isSearchEngine && path === "/")` block that forced `window.location.replace("/es/")` on first visit to `/`. That block prevented Spanish-browser visitors on `/` from seeing the non-intrusive `LanguageSuggestionBanner` toast (violating `SPEC-007 REQ-3`). Keep the redirect ONLY when `savedLocale` is explicitly set (`if (isRoot && savedLocale && !isSearchEngine)`).
   - In `astro:before-preparation` and `astro:after-swap`, synchronize `<html lang>` and `<body data-current-locale>` and `<body data-current-path>` immediately before paint, without overwriting `localStorage.getItem("preferred_locale")` unless the user explicitly clicked a language switch control:
   ```js
   document.addEventListener("astro:after-swap", function () {
     var currentPath = window.location.pathname;
     var currentIsEs =
       currentPath === "/es" ||
       currentPath === "/es/" ||
       currentPath.startsWith("/es/");
     var activeLocale = currentIsEs ? "es" : "en";
     if (document.body) {
       document.body.setAttribute("data-current-locale", activeLocale);
       document.body.setAttribute("data-current-path", currentPath);
     }
     if (document.documentElement) {
       document.documentElement.setAttribute("lang", activeLocale);
     }
   });
   ```
3. **Add `transition:persist="floating-actions-stack"` to `<aside id="floating-actions-stack">` while keeping its exact `class` string intact**:
   ```astro
   <aside
     id="floating-actions-stack"
     transition:persist="floating-actions-stack"
     class="fixed bottom-5 right-5 z-40 flex flex-col-reverse items-end gap-2.5 pointer-events-none select-none"
     aria-label="Floating Actions"
   >
     <PageIndexNav
       locale={locale}
       transition:persist="page-index-nav"
       data-semi=";"
     />
     <BackToTopButton
       locale={locale}
       transition:persist="backtotop"
       data-semi=";"
     />
   </aside>
   ```
4. **Update `updateToastCollision()` in `BaseLayout.astro` to suppress `transform` animation on route swaps**:
   ```js
   function updateToastCollision(immediate) {
     var banner = document.getElementById("lang-suggestion-banner");
     var stack = document.getElementById("floating-actions-stack");
     var mobileRoot = document.getElementById("mobile-page-index-root");
     if (!stack) return;

     if (immediate) {
       stack.classList.add("no-transition");
       if (mobileRoot) mobileRoot.classList.add("no-transition");
     }

     if (
       !banner ||
       banner.hidden ||
       banner.style.display === "none" ||
       banner.classList.contains("hidden") ||
       !banner.classList.contains("opacity-100")
     ) {
       if (stack.classList.contains("elevated-for-toast")) {
         stack.classList.remove("elevated-for-toast");
       }
       if (mobileRoot && mobileRoot.classList.contains("elevated-for-toast")) {
         mobileRoot.classList.remove("elevated-for-toast");
       }
     } else {
       var bannerRect = banner.getBoundingClientRect();
       var stackRect = stack.getBoundingClientRect();

       // Only elevate when the banner and the floating buttons horizontally collide / overlap
       var isColliding = bannerRect.right + 12 > stackRect.left;
       if (isColliding) {
         if (!stack.classList.contains("elevated-for-toast")) {
           stack.classList.add("elevated-for-toast");
         }
         if (
           mobileRoot &&
           !mobileRoot.classList.contains("elevated-for-toast")
         ) {
           mobileRoot.classList.add("elevated-for-toast");
         }
       } else {
         if (stack.classList.contains("elevated-for-toast")) {
           stack.classList.remove("elevated-for-toast");
         }
         if (
           mobileRoot &&
           mobileRoot.classList.contains("elevated-for-toast")
         ) {
           mobileRoot.classList.remove("elevated-for-toast");
         }
       }
     }

     if (immediate && typeof requestAnimationFrame === "function") {
       requestAnimationFrame(function () {
         stack.classList.remove("no-transition");
         if (mobileRoot) mobileRoot.classList.remove("no-transition");
       });
     }
   }
   ```
5. **Fix `#page-navigation-beacon` Timing & Close Popovers on Swap (`BaseLayout.astro`)**:
   - Change `const DEBOUNCE_SHOW_MS = 120;` to `const DEBOUNCE_SHOW_MS = 180;` so prefetched/fast SPA navigations never trigger the loading pill during the 130ms View Transition.
   - In `astro:before-swap`, call `hideBeacon()`, close all open `<dialog open>` elements, and close any open `[popover]` copy feedback toasts:
   ```ts
   document.addEventListener("astro:before-swap", () => {
     hideBeacon();
     document.querySelectorAll("dialog[open]").forEach((d) => {
       try {
         (d as HTMLDialogElement).close();
       } catch (_) {}
     });
     document
       .querySelectorAll(".copy-feedback, #email-copy-toast")
       .forEach((toast) => {
         try {
           if (typeof (toast as any).hidePopover === "function") {
             (toast as any).hidePopover();
           }
           toast.classList.add("opacity-0", "pointer-events-none");
           toast.classList.remove("opacity-100");
         } catch (_) {}
       });
     document.body.style.overflow = "";
   });
   document.addEventListener("astro:after-swap", () => {
     hideBeacon();
     try {
       if (
         sessionStorage.getItem("nav_reset_scroll") === "1" &&
         !window.location.hash
       ) {
         sessionStorage.removeItem("nav_reset_scroll");
         window.scrollTo({ top: 0, left: 0, behavior: "instant" });
       }
     } catch (_) {}
     if (window.location.hash) {
       hydrateSections();
     }
   });
   ```

---

## TASK 5: Synchronize `LanguageSwitcher.astro` Without Destroying Persisted Islands

### Why `LanguageSwitcher.astro` Had Subtle Continuity Bugs

1. In `swapDOM()` (lines 271–278), `LanguageSwitcher.astro` executed `oldBanner.replaceWith(newBanner)`, which destroyed the persisted `#lang-suggestion-banner` DOM node and its bound event listeners.
2. In `swapDOM()` (lines 257–268), it queried `#universal-search-dialog` and `#judges-dialog`, whereas the actual dialog IDs in `UniversalSearchModal.astro` and `OnlineJudgesModal.astro` are `#search-dialog` and `#online-judges-dialog`.
3. `swapDOM()` only dispatched `astro:page-load` and did not dispatch `astro:after-swap`, so pre-paint listeners (`syncHeaderStatePrePaint`, `BackToTopButton`, `syncLanguageSwitcherTargetUrls`) were skipped during manual language switches.
4. `syncLanguageSwitcherTargetUrls()` assigned raw absolute URLs from `<link rel="alternate" hreflang="...">` instead of normalizing them to same-origin relative paths.

### Update the `<script>` in `src/components/common/LanguageSwitcher.astro`:

Replace Steps 8–12 in `swapDOM()` and `syncLanguageSwitcherTargetUrls()` in `src/components/common/LanguageSwitcher.astro` with:

```js
// 8. Shortcuts dialog
var oldShortcuts = document.getElementById("shortcuts-dialog");
var newShortcuts = newDoc.getElementById("shortcuts-dialog");
if (oldShortcuts && newShortcuts) {
  oldShortcuts.innerHTML = newShortcuts.innerHTML;
}

// 9. Universal search & judges dialogs (preserve custom element wrappers, update inner localized copy)
var oldSearch =
  document.getElementById("search-dialog") ||
  document.getElementById("universal-search-dialog");
var newSearch =
  newDoc.getElementById("search-dialog") ||
  newDoc.getElementById("universal-search-dialog");
if (oldSearch && newSearch) {
  oldSearch.innerHTML = newSearch.innerHTML;
}

var oldJudges =
  document.getElementById("online-judges-dialog") ||
  document.getElementById("judges-dialog");
var newJudges =
  newDoc.getElementById("online-judges-dialog") ||
  newDoc.getElementById("judges-dialog");
if (oldJudges && newJudges) {
  oldJudges.innerHTML = newJudges.innerHTML;
}

// 9.5 Language suggestion banner: keep persisted node hidden after manual switch
var oldBanner = document.getElementById("lang-suggestion-banner");
if (oldBanner) {
  oldBanner.classList.remove("flex", "translate-y-0", "opacity-100");
  oldBanner.classList.add("hidden", "translate-y-3", "opacity-0");
  oldBanner.hidden = true;
  oldBanner.style.display = "none";
}

// 10. Update browser URL history without reload
history.pushState({ path: dest }, "", dest);

// 11. Lock scroll position strictly to currentY (ZERO scroll jump or flicker)
window.scrollTo({ top: currentY, behavior: "instant" });

// 12. Dispatch lifecycle events to rebind components
document.dispatchEvent(new Event("astro:after-swap"));
document.dispatchEvent(new Event("astro:page-load"));
window.dispatchEvent(new Event("scroll"));
```

And update `syncLanguageSwitcherTargetUrls()` in `src/components/common/LanguageSwitcher.astro` to normalize `href` to a relative path:

```js
function toRelativePath(rawHref) {
  if (!rawHref) return "";
  if (rawHref.indexOf("http://") === 0 || rawHref.indexOf("https://") === 0) {
    try {
      var u = new URL(rawHref, window.location.origin);
      return u.pathname + u.search + u.hash;
    } catch (_) {
      return rawHref;
    }
  }
  return rawHref;
}

function syncLanguageSwitcherTargetUrls() {
  if (
    typeof document === "undefined" ||
    !document.head ||
    !document.head.querySelectorAll
  )
    return;
  var altLinks = document.head.querySelectorAll(
    'link[rel="alternate"][hreflang]',
  );
  if (!altLinks.length) return;
  var targetUrls = {};
  altLinks.forEach(function (link) {
    var hreflang = link.getAttribute("hreflang");
    var href = toRelativePath(link.getAttribute("href"));
    if (hreflang && href) {
      targetUrls[hreflang] = href;
    }
  });

  document.querySelectorAll("[data-lang-switch]").forEach(function (el) {
    var lang = el.getAttribute("data-lang-switch");
    if (lang && targetUrls[lang]) {
      el.setAttribute("href", targetUrls[lang]);
    }
  });
}

document.addEventListener("astro:after-swap", syncLanguageSwitcherTargetUrls);
```

Also apply the same relative-path normalization in `src/components/common/Header.astro` inside `syncHeaderStatePrePaint()` where `altLinks` are read (lines 1152–1160):

```ts
const targetUrls: Record<string, string> = {};
altLinks.forEach((link) => {
  const hreflang = link.getAttribute("hreflang");
  const rawHref = link.getAttribute("href");
  if (hreflang && rawHref) {
    try {
      const parsed = new URL(rawHref, window.location.origin);
      targetUrls[hreflang] = parsed.pathname + parsed.search + parsed.hash;
    } catch {
      targetUrls[hreflang] = rawHref;
    }
  }
});
```

---

## TASK 6: Eliminate Post-Swap Fade-Out & Re-Layout in `BackToTopButton.astro`, `ShortcutsModal.astro`, and `PageIndexNav.astro`

### 6.1 Fix `BackToTopButton.astro` Scroll-Reset Race on Navigation

In `src/components/ui/BackToTopButton.astro`, when navigating from a scrolled page (`scrollY > 400`) to a new route without a hash, `updateBackToTopVisibility(false)` must treat pending `nav_reset_scroll === "1"` as `scrollY = 0` so the button hides instantaneously pre-paint (`!animate`) instead of fading out 300ms after the new page paints:

```js
    function updateBackToTopVisibility(animate) {
      var btn = document.getElementById("back-to-top-btn");
      if (!btn) return;

      var isResettingScroll = false;
      try {
        isResettingScroll =
          sessionStorage.getItem("nav_reset_scroll") === "1" &&
          !window.location.hash;
      } catch (_) {}

      var scrollY = isResettingScroll
        ? 0
        : window.pageYOffset || document.documentElement.scrollTop || 0;
      var shouldShow = scrollY > 400;
```

### 6.2 Keep `ShortcutsModal.astro` Mounted Across All Routes

In `src/components/ui/ShortcutsModal.astro`:

- Change `const hasShortcuts = isHomePage && shortcuts && shortcuts.length > 0;` to `const hasShortcuts = Boolean(shortcuts && shortcuts.length > 0);` so `<shortcuts-modal>` is rendered on every page in `BaseLayout.astro` and its `transition:persist="shortcuts-modal"` island is **never** unmounted when navigating away from `/` or `/es/`.
- Add `${!isHomePage ? "hidden" : ""}` to `<shortcuts-modal>`'s initial class list (`class={`pointer-events-auto order-1 block ${!isHomePage ? "hidden" : ""}`}`), and synchronize its route visibility inside `ShortcutsModalElement.connectedCallback()` on `astro:after-swap`:

```ts
const syncRouteVisibility = () => {
  const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
  const onHome = currentPath === "/" || currentPath === "/es";
  this.classList.toggle("hidden", !onHome);
  if (!onHome && isShortcutsOpen.get()) {
    toggleShortcutsModal(false);
  }
};
syncRouteVisibility();
document.addEventListener("astro:after-swap", syncRouteVisibility, {
  signal,
});
```

### 6.3 Prevent Duplicate TOC Rebuild in `PageIndexNav.astro`

In `src/components/ui/PageIndexNav.astro` (lines 2042–2051), `setupPageIndex(true)` runs on `astro:after-swap` and then `setupPageIndex(false)` runs a second full TOC rebuild 130ms later on `astro:page-load`. Track the last initialized path+locale so `astro:page-load` only runs lightweight alignment (`alignDesktopIndex()` and `syncResponsiveMode()`) if `astro:after-swap` already rebuilt the TOC for the current route:

```js
var lastSetupSignature = "";

// Pre-Paint Route Sync: astro:after-swap fires before browser paints
document.addEventListener("astro:after-swap", function () {
  setupPageIndex(true);
  lastSetupSignature =
    window.location.pathname +
    "::" +
    (document.documentElement.getAttribute("lang") || "en");
});

document.addEventListener("astro:page-load", function () {
  var currentSig =
    window.location.pathname +
    "::" +
    (document.documentElement.getAttribute("lang") || "en");
  if (lastSetupSignature === currentSig) {
    alignDesktopIndex();
    syncResponsiveMode();
    return;
  }
  if (document.readyState === "complete") {
    setupPageIndex(false);
    lastSetupSignature = currentSig;
  }
});
```

---

## TASK 7: Top-Layer Promotion for `#email-copy-toast` (`ContactSection.astro`) & Compositor-Only Fix (`resume-maker.astro`)

### 7.1 Promote `#email-copy-toast` to Top Layer in `src/components/ui/ContactSection.astro`

Because `<section id="contact">` uses `content-visibility: auto` (which applies `contain: layout style paint`), any `position: fixed` child inside `#contact` is trapped inside the section's containing block unless promoted to the browser Top Layer via `popover="manual"`.
In `src/components/ui/ContactSection.astro`:

1. Add `popover="manual"` to `<div id="email-copy-toast">`:
   ```astro
   <div
     id="email-copy-toast"
     popover="manual"
     role="status"
     aria-live="polite"
     class="pointer-events-none fixed bottom-6 right-6 top-auto left-auto m-0 z-50 flex items-center gap-2.5 rounded border border-[var(--color-accent-gold)] bg-[var(--color-surface-card)] px-4 py-3 font-mono text-xs text-[var(--color-text-primary)] shadow-lg opacity-0 translate-y-2 transition-all duration-200"
   >
   ```
2. In `ContactSection.astro`'s copy handler script, invoke `toast.showPopover()` when showing and `toast.hidePopover()` when hiding (guarded with `typeof toast.showPopover === "function"`):
   ```ts
   if (toast) {
     try {
       if (typeof (toast as any).showPopover === "function") {
         (toast as any).showPopover();
       }
     } catch (_) {}
     toast.classList.remove("opacity-0", "translate-y-2");
     toast.classList.add("opacity-100", "translate-y-0");
   }

   if (toastTimeout) clearTimeout(toastTimeout);
   toastTimeout = window.setTimeout(() => {
     if (toast) {
       toast.classList.add("opacity-0", "translate-y-2");
       toast.classList.remove("opacity-100", "translate-y-0");
       window.setTimeout(() => {
         try {
           if (typeof (toast as any).hidePopover === "function") {
             (toast as any).hidePopover();
           }
         } catch (_) {}
       }, 200);
     }
   }, 2600);
   ```

### 7.2 Replace `transition-[height]` in `src/pages/[...lang]/tools/resume-maker.astro`

In `src/pages/[...lang]/tools/resume-maker.astro` (lines 156 and 199), replace `transition-[height] duration-200` with `transition-colors duration-200` on both auto-expanding `<textarea>` elements so 100% of animations in the repository strictly use compositor-safe or color properties and never animate layout geometry (`height`).

---

## Verification & Quality Gate (Execute Before Completing)

1. **Automated Unit & Spec Test Suite**:
   Run `bun test` (or `pnpm test`) and verify **100% of test suites pass (`0 fail`)**, specifically verifying:
   - `tests/odd-tasks.test.ts` (including `ODD Task 6: Persistent SPA App-Shell & Zero-Jump HUD Architecture` and `Odd Tasks 10 - Core Web Vitals & Mobile Lab Optimization`)
   - `tests/spec-004/spec-004.test.ts`
   - `tests/spec-006/spec-006.test.ts`
   - `tests/spec-007/spec-007.test.ts` (including `SPEC-007 REQ-3: Language banner session isolation` and `SPEC-007 REQ-5: Matrix persistence & SPA navigation`)
   - `tests/spec-009/spec-009.test.ts`
2. **Codebase Architecture Audit**:
   Run `bun run scripts/audit-codebase.ts` (or `npx tsx scripts/audit-codebase.ts`) and ensure **zero architectural violations**.
3. **Production Build Verification**:
   Run `pnpm build` (or `bun run build`) and confirm zero TypeScript, Astro, or Tailwind CSS v4 build errors.
4. **End-to-End SPA Continuity Checklist**:
   - Navigate `/` -> `/projects/` -> `/experience/` -> `/blog/` -> `/services/` -> `/resume/` -> `/es/`:
     - `#matrix-canvas` never clears, flashes opacity, or resets drop coordinates (`::view-transition-old(matrix-background)` is `display: none !important`).
     - Switching theme to Light Mode and navigating across 5+ pages keeps `data-theme="light"` and Matrix light-mode palette intact with zero flash to dark.
     - `#lang-suggestion-banner` animates in at most once per session, updates its `href` to a relative counterpart path on route changes, and never jumps or re-animates.
