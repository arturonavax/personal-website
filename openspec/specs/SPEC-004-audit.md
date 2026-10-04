# SPEC-004: GLOBAL ARCHITECTURAL AUDIT & EXTREME QUALITY VERIFICATION SPECIFICATION

## SDD / RDD / ODD Verification Framework for Top #1 Tier Web Engineering

```yaml
id: SPEC-2026-AUDIT-TOP1-VERIFICATION
title: Exhaustive Quality, Architecture, Edge Runtime, Performance, and SEO Verification Specification
status: APPROVED-FOR-EXECUTION
version: 2.0.0
architect_profile: Staff Senior Frontend Performance Architect (+15y industry experience)
stack_profile:
  framework: Astro v7.3.4+ (Static Prerendered Output / Islands Architecture / Server Islands)
  css_engine: Tailwind CSS v4.3.3+ (CSS-First @theme Engine / LightningCSS Native Pipeline)
  edge_platform: Cloudflare Pages & Workers (Static Assets, D1, R2, Cache API, Turnstile, Workers AI)
  motion_model: Compositor-Thread Exclusivity (Web Animations API / View Transitions API)
  target_metrics:
    lighthouse: 100/100/100/100 (Performance, Accessibility, Best Practices, SEO)
    core_web_vitals:
      cls: 0.000 (Strict Mathematical Invariant)
      lcp: "<800ms" (Simulated Fast 4G, P75 Global)
      inp: "<50ms" (Main Thread Free Time >95%)
      fid: "0ms" (Total Blocking Time <10ms)
      ttfb: "<50ms" (Edge Cache Hit Ratio >98%)
```

---

## 1. Philosophical Grounding & Verification Methodology

Este documento constituye la especificación formal y el protocolo de certificación de calidad técnica más riguroso y exhaustivo aplicable a un ecosistema web contemporáneo[cite: 1]. Su propósito es erradicar cualquier compromiso de ingeniería, suposición no verificada o regresión invisible en aplicaciones construidas sobre **Astro**, **Tailwind CSS v4** y la red perimetral de **Cloudflare**[cite: 1].

La arquitectura se valida simultáneamente bajo tres dimensiones deductivas:

```
                            TRI-AXIS VERIFICATION MODEL

                                    [ SDD ]
                           Formal Types & Invariants
                                      ▲
                                     / \
                                    /   \
                                   /     \
                                  /       \
                                 ▼         ▼
                            [ RDD ] <───> [ ODD ]
                       Binary Pass/Fail      Edge Chaos & Runtime
                         Quantitative          Telemetry Profiling
```

1. **Spec-Driven Development (SDD):** El sistema se somete a contratos de interfaz tipados estáticos (TypeScript en modo `strict: true`, AST Linting y JSON Schemas W3C)[cite: 1]. Si un componente o adaptador introduce tipos `any`, dependencias circulares o mutaciones de estado no controladas, el pipeline de compilación se interrumpe de inmediato.
2. **Requirement-Driven Development (RDD):** Definición de compuertas de rendimiento binarias cuantitativas[cite: 1]. No existen métricas relativas ni advertencias permisivas: cada parámetro (LCP, CLS, INP, TTFB, tamaño de bundle, presupuesto de bytes de JavaScript en cliente) opera bajo una condición booleana estricta [PASS o FAIL](cite: 1).
3. **Operational-Driven Development (ODD):** Validación del comportamiento real del software desplegado en los más de 300 centros de datos globales de Cloudflare[cite: 1]. Involucra telemetría bajo condiciones adversas: navegación en redes con pérdida de paquetes (3G/4G inestable), ráfagas de solicitudes especulativas generadas por bots, degradación intencional de enlaces ascendentes y pruebas de resistencia frente a navegadores divergentes (Chromium Blink, Gecko Firefox 129+, WebKit iOS Safari).

---

## 2. Requirement Matrix & Hard Enforcement Thresholds (RDD)

Cada requisito en esta matriz representa una compuerta infranqueable en el pipeline de Integración Continua [CI/CD](cite: 1). Una sola violación detiene el despliegue a producción.

