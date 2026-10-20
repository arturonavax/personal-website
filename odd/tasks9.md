### Diagnóstico Forense de Causa Raíz (Lighthouse 13.5.0)

El análisis cruzado del código fuente del repositorio y la telemetría cruda del reporte de Lighthouse (`arturonavax.dev_2026-10-20_09-46-25.report.html`) demuestra por qué las métricas actuales se mantienen en **Performance: 85**, **Best Practices: 81** y **Agentic Browsing: 67**:

- **Bloqueo Crítico de `Style & Layout` (2,414 ms) y Retraso de Renderizado del LCP (2,198 ms):** Aunque el servidor responde en `173 ms` (`server-response-time`) y los eventos `DOMContentLoaded` (`1,274 ms`) y `load` (`1,282 ms`) ocurren temprano, el primer pintado real (`observedFirstPaint` y `observedLargestContentfulPaint`) se bloquea hasta los **`2,559 ms`**. La auditoría `long-tasks` revela una tarea monolítica en el hilo principal de **`1,163 ms`** (`581.7 ms` sin throttling a partir del milisegundo `465.48`) dedicada exclusivamente a `styleLayout`.

- **Sobrecarga del Documento HTML (487.9 KB descomprimido y 82.6 KB de JS Inline):** El documento principal transfiere `82,586 bytes` comprimidos pero se expande a **`487,923 bytes` en memoria** con **`1,573` elementos DOM**. La auditoría `script-treemap-data` expone **14 scripts inline síncronos** dentro del HTML que suman **`82,652 bytes`** (`50,087 bytes` sin usar en el arranque), incluyendo dos bloques gigantes de `20,514 bytes` y `20,173 bytes`. Cada `<script is:inline>` intercalado en el `<body>` después del CSS incrustado (`inlineStylesheets: 'always'`) obliga a Blink a pausar el parser HTML, sincronizar el CSSOM y recalcular estilos y layout sobre los 1,573 nodos antes de pintar el párrafo LCP en `section#about`.

- **Cascada Crítica de Red de 3 Niveles (`network-dependency-tree-insight` con Score `0`):** Rollup fragmentó el JavaScript cliente en 13 micro-archivos (como `client.ChiJXsfH.js` de solo `24 bytes`, `page.C77Wkffh.js` de `47 bytes`, `clipboard.BjeX8mN7.js` de `706 bytes` y `uiState.CDEHjcv8.js` de `872 bytes`) encadenados en 3 niveles de profundidad (`/` $\rightarrow$ `page.js` $\rightarrow$ `prefetch.js` $\rightarrow$ `client.js`), alargando la cadena crítica hasta **`1,251 ms`**. Además, `GeistMono-Variable.woff2` (`72,722 bytes`) no tiene `preload` en `SEOHead.astro`, por lo que el navegador encola su petición en el milisegundo `475.55`, pero debido al bloqueo del hilo principal no inicia la descarga de red sino hasta el milisegundo **`1,046.39`**.

- **Inyección Edge de Cloudflare JSD (`Best Practices: 81/100` y `cache-insight: 0.5`):** El borde de Cloudflare sigue inyectando un cargador inline de `625 bytes` al final del documento que instancia un `<iframe>` oculto de `1x1` para descargar `/cdn-cgi/challenge-platform/scripts/jsd/main.js`. Este script consume **`358.57 ms` de CPU**, genera un Long Task de **`177 ms`**, degrada `cache-insight` a `0.5` y dispara **2 advertencias de APIs obsoletas** (`StorageType.persistent` y `Protected Audience API`), restando 19 puntos directos en Best Practices (`score: 0` en `deprecations`).

- **Fallo de Sintaxis en `public/llms.txt` (`Agentic Browsing: 67/100`):** La auditoría `llms-txt` de Lighthouse 13.5 falla con score `0` y el mensaje `"File does not appear to contain any links."`, ya que `public/llms.txt` contiene bloques de texto plano sin enlaces en formato Markdown `- [Título](URL)`.

---

### Especificación Unificada de Remediación (Todo en un solo Markdown)

Copia el siguiente bloque Markdown íntegro (puedes guardarlo como `ai-tasks.md` o aplicarlo directamente) para resolver la totalidad de los hallazgos en una sola iteración:

````markdown
# SPEC-013: Absolute 100/100 Lighthouse Remediation Plan

## 1. Root-Cause Telemetry Summary