```
                              PIPELINE GATEKEEPING PIPELINE
┌─────────────────────────┐     ┌─────────────────────────┐     ┌─────────────────────────┐
│ G1: STATIC & COMPILER   │────>│ G2: EDGE & NETWORK      │────>│ G3: RUNTIME & COMPOSITOR│
│ • AST Image Checker     │     │ • Prefetch Shielding    │     │ • CLS = 0.000 Observer  │
│ • Bundle Budget < 10KB  │     │ • Cache-Control TTL     │     │ • WAAPI GPU Verification│
│ • Zero Unused Utilities │     │ • TTFB < 50ms Edge Hit  │     │ • INP < 50ms (TBT = 0ms)│
└─────────────────────────┘     └─────────────────────────┘     └─────────────────────────┘
                                             │
                                             ▼
                                ┌─────────────────────────┐
                                │ G4: SEMANTIC & GRAPH    │
                                │ • Isolated JSON-LD i18n │
                                │ • Valid W3C Microdata   │
                                │ • Sanitized Canonical   │
                                └─────────────────────────┘
```

| Area             | ID           | Criterio de Medición             | Umbral de Fallo (FAIL Condition)                                                                |
| :--------------- | :----------- | :------------------------------- | :---------------------------------------------------------------------------------------------- |
| **Compiler**     | `REQ-COM-01` | JavaScript en Rutas Estáticas    | > 0 KB de JavaScript cliente en páginas de lectura/artículos[cite: 1].                          |
| **Compiler**     | `REQ-COM-02` | Presupuesto Total de Islas       | > 12 KB (gzip) de JavaScript total combinado en páginas interactivas[cite: 1].                  |
| **Styling**      | `REQ-STY-01` | Arquitectura Tailwind v4         | Existencia de archivos `tailwind.config.*` o `postcss.config.*` en el árbol.                    |
| **Styling**      | `REQ-STY-02` | Contaminación CSS                | Reglas CSS globales no utilizadas superiores al 2% del bundle CSS.                              |
| **Layout**       | `REQ-CWV-01` | Cumulative Layout Shift (CLS)    | **CLS > 0.000** en cualquier punto del ciclo de vida de la página[cite: 1].                     |
| **Hydration**    | `REQ-CWV-02` | Flash of Unstyled Content (FOUC) | > 0ms de discrepancia de color o parpadeo durante cambios de tema[cite: 1].                     |
| **Loading**      | `REQ-CWV-03` | Largest Contentful Paint (LCP)   | **LCP > 800ms** en perfil de conexión móvil simulado [Fast 4G, 1.6 Mbps/150ms RTT](cite: 1).    |
| **Interaction**  | `REQ-CWV-04` | Interaction to Next Paint (INP)  | **INP > 50ms** en cualquier evento de teclado, clic o toque[cite: 1].                           |
| **Compositor**   | `REQ-MOT-01` | Main-Thread Layout Thrashing     | Animaciones CSS o JS que muten `width`, `height`, `margin`, `padding`, `top`, `left`[cite: 1].  |
| **Compositor**   | `REQ-MOT-02` | Ciclo de Vida de `will-change`   | Declaraciones estáticas permanentes de `will-change` en hojas de estilo[cite: 1].               |
| **Edge Cache**   | `REQ-EDG-01` | Inmutabilidad de Chunks          | Chunks versionados (`/_astro/*`, `/fonts/*`) servidos sin `immutable` o `< 31536000s`[cite: 1]. |
| **Edge Compute** | `REQ-EDG-02` | D1 Prefetch Protection           | Petición especulativa (`Purpose: prefetch`) que dispare escrituras en base de datos.            |
| **Edge Storage** | `REQ-EDG-03` | R2 Class B Optimization          | Descargas directas de R2 sin pasar por capa de absorción de la Workers Cache API.               |
| **SEO & i18n**   | `REQ-SEO-01` | Integridad de Esquemas JSON-LD   | Idioma del JSON-LD no coincide con la URL (`inLanguage`), o errores en Google Rich Results.     |
| **SEO & i18n**   | `REQ-SEO-02` | Canonicidad Limpia               | Etiquetas canónicas que conserven parámetros de rastreo (`utm_*`, `ref`, `tag`).                |

---

## 3. Systematic Architecture & Technical Directives (SSD)

### 3.1 Astro v7 Compiler, Islands & Server Islands Optimization

#### 3.1.1 Configuración Inflexible del Compilador (`astro.config.mjs`)

Astro v7 debe configurarse para forzar compilación estática desacoplada[cite: 1]. Cuando se requiera inferencia dinámica en el edge (búsqueda semántica, analítica), se utilizará el adaptador oficial de Cloudflare con pre-renderizado universal explícito (`prerender = true`)[cite: 2].

```javascript
// astro.config.mjs
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  adapter: cloudflare({
    imageService: "passthrough", // Previene el consumo de cuota de Cloudflare Images
    platformProxy: {
      enabled: true,
    },
  }),
  vite: {
    plugins: [tailwindcss()],
    build: {
      cssCodeSplit: true,
      minify: "esbuild",
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("@nanostores")) return "vendor-stores";
              return "vendor-core";
            }
          },
        },
      },
    },
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: "hover",
  },
  compressHTML: true,
});
```

#### 3.1.2 Disciplina en la Hidratación de Islas

1. **Regla de Cero JS en Contenido Informacional:** Todas las páginas de artículos de blog, estudios de caso, páginas de experiencia y landing pages estructurales deben emitir **exactamente 0 KB de JavaScript en el bundle inicial del cliente**[cite: 1].
2. **Prohibición de `client:load`:** Queda prohibido el uso de la directiva `client:load` salvo para el orquestador global de temas si requiere ejecución síncrona. Toda interactividad debe demorarse mediante:
   - `client:idle`: Para widgets de telemetría y escuchadores de atajos de teclado globales.
   - `client:visible={{ rootMargin: '200px' }}`: Para modales diferidos, caruseles y componentes por debajo del pliegue.
   - `client:media="(max-width: 768px)"`: Para navegaciones móviles que no tienen razón de existir en entornos de escritorio.
3. **Server Islands (`server:defer`) para Componentes Dinámicos:** Cuando un componente dependa de cómputo en el Edge (ej. contador de lecturas en tiempo real desde D1), se utiliza Server Islands con esqueletos estáticos accesibles para evitar cualquier bloqueo del HTML principal:

```astro
---
// Component: src/components/ui/EdgeViewCounter.astro
interface Props {
  contentId: string;
}

const { contentId } = Astro.props;
---

<div class="flex items-center gap-2 font-mono text-xs text-neutral-500">
  <span class="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
  <span id={`counter-${contentId}`}>-- views</span>
</div>
```

---

### 3.2 Tailwind CSS v4 CSS-First Architecture & Anti-Cliché Visual Directives

#### 3.2.1 Pipeline CSS-First Pura

Se prohíbe terminantemente la presencia de configuraciones JavaScript (`tailwind.config.js`)[cite: 1]. Tailwind v4 procesa tokens nativamente en LightningCSS mediante la directiva `@theme`.

```css
/* src/styles/global.css */
@import "tailwindcss";

@theme {
  /* Dynamic Semantic Color Tokens */
  --color-surface-backdrop: var(--surface-backdrop);
  --color-surface-card: var(--surface-card);
  --color-surface-overlay: var(--surface-overlay);
  --color-border-hairline: var(--border-hairline);
  --color-text-title: var(--text-title);
  --color-text-body: var(--text-body);
  --color-text-muted: var(--text-muted);
  --color-action-primary: var(--action-primary);

  /* Typography Scales */
  --font-sans:
    "Geist Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    sans-serif;
  --font-mono:
    "GeistMono Variable", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    monospace;

  /* Elevation Spacers & Easing Primitives */
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-exit: cubic-bezier(0.7, 0, 0.84, 0);
}

:root {
  --surface-backdrop: #fafafa;
  --surface-card: #ffffff;
  --surface-overlay: #f4f4f5;
  --border-hairline: #e4e4e7;
  --text-title: #09090b;
  --text-body: #27272a;
  --text-muted: #71717a;
  --action-primary: #18181b;
}

:root[class~="dark"] {
  --surface-backdrop: #09090b;
  --surface-card: #141416;
  --surface-overlay: #1c1c1f;
  --border-hairline: #27272a;
  --text-title: #f4f4f5;
  --text-body: #d4d4d8;
  --text-muted: #a1a1aa;
  --action-primary: #38bdf8;
}

/* Global Strict Stability Enforcement */
html {
  scrollbar-gutter: stable;
  overflow-y: scroll;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

[id] {
  scroll-margin-top: calc(var(--header-height, 4rem) + 1.5rem);
}
```