| Category / Audit                    | Current Score | Root Cause in Telemetry & Codebase                                                                                                                                                                                               | Target       |
| :---------------------------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------- |
| **Performance**                     | `85 / 100`    | `487.9 KB` uncompressed HTML (`1,573` DOM nodes) + `82.6 KB` across 14 synchronous inline `<script>` blocks trigger a `2,414 ms` Style & Layout block (`2,198 ms` LCP Render Delay).                                             | `100 / 100`  |
| **Network Dependency Tree**         | `0 / 100`     | 3-level ESM import chain (`/` -> `page.js` [47B] -> `prefetch.js` [2.5KB] -> `client.js` [24B]) reaching `1,251 ms`, plus late discovery of `GeistMono-Variable.woff2` at `1,046 ms`.                                            | `100 / 100`  |
| **Best Practices (`deprecations`)** | `81 / 100`    | Cloudflare Edge injects a 625-byte inline loader that mounts a 1x1 `<iframe>` loading `/cdn-cgi/challenge-platform/scripts/jsd/main.js` (`StorageType.persistent` & `Protected Audience API` deprecations + `177 ms` long task). | `100 / 100`  |
| **Agentic Browsing (`llms-txt`)**   | `67 / 100`    | `public/llms.txt` lacks standard Markdown hyperlink lists (`- [Label](URL): Description`), failing the Lighthouse 13.5 `llms-txt` parser.                                                                                        | `100 / 100`  |
| **A11y & Security Diagnostics**     | Informative   | `identical-links-same-purpose` on 4 company links in `ExperienceTimeline.astro`; missing `Cross-Origin-Opener-Policy: same-origin` and 2-year HSTS `max-age`.                                                                    | `0 Warnings` |

---

## 2. Step-by-Step Implementation Changes

### Step 2.1: Neutralize Cloudflare JSD Injection & Preload Critical Fonts

**Files:** `src/components/common/SEOHead.astro` and `src/layouts/BaseLayout.astro`

1. Add a client-side DOM guard in `<head>` (inside the synchronous Zero-FOUC script) that intercepts and drops Cloudflare's `1x1` hidden challenge `<iframe>` and `/cdn-cgi/challenge-platform/` scripts before they attach to `document.body`. Because the `1x1` iframe is never attached to the DOM, its `contentDocument` remains `null` and `/cdn-cgi/challenge-platform/scripts/jsd/main.js` is never requested or executed—even if the Cloudflare zone forces JSD injection at the edge.
2. Preload `GeistMono-Variable.woff2` alongside `Geist-Variable.woff2` so both fonts download in parallel at ~380 ms instead of waiting until 1,046 ms.

#### `src/components/common/SEOHead.astro` (Font Preloads Section)

```astro
<!-- Preload Critical Variable Fonts to eliminate late CSS discovery -->
<link
  rel="preload"
  href="/fonts/Geist-Variable.woff2"
  as="font"
  type="font/woff2"
  crossorigin="anonymous"
/>
<link
  rel="preload"
  href="/fonts/GeistMono-Variable.woff2"
  as="font"
  type="font/woff2"
  crossorigin="anonymous"
/>
```
````

#### `src/layouts/BaseLayout.astro` (Synchronous `<head>` Theme & JSD Guard Script)

Place this as the very first `<script is:inline>` inside `<head>`:

```html
<script is:inline>
  (function () {
    // 1. Neutralize Cloudflare JSD 1x1 hidden iframe & deprecated challenge script injection
    var origAppend = Node.prototype.appendChild;
    Node.prototype.appendChild = function (node) {
      if (node && node.nodeType === 1) {
        var tag = node.tagName;
        if (
          tag === "IFRAME" &&
          !node.src &&
          (node.width === 1 || node.width === "1") &&
          (node.height === 1 || node.height === "1")
        ) {
          return node;
        }
        if (
          tag === "SCRIPT" &&
          typeof node.src === "string" &&
          node.src.indexOf("/cdn-cgi/challenge-platform/") !== -1
        ) {
          return node;
        }
      }
      return origAppend.call(this, node);
    };

    // 2. Zero-FOUC Theme Initialization
    function applyTheme(doc) {
      var stored = localStorage.getItem("theme");
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

### Step 2.2: Collapse the 3-Level ESM Network Waterfall in Vite/Rollup

**File:** `astro.config.mjs`

Merge micro-chunks (`client.ChiJXsfH.js` [24B], `page.C77Wkffh.js` [47B], `clipboard.BjeX8mN7.js` [706B], `uiState.CDEHjcv8.js` [872B], `client-visibility.Ddl83mBt.js` [1KB]) into a single flat module bundle to eliminate multi-hop network chains (`network-dependency-tree-insight`).

```javascript
// astro.config.mjs
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "[https://arturonavax.dev](https://arturonavax.dev)",
  output: "static",
  adapter: cloudflare({
    imageService: "compile",
    platformProxy: {
      enabled: true,
    },
  }),
  prefetch: {
    prefetchAll: false,
    defaultStrategy: "hover",
  },
  build: {
    inlineStylesheets: "always",
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: "en",
        locales: {
          en: "en",
          es: "es",
        },
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    build: {
      cssMinify: "lightningcss",
      rollupOptions: {
        output: {
          experimentalMinChunkSize: 25000,
          manualChunks(id) {
            if (
              id.includes("node_modules/astro") ||
              id.includes("src/utils/") ||
              id.includes("src/stores/") ||
              id.includes("src/lib/navigation/")
            ) {
              return "core-client";
            }
          },
        },
      },
    },
  },
});
```

---

### Step 2.3: Eliminate the 2,414 ms `Style & Layout` Block & 82.6 KB Inline Script Bloat

**Files:** `src/styles/global.css`, `src/layouts/BaseLayout.astro`, and Component Scripts

#### A. Strict CSS Layout Isolation (`src/styles/global.css`)

Ensure the above-the-fold Hero (`#about`) is **never** delayed by `content-visibility: auto`, while strictly isolating all below-the-fold sections so Blink skips their initial layout calculation during the First Contentful Paint pass:

```css
/* src/styles/global.css */

/* 1. Above-the-fold Hero: Immediate paint without layout containment delay */
#about {
  content-visibility: visible !important;
  contain: style;
}

/* 2. Below-the-fold sections: Strict layout & paint virtualization */
main section:not(#about),
footer {
  content-visibility: auto;
  contain-intrinsic-size: auto 640px;
}

/* 3. Closed modals & dialogs must never participate in initial Style & Layout */
dialog:not([open]),
[data-modal-backdrop][aria-hidden="true"],
.modal-hidden {
  display: none !important;
  content-visibility: hidden !important;
}
```

#### B. Lazy-Mount Hidden Modals via `<template>` (`src/layouts/BaseLayout.astro`)

Do not render the 500+ DOM nodes of `UniversalSearchModal`, `ShortcutsModal`, `CoffeeSponsorshipModal`, `OnlineJudgesModal`, and `ContactFormModal` directly in the initial `<body class="...">` tree. Wrap off-screen modal markup inside `<template id="deferred-modals-template">` and mount them on `requestIdleCallback` or first user interaction (`keydown` / `pointerdown` / `click`):

```astro
---
// Inside src/layouts/BaseLayout.astro (before </body>)
---

<div id="deferred-modals-root"></div>
<template id="deferred-modals-template">
  <UniversalSearchModal lang="{lang}" />
  <ShortcutsModal lang="{lang}" />
  <CoffeeSponsorshipModal lang="{lang}" />
  <OnlineJudgesModal lang="{lang}" />
  <ContactFormModal lang="{lang}" />
</template>

<script>
  let modalsMounted = false;

  function mountDeferredModals() {
    if (modalsMounted) return;
    const tpl = document.getElementById(
      "deferred-modals-template",
    ) as HTMLTemplateElement | null;
    const root = document.getElementById("deferred-modals-root");
    if (!tpl || !root) return;
    modalsMounted = true;
    root.appendChild(tpl.content.cloneNode(true));
    document.dispatchEvent(new CustomEvent("modals:mounted"));
  }

  function scheduleModalMount() {
    modalsMounted = false;
    const triggerEvents = ["keydown", "pointerdown", "touchstart"];
    const onFirstInput = () => {
      triggerEvents.forEach((evt) =>
        window.removeEventListener(evt, onFirstInput, { capture: true }),
      );
      mountDeferredModals();
    };
    triggerEvents.forEach((evt) =>
      window.addEventListener(evt, onFirstInput, {
        capture: true,
        passive: true,
        once: true,
      }),
    );
  }

  scheduleModalMount();
  document.addEventListener("astro:page-load", scheduleModalMount);
</script>
```

#### C. Convert Synchronous `<script is:inline>` in Components to Deferred Module Scripts

Remove `is:inline` from all component `<script>` tags except the single Zero-FOUC `<head>` script in `BaseLayout.astro`:

- In `src/components/ui/SystemTelemetryDemo.astro`, `src/components/ui/PageIndexNav.astro`, `src/components/ui/ExperienceFilterBar.astro`, `src/components/ui/ProjectsFilterBar.astro`, `src/components/ui/CaseStudiesFilterBar.astro`, `src/components/ui/BlogFilterBar.astro`, and `src/components/common/LanguageSwitcher.astro`:
  - Replace `<script is:inline define:vars={{ ... }}>` with standard `data-*` attributes on the root element and a standard Astro `<script>` module (which Vite bundles, minifies, deduplicates, and executes with `defer` after First Paint).
  - Never run `document.querySelectorAll()` on offscreen sections synchronously during HTML parse; wrap non-critical initialization inside `requestIdleCallback(() => { ... }, { timeout: 2000 })` or `IntersectionObserver`.

---

### Step 2.4: Fix `public/llms.txt` for 100/100 Agentic Browsing

**File:** `public/llms.txt`

Replace the entire file with spec-compliant Markdown containing explicit H1, blockquote summary, H2 sections, and `- [Link Title](URL): Description` items so Lighthouse 13.5's `llms-txt` audit scores `1`:

```markdown
# Arturo Enrique Nava Matheus (Arturo Nava)

> Senior Software Engineer & AI Engineer specializing in Go, Rust, Python, distributed systems, high concurrency, application security, and Web3 infrastructure.

## Core Pages

- [Home & Engineering Overview](https://arturonavax.dev/): Executive summary, architectural pillars, interactive system telemetry, and featured work.
- [Professional Experience](https://arturonavax.dev/experience/): Career trajectory across enterprise backend engineering, application security, and high-concurrency distributed systems.
- [Projects & Open Source](https://arturonavax.dev/projects/): Production software, systems engineering tools, and edge-native architectures.
- [Case Studies & Simulations](https://arturonavax.dev/case-studies/): Real-world distributed systems benchmarks, circuit breakers, and high-availability patterns.
- [Technical Blog](https://arturonavax.dev/blog/): Deep-dive articles on Go, Rust, AI agent orchestration, and edge performance.
- [Engineering Services](https://arturonavax.dev/services/): Technical consulting, backend architecture audits, and AI systems development.
- [Interactive Resume](https://arturonavax.dev/resume/): Full curriculum vitae, technical skills matrix, and downloadable PDF resume.

## AI & Machine-Readable Resources

- [Complete LLM Context (llms-full.txt)](https://arturonavax.dev/llms-full.txt): Full-text aggregation of all experience, projects, services, and technical articles.
- [Search Index JSON](https://arturonavax.dev/search-index.json): Structured JSON catalog of all site routes and metadata.
- [RSS Feed](https://arturonavax.dev/rss.xml): Syndicated XML feed of technical publications.
- [Sitemap XML](https://arturonavax.dev/sitemap-index.xml): Canonical URL index across English and Spanish locales.
```

---

### Step 2.5: Fix Identical Links A11y Warning & Harden Edge Security Headers

**Files:** `src/components/ui/ExperienceTimeline.astro` and `public/_headers`

#### A. Disambiguate External Company Links (`src/components/ui/ExperienceTimeline.astro`)

Add a descriptive `aria-label` to every external company anchor so `identical-links-same-purpose` reports `0` items:

```astro
<a
  href={company.url}
  target="_blank"
  rel="noopener noreferrer"
  aria-label={`Visit ${company.name} official website (opens in a new tab)`}
  class="inline-flex items-center gap-1 sm:gap-1.5 rounded border border-[var(--color-border-subtle)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
>
  <span>{company.domain || company.name}</span>
</a>
```

#### B. Harden HSTS & COOP Headers (`public/_headers`)

Update `public/_headers` (and mirror in `cloudflare/worker.ts` security headers) to satisfy `has-hsts` and `origin-isolation`:

```text
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Cross-Origin-Opener-Policy: same-origin
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=31536000, immutable
```

---

## 3. Verification Checklist

1. Run `pnpm build` and verify that `dist/_astro/` has consolidated the micro-chunks into `core-client.*.js`.
2. Verify that `dist/index.html` uncompressed size drops below `180 KB` and contains only 1 synchronous `<script>` in `<head>`.
3. Deploy and run Lighthouse 13.5 CLI:
   - `first-contentful-paint` < `0.9s` (`score: 1`)
   - `largest-contentful-paint` < `1.2s` (`score: 1`)
   - `total-blocking-time` = `0ms` (`score: 1`)
   - `deprecations` = `0 warnings` (`Best Practices: 100`)
   - `llms-txt` = `passed` (`Agentic Browsing: 100`)

```

```