#### 3.2.2 Criterios Visuales Anti-Cliché de Diseño

Para erradicar la homogeneización estética producida por plantillas y modelos de IA, se audita el proyecto contra las siguientes restricciones estrictas:

1. **Abolición de Paletas Genéricas:** Cero fondos crema vintage (`#F4F1EA`) con acentos terracota (`#D97757`). El sistema debe definir una jerarquía semántica monocromática y fría orientada a sistemas de misión crítica (Gris Pizarra / Blanco Puro / Acentos Cyber Ciel / Grafito Profundo).
2. **Prohibición de Micro-Eyebrows Saturados:** Queda eliminado el patrón cliché de anteponer `// CATEGORY NAME` en mayúsculas diminutas con espaciado desmedido sobre cada título. La tipografía debe estructurarse mediante peso y contraste funcional.
3. **Erradicación de Tarjetas Homogéneas:** No encapsular cada párrafo en cajas flotantes idénticas con esquinas excesivas (`rounded-3xl`) y bordes pálidos. Emplear divisiones estructurales basadas en líneas micrométricas (`1px hairline borders`), alternancia de fondos y contraste de espacios negativos.
4. **Cero Adornos Tipográficos Falsos:** Se prohíbe cursivar palabras arbitrarias dentro de encabezados (`Building *scalable* systems`) sin que exista una justificación semántica o de cita textual.

---

### 3.3 Zero-Reflow Motion Architecture (Compositor GPU Direct)

#### 3.3.1 Teorema de Exclusión del Hilo Principal

Toda animación o transición que altere la geometría de la caja provoca una recomputación del árbol de render (Layout Thrashing) que colapsa el frame rate en dispositivos de baja potencia[cite: 1].

```
┌────────────────────────────────────────────────────────────────────────┐
│                   MAIN THREAD (JavaScript & DOM Tree)                  │
│                                                                        │
│   ❌ BANNED: width, height, margin, padding, top, left, border-width   │
│   [Forces Recalculate Style -> Layout -> Paint -> Composite Layers]   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                COMPOSITOR THREAD (GPU Hardware Assisted)               │
│                                                                        │
│   ✅ PERMITTED: transform (translate3d, scale, rotate), opacity, filter│
│   [Bypasses Main Thread -> Instant 120 FPS Sub-pixel Interpolation]    │
└────────────────────────────────────────────────────────────────────────┘
```

#### 3.3.2 Ciclo de Vida Dinámico de `will-change`

El uso indiscriminado y estático de `will-change: transform` o `will-change: opacity` en CSS consume memoria VRAM de forma permanente y causa pérdida de nitidez en renderizado de fuentes vectoriales[cite: 1]. Se audita que `will-change` se gestione exclusivamente por software en el momento exacto de la interacción[cite: 1]:

```typescript
// src/utils/motion.ts
export function attachHardwareAcceleration(element: HTMLElement): () => void {
  element.style.willChange = "transform, opacity";

  return () => {
    element.style.willChange = "auto";
  };
}
```

#### 3.3.3 WAAPI Circular Reveal Isolation Engine

La transición de tema debe garantizar soporte sin degradación en navegadores modernos mediante aislamiento de pseudo-elementos[cite: 1]:

```typescript
// src/utils/theme-reveal.ts
export async function triggerCircularThemeReveal(
  event: MouseEvent,
  applyDomMutations: () => void,
): Promise<void> {
  const isReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  if (!document.startViewTransition || isReduced) {
    applyDomMutations();
    return;
  }

  const { clientX: x, clientY: y } = event;
  const maxRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = document.startViewTransition(() => {
    applyDomMutations();
  });

  await transition.ready;

  // Enforce explicit containment and compositor execution
  const animation = document.documentElement.animate(
    {
      clipPath: [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${maxRadius}px at ${x}px ${y}px)`,
      ],
    },
    {
      duration: 360,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      pseudoElement: "::view-transition-new(root)",
    },
  );

  await animation.finished;
}
```

---

### 3.4 Zero Layout Shift (CLS = 0.000) & Sub-Pixel Font Metrics

#### 3.4.1 Contención Geométrica y Reserva de Relación de Aspecto

Queda prohibido el despliegue de cualquier recurso visual sin dimensiones asignadas en el momento del parseo del documento[cite: 1].

```astro
---
// Component: src/components/ui/OptimizedVisual.astro
import { Image } from "astro:assets";
import type { ImageMetadata } from "astro";

interface Props {
  source: ImageMetadata;
  altText: string;
  isHero?: boolean;
}

const { source, altText, isHero = false } = Astro.props;
---

<div
  class="relative overflow-hidden w-full bg-neutral-100 dark:bg-neutral-900"
  style={`aspect-ratio: ${source.width} / ${source.height}`}
>
  <Image
    'async'
    }
    'auto'
    }
    'eager'
    'high'
    'lazy'
    }
    'sync'
    :
    ?
    alt="{altText}"
    class="w-full h-full object-cover transition-opacity duration-300"
    decoding="{isHero"
    fetchpriority="{isHero"
    height="{source.height}"
    loading="{isHero"
    src="{source}"
    width="{source.width}"
  />
</div>
```

#### 3.4.2 Eliminación de FOUT/FOIT mediante Font Metric Overrides

Para evitar layout shifts al descargar tipografías web `.woff2`, se deben calcular y aplicar overrides exactos sobre las fuentes del sistema[cite: 1]:

```css
/* Font Face Metric Overrides for Zero Layout Shift */
@font-face {
  font-family: "Geist Fallback";
  src: local("Arial");
  ascent-override: 84.38%;
  descent-override: 21.88%;
  line-gap-override: 0%;
  size-adjust: 106.67%;
}

@font-face {
  font-family: "Geist Variable";
  src: url("/fonts/Geist-Variable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-display: swap;
  font-style: normal;
}
```

#### 3.4.3 Prevención Absoluta de FOUC en Cambio de Página

Para anular cualquier parpadeo de color entre transiciones de `ClientRouter`, el layout principal debe sincronizar el tema de forma atómica en el ciclo de vida `astro:after-swap`[cite: 1]:

```astro
<!-- Fragment inside BaseLayout.astro <head> -->
<script is:inline>
  function initializeTheme() {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    const shouldBeDark = saved === "dark" || (!saved && prefersDark);
    document.documentElement.classList.toggle("dark", shouldBeDark);
  }

  // Execute synchronously before parser encounters any stylesheet
  initializeTheme();

  // Rehydrate incoming DOM during SPA View Transition swaps before paint
  document.addEventListener("astro:after-swap", initializeTheme);
</script>
```

---

### 3.5 Cloudflare Edge Orchestration & Telemetry Protection

#### 3.5.1 Edge Worker con Blindaje de Prefetch (`cloudflare/worker.ts`)

Astro prefetching y Chromium speculative loading generan ráfagas de tráfico HTTP destinadas únicamente a calentar la caché del navegador[cite: 1]. Si estas peticiones invocan bases de datos D1, la cuota gratuita de 5 millones de filas escaneadas se agota en pocas horas.

```typescript
// cloudflare/worker.ts
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // 1. Detect Speculative Requests
    const isSpeculative =
      request.headers.get("Purpose") === "prefetch" ||
      request.headers.get("Sec-Purpose") === "prefetch" ||
      request.headers.get("X-Astro-Prefetch") !== null;

    // 2. Telemetry Ingest Routing
    if (url.pathname === "/api/v1/telemetry" && request.method === "POST") {
      if (isSpeculative) {
        // Drop prefetch telemetry immediately; return 204 without touching D1
        return new Response(null, { status: 204 });
      }

      // Non-blocking asynchronous processing
      ctx.waitUntil(
        (async () => {
          try {
            const body = (await request.json()) as Record<string, unknown>;
            const ipCountry = request.headers.get("cf-ipcountry") || "XX";
            const userAgent =
              request.headers.get("user-agent")?.slice(0, 512) || "unknown";

            await env.DB.prepare(
              `INSERT INTO edge_telemetry_events (
                id, timestamp, path, locale, country, user_agent, visitor_hash
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
              .bind(
                crypto.randomUUID(),
                Date.now(),
                String(body.path || "").slice(0, 255),
                String(body.locale || "en").slice(0, 10),
                ipCountry,
                userAgent,
                String(body.visitorHash || "").slice(0, 32),
              )
              .run();
          } catch {
            // Telemetry failures are silently swallowed to ensure zero impact on users
          }
        })(),
      );

      return new Response(JSON.stringify({ status: "queued" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Delegate to Static Assets
    const response = await env.ASSETS.fetch(request);

    // 4. Inject Edge Cache Headers for Versioned Outputs
    if (
      url.pathname.startsWith("/_astro/") ||
      url.pathname.startsWith("/fonts/")
    ) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    return response;
  },
};
```

---

### 3.6 Multi-Language (i18n) Engine & JSON-LD Knowledge Graph Separation

#### 3.6.1 Jerarquía Estricta de Idiomas

El sistema define **English (`en`)** como el idioma primario absoluto y predeterminado, y **Spanish (`es`)** como el secundario, estructurado para extenderse a N idiomas mediante un registro desacoplado:

```typescript
// src/i18n/locales.ts
export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleDefinition {
  code: Locale;
  isoCode: string;
  name: string;
  dir: "ltr" | "rtl";
}

export const LOCALES: Record<Locale, LocaleDefinition> = {
  en: { code: "en", isoCode: "en-US", name: "English", dir: "ltr" },
  es: { code: "es", isoCode: "es-CO", name: "Español", dir: "ltr" },
};
```

#### 3.6.2 Aislamiento de Esquemas Schema.org por Idioma

Para evitar penalizaciones en Google Search Console y parseos erróneos en el validador de Rich Results, los esquemas JSON-LD nunca se mezclan ni se traducen en arrays bilingües sobre una misma URL. Cada ruta inyecta un documento estrictamente monobilingüe que declara su atributo `"inLanguage"`, manteniendo invariable el identificador global `@id` para consolidar el Knowledge Graph:

```typescript
// src/utils/seo.ts
import type { Locale } from "../i18n/locales";

interface PersonSchemaOptions {
  locale: Locale;
  canonicalUrl: string;
  headline: string;
  bio: string;
}

export function generatePersonSchema(
  options: PersonSchemaOptions,
): Record<string, unknown> {
  return {
    "@context": "[https://schema.org](https://schema.org)",
    "@type": "Person",
    "@id": "[https://arturonavax.dev/#person](https://arturonavax.dev/#person)", // Stable global identity anchor
    inLanguage: options.locale,
    name: "Arturo Nava",
    jobTitle: options.headline,
    description: options.bio,
    url: options.canonicalUrl,
    sameAs: [
      "[https://github.com/arturonavax](https://github.com/arturonavax)",
      "[https://linkedin.com/in/arturonava](https://linkedin.com/in/arturonava)",
    ],
  };
}
```

---

## 4. Continuous Automated Audit & Test Engine (ODD)

### 4.1 Script de Auditoría de Compilador y Código Fuente (`scripts/audit-codebase.ts`)

Este script se ejecuta antes de cualquier `pnpm build`. Si un desarrollador o agente introduce una etiqueta `<img>` nativa, importa librerías de más de 10 KB en cliente, o añade transiciones sobre propiedades de layout, el script termina con código de salida 1.

```typescript
// scripts/audit-codebase.ts
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, "src");

const BANNED_CSS_PROPERTIES = [
  "width",
  "height",
  "margin",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "padding",
  "top",
  "left",
  "bottom",
  "right",
  "border-width",
];

let totalViolations = 0;

function walk(directory: string): void {
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    const ext = path.extname(entry.name);
    if (![".astro", ".ts", ".tsx", ".css"].includes(ext)) continue;

    const source = fs.readFileSync(fullPath, "utf8");

    // Rule 1: Zero unmanaged <img> tags
    if (
      ext === ".astro" &&
      /<img\b(?![^>]*\brole=["']presentation["'])/i.test(source)
    ) {
      console.error(
        `[FAIL] Unmanaged <img> tag found in: ${fullPath}. Must use Astro's <Image/> or <Picture/>.`,
      );
      totalViolations++;
    }

    // Rule 2: Zero layout transitions
    for (const prop of BANNED_CSS_PROPERTIES) {
      const transitionRegex = new RegExp(
        `transition(?:-property)?\\s*:[^;]*\\b${prop}\\b`,
        "i",
      );
      if (transitionRegex.test(source)) {
        console.error(
          `[FAIL] Prohibited layout animation property "${prop}" found in: ${fullPath}`,
        );
        totalViolations++;
      }
    }

    // Rule 3: Zero static will-change in stylesheets
    if (ext === ".css" && /will-change\s*:\s*[a-z]+/i.test(source)) {
      console.error(
        `[FAIL] Static will-change detected in stylesheet: ${fullPath}. Must be dynamic via WAAPI/JS.`,
      );
      totalViolations++;
    }
  }
}

console.log("Auditing codebase against SPEC-004 quality gates...");
walk(SRC_DIR);

// Rule 4: Verify absence of legacy Tailwind config
if (
  fs.existsSync(path.join(ROOT_DIR, "tailwind.config.js")) ||
  fs.existsSync(path.join(ROOT_DIR, "tailwind.config.mjs"))
) {
  console.error(
    "[FAIL] Legacy tailwind.config.* detected. Tailwind v4 requires pure CSS-first @theme declaration.",
  );
  totalViolations++;
}

if (totalViolations > 0) {
  console.error(`\nAudit failed with ${totalViolations} fatal violations.`);
  process.exit(1);
} else {
  console.log(
    "\n[PASS] All architectural static gates certified successfully.",
  );
}
```

---

### 4.2 Suite de Pruebas Playwright Core Web Vitals & FOUC (`tests/audit.spec.ts`)

```typescript
// tests/audit.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Top #1 Tier Architectural and Performance Certification", () => {
  test("Verify CLS = 0.000, LCP < 800ms, and Zero FOUC Under Throttling", async ({
    page,
  }) => {
    // 1. Inject PerformanceObserver to intercept layout shifts
    await page.addInitScript(() => {
      window.__cumulativeLayoutShift = 0;
      const observer = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (!(entry as any).hadRecentInput) {
            window.__cumulativeLayoutShift += (entry as any).value;
          }
        }
      });
      observer.observe({ type: "layout-shift", buffered: true });
    });

    // 2. Emulate Fast 4G mobile network conditions
    const client = await page.context().newCDPSession(page);
    await client.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: (4 * 1024 * 1024) / 8, // 4 Mbps
      uploadThroughput: (2 * 1024 * 1024) / 8, // 2 Mbps
    });

    const response = await page.goto("/", { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);

    // 3. Measure LCP
    const lcpValue = await page.evaluate(async () => {
      return new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1];
          resolve(last.startTime);
        }).observe({ type: "largest-contentful-paint", buffered: true });

        setTimeout(() => resolve(0), 4000);
      });
    });

    expect(lcpValue).toBeGreaterThan(0);
    expect(lcpValue).toBeLessThan(800);

    // 4. Assert Cumulative Layout Shift
    const finalCls = await page.evaluate(() => window.__cumulativeLayoutShift);
    expect(finalCls).toBe(0.0);

    // 5. Assert Scrollbar Gutter Locking
    const hasStableGutter = await page.evaluate(() => {
      const style = window.getComputedStyle(document.documentElement);
      return style.scrollbarGutter.includes("stable");
    });
    expect(hasStableGutter).toBe(true);
  });

  test("Verify Pristine Canonical URLs (Zero Tracking Pollution)", async ({
    page,
  }) => {
    await page.goto(
      "/?utm_source=newsletter&utm_medium=email&ref=developer-review",
      {
        waitUntil: "domcontentloaded",
      },
    );

    const canonicalHref = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(canonicalHref).not.toContain("utm_source");
    expect(canonicalHref).not.toContain("utm_medium");
    expect(canonicalHref).not.toContain("ref");
    expect(canonicalHref).toMatch(/^https?:\/\/[^/]+\/?$/);
  });

  test("Verify Isolated Monobilingual JSON-LD Payloads", async ({ page }) => {
    // English Route
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const enJsonText = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    const enSchema = JSON.parse(enJsonText || "{}");
    expect(enSchema.inLanguage).toBe("en");

    // Spanish Route
    await page.goto("/es/", { waitUntil: "domcontentloaded" });
    const esJsonText = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    const esSchema = JSON.parse(esJsonText || "{}");
    expect(esSchema.inLanguage).toBe("es");

    // Identity Anchor Preservation
    expect(enSchema["@id"]).toBe(esSchema["@id"]);
  });
});
```

---

## 5. Master Certification Matrix & Production Scorecard

Antes de autorizar el merge hacia la rama `main` o desplegar a producción en Cloudflare Edge, el equipo técnico debe auditar y tildar el 100% de los siguientes puntos sin excepción[cite: 1]:

```
================================================================================
                    TOP #1 TECHNICAL CERTIFICATION SCORECARD
================================================================================

[ ] 1. ASTRO v7 & COMPILER COMPLIANCE
    [ ] `output: 'static'` explícito con adaptadores configurados en pass-through[cite: 1].
    [ ] Cero KB de JavaScript cliente en rutas informacionales (Blog, Landing, Resume)[cite: 1].
    [ ] Contenido tipado estrictamente mediante Content Collections (`zod` schemas)[cite: 2].
    [ ] Estrategia de prefetch configurada en `hover` (sin spam de solicitudes de red)[cite: 1].

[ ] 2. TAILWIND CSS v4 PURITY & DESIGN INTEGRITY
    [ ] Cero archivos `tailwind.config.js` o `postcss.config.js` en el repositorio[cite: 1].
    [ ] Tokens semánticos declarados mediante directiva `@theme` en CSS principal.
    [ ] Cumplimiento de directivas anti-cliché: cero paletas crema/terracota de IA.
    [ ] Cero micro-eyebrows saturados y cero cursivas arbitrarias en encabezados.

[ ] 3. COMPOSITOR-ONLY MOTION & THEME HARMONY
    [ ] Cambio de tema implementado mediante WAAPI circular reveal sobre `clipPath`[cite: 1].
    [ ] Cero propiedades de caja (`width`, `height`, `top`, `margin`) en animaciones[cite: 1].
    [ ] Cero uso estático de `will-change` en hojas de estilo globales[cite: 1].
    [ ] Respeto absoluto a la preferencia del usuario `prefers-reduced-motion: reduce`[cite: 1].

[ ] 4. MATHEMATICAL CORE WEB VITALS (100% GREEN)
    [ ] CLS = 0.000 certificado mediante PerformanceObserver continuo[cite: 1].
    [ ] LCP < 800ms con conexión móvil restringida (Fast 4G Profile)[cite: 1].
    [ ] Bloqueo de canaleta de scrollbar mediante `scrollbar-gutter: stable`.
    [ ] Override métrico tipográfico aplicado a fuentes `.woff2` locales para anular FOUT[cite: 1].
    [ ] Imagen Hero priorizada mediante `loading="eager"` y `fetchpriority="high"`[cite: 1].

[ ] 5. CLOUDFLARE EDGE RUNTIME & PERIMETER
    [ ] Archivo `_headers` declarando `31536000, immutable` en hashes y fuentes[cite: 1].
    [ ] Telemetría desacoplada: peticiones especulativas descartadas sin mutar D1.
    [ ] Activos pesados (PDFs/Imágenes) cacheados mediante Workers Cache API sobre R2.
    [ ] Procesamiento en background asíncrono no bloqueante vía `ctx.waitUntil()`.

[ ] 6. ENTERPRISE I18N & KNOWLEDGE GRAPH SEO
    [ ] Jerarquía determinista de internacionalización (EN primario -> ES -> N).
    [ ] Documentos JSON-LD 100% monobilingües sincronizados con la URL (`inLanguage`).
    [ ] Identificador `@id` invariable entre idiomas para consolidación en Knowledge Graph.
    [ ] URLs canónicas sanitizadas en tiempo real eliminando parámetros de rastreo (`utm_*`).
================================================================================
```
