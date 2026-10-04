# SPEC-001: ARQUITECTURA ENTERPRISE EDGE, RUTAS DINÁMICAS i18n Y RENDIMIENTO SPA

## Especificación Arquitectónica de Alto Rendimiento, Cero Duplicación de Código y Optimización Perimetral en Cloudflare

```yaml
id: SPEC-001-ARCH-EDGE-I18N
title: Enterprise Astro Edge Architecture, Zero-Duplication i18n & Cloudflare Infrastructure
status: APPROVED / IMPLEMENTED
version: 2.0.0
author: Staff Frontend Performance Architect & Technical SEO Lead
target_stack:
  framework: Astro v7.3.4+ (Compilación Estática Pura / ClientRouter)
  styling: Tailwind CSS v4.3.3+ (CSS-First @theme Engine / LightningCSS)
  runtime: Cloudflare Edge (Workers Static Assets, Pages, D1 Database, Cache API)
  architecture: Hexagonal / Decoupled Ports & Adapters
  locales: [en, es] (EN Primario por defecto -> ES Secundario -> Extensible N)
methodology: Tri-Axis Model — Spec-Driven Development (SDD), Requirement-Driven Development (RDD) & Organic/Operational-Driven Development (ODD)
cross_references:
  spec_001: openspec/specs/SPEC-001-big-refactor.md
  spec_002: openspec/specs/SPEC-002-general-tasks.md
  spec_003: openspec/specs/SPEC-003-future-improves.md
  spec_004: openspec/specs/SPEC-004-audit.md
```

---

## 1. Resumen Ejecutivo, Diagnóstico y Alineación Metodológica

### 1.1. Contexto y Diagnóstico del Sistema

El ecosistema web de portafolio y consultoría técnica de alto nivel enfrentaba una serie de desafíos arquitectónicos que comprometían su escalabilidad, mantenibilidad y rendimiento en producción:

1. **Duplicación Crítica en Capa de Rutas (`src/pages/` vs `src/pages/es/`):**
   - El proyecto replicaba 14 archivos `.astro` completos entre la raíz y el subdirectorio `es/` (`index`, `blog/*`, `projects/*`, `experience/*`, `services/*`, `resume`, `links`, `search`, `case-studies`).
   - Dicha redundancia multiplicaba el costo de mantenimiento por $2\times$, inducía divergencias de UI/SEO (atributos `aria-*`, micro-interacciones) y anulaba la escalabilidad ante la incorporación de futuros idiomas (`pt`, `de`, `fr`).
2. **Fugas de Memoria e Incompatibilidad con View Transitions (`ClientRouter`):**
   - Múltiples componentes interactivos (`MatrixBackground.astro`, `SystemTelemetryDemo.astro`, `UniversalSearchModal.astro`, `ShortcutsModal.astro`, `BlogFilterBar.astro`) instanciaban scripts imperativos huérfanos mediante listeners globales en `document` o bucles `requestAnimationFrame`/`setInterval`.
   - En navegaciones SPA, los listeners no se liberaban y los bucles de renderizado continuaban ejecutándose en segundo plano, degradando el **INP (Interaction to Next Paint)** e incrementando el consumo de memoria heap en el cliente.
3. **Acoplamiento Directo al Sistema de Archivos Local (`src/content/`):**
   - El Content Layer utilizaba cargadores `glob()` estrictamente atados a la estructura de carpetas física (`src/content/posts/en/*.md`).
   - Se requería una capa abstracta de repositorio que permitiera bifurcar o migrar progresivamente las fuentes de datos hacia Cloudflare R2, CMS headless o bases de datos SQLite en el Edge (Cloudflare D1).
4. **Monolito de Scripting sin Aislamiento de Ciclo de Vida:**
   - La lógica de filtrado manipulaba el DOM sin sincronización reactiva, careciendo de un gestor de micro-estado atómico ultraligero (<1.5KB) como `@nanostores/core` para comunicar modales, búsqueda y telemetría.
5. **Optimización de Caché y Headers en el Edge de Cloudflare:**
   - El archivo `public/_headers` carecía de directivas estrictas de inmutabilidad (`public, max-age=31536000, immutable`) para bundles generados por Vite (`/_astro/*`) y tipografías locales, provocando revalidaciones innecesarias (`304 Not Modified`).

### 1.2. Marco Metodológico Tri-Axis: SDD, RDD y ODD

Para garantizar una ingeniería de software con cero regresiones, esta especificación se rige bajo el modelo de tres ejes:

```
                            TRI-AXIS METHODOLOGY MODEL
                                    [ SDD ]
                           Contratos y Tipado Estricto
                                       ▲
                                      / \
                                     /   \
                                    /     \
                                   ▼       ▼
                              [ RDD ] <──> [ ODD ]
                         Requerimientos   Validación Perimetral
                           Cuantitativos    en Tiempo Real
```

- **Spec-Driven Development (SDD):** Modelado formal previo de tipos, contratos de rutas y abstracciones de interfaz en TypeScript estricto.
- **Requirement-Driven Development (RDD):** Definición binaria de requerimientos funcionales (`REQ-01` a `REQ-05`) y compuertas cuantitativas de fallo.
- **Organic/Operational-Driven Development (ODD):** Validación operativa continua en los más de 300 centros de datos de Cloudflare Edge, verificando comportamiento en frío, tiempos de respuesta sub-segundo y navegación fluida sin memory leaks.

### 1.3. Matriz de Trazabilidad y Referencias Cruzadas entre Especificaciones

Esta especificación actúa como el **cimiento estructural** de toda la plataforma web, conectándose bidireccionalmente con el resto de las especificaciones:

- **Hacia [SPEC-002: Refactorización General y Resume Studio](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-002-general-tasks.md):** SPEC-001 provee el sistema de rutas unificadas `[...lang]` sobre el cual SPEC-002 monta la división modular de `/resume/` y `/resume/maker/`, el protocolo de portapapeles accesible y la exclusión de peticiones especulativas de prefetch.
- **Hacia [SPEC-003: Arquitectura Hexagonal y Cloudflare Edge Desacoplado](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-003-future-improves.md):** SPEC-001 define las interfaces iniciales de repositorio y telemetría que SPEC-003 formaliza integralmente en puertos de dominio puros (`StoragePort`, `TelemetryPort`, `SearchEnginePort`) y adaptadores perimetrales para R2, D1 y Vectorize.
- **Hacia [SPEC-004: Auditoría Arquitectónica Global y Verificación Extrema](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-004-audit.md):** SPEC-004 somete los invariantes de SPEC-001 (presupuesto de 0 KB JS cliente, transiciones SPA sin layout shifts, headers inmutables) a compuertas de análisis estático automatizado (`scripts/audit-codebase.ts`) y pruebas Playwright.

---

## 2. Matriz de Requerimientos y Compuertas Cuantitativas (RDD)

### 2.1. Requerimientos Funcionales y Técnicos (REQ-*)

#### REQ-01: Motor i18n con Cero Duplicación de Código
- **R1.1:** Las rutas deben definirse mediante parámetros dinámicos unificados (`src/pages/[...lang]/...`), reduciendo las páginas físicas de 28 a 14.
- **R1.2:** Toda ruta debe resolver canónicos absolutos y etiquetas `hreflang` bidireccionales en tiempo de compilación estática (SSG).
- **R1.3:** La traducción de etiquetas UI debe ser estricta mediante TypeScript Generics con auto-completado y detección de claves faltantes en tiempo de compilación.

#### REQ-02: Ciclo de Vida de Web Components Nativos (SPA-Safe)
- **R2.1:** Prohibir scripts imperativos huérfanos en componentes de interfaz.
- **R2.2:** Todos los componentes interactivos (`MatrixBackground`, `SystemTelemetryDemo`, modales) deben implementarse como Custom Elements (`HTMLElement`), aprovechando `connectedCallback` y `disconnectedCallback` para garantizar montaje y desmontaje seguro durante las transiciones de `ClientRouter`.
- **R2.3:** El estado global del cliente debe gestionarse exclusivamente mediante Nano Stores (`@nanostores/core`) con un peso de bundle inferior a 1.5 KB.

#### REQ-03: Restricciones de Cero FOUC y Core Web Vitals
- **R3.1:** CLS = `0.000` estricto en todas las rutas y durante transiciones de vista.
- **R3.2:** LCP < `0.8s` mediante pre-conexión de orígenes, tipografías locales con `font-display: swap` y metric overrides (`size-adjust`, `ascent-override`), y `<Image />` de Astro optimizado con `loading="eager"` y `fetchpriority="high"`.
- **R3.3:** INP < `50ms` mediante la eliminación total de tareas bloqueantes en el main thread (>16ms).

#### REQ-04: Abstracción de Proveedor de Almacenamiento (Local / R2 Ready)
- **R4.1:** Crear una capa de abstracción `ContentRepository` desacoplada del pipeline de Astro.
- **R4.2:** El Content Layer de Astro debe soportar carga híbrida: desarrollo local leyendo markdown de disco, y compilación remota o sincronizada leyendo blobs desde Cloudflare R2 vía API S3 / REST (expandido en [SPEC-003](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-003-future-improves.md)).

#### REQ-05: Telemetría Edge Privada y Observabilidad Zero Trust
- **R5.1:** Telemetría pública no bloqueante vía `navigator.sendBeacon` o `fetch` hacia endpoints de Cloudflare Workers con volcado asíncrono a Cloudflare D1.
- **R5.2:** Panel administrativo de analíticas aislado del build público, protegido a nivel de red mediante Cloudflare Access / Cloudflare Tunnels (Zero Trust), sin añadir JavaScript ni CSS al usuario final.

### 2.2. Criterios de Aceptación Cuantitativos y Umbrales de Rendimiento

| Métrica / Parámetro | Condición de Aprobación (PASS) | Condición de Fallo (FAIL) | Método de Medición |
| :--- | :--- | :--- | :--- |
| **Superficie de Páginas** | Reducción exacta del 50% (14 rutas paramétricas) | Existencia de duplicados en `src/pages/es/` | Inspección de AST y árbol de archivos |
| **Presupuesto JS Cliente** | Exactamente 0 KB de framework JS en rutas estáticas | Inclusión de React/Vue/Svelte o scripts no scoped | Análisis de chunks de Vite en `dist/` |
| **Cumulative Layout Shift** | **CLS = 0.000** continuo | CLS > 0.000 en cualquier transición | `PerformanceObserver` en navegación SPA |
| **Largest Contentful Paint** | **LCP < 800ms** (Fast 4G, 1.6 Mbps / 150ms RTT) | LCP ≥ 800ms | Chrome DevTools Trace / Lighthouse |
| **Interaction to Next Paint** | **INP < 50ms** | INP ≥ 50ms | Medición en clicks de filtros y búsqueda |
| **Fugas de Memoria en SPA** | 0 nodos DOM desasociados tras 10 navegaciones | Retención de listeners o canvas en heap | Heap Snapshot en DevTools |

---

## 3. Especificación del Sistema, Tipos e Invariantes Formales (SDD)

### 3.1. Arquitectura Global del Sistema

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Edge Network                         │
│  ┌───────────────────────┐  ┌───────────────────┐  ┌─────────────────┐ │
│  │ Cloudflare Access /   │  │  Workers Static   │  │ Edge Worker API │ │
│  │ Zero Trust Tunnel     │  │  Assets (Pages)   │  │ (Beacon D1 Eng) │ │
│  └───────────┬───────────┘  └─────────┬─────────┘  └────────┬────────┘ │
└──────────────┼────────────────────────┼─────────────────────┼──────────┘
               │                        │                     │
               ▼                        ▼                     ▼
┌────────────────────────┐   ┌────────────────────┐   ┌──────────────────┐
│  Panel Privado Admin   │   │ Pre-rendered SSG   │   │ Cloudflare D1 /  │
│  (Auth Zero Trust)     │   │ Static HTML/CSS/JS │   │ Analytics Engine │
└────────────────────────┘   └──────────┬─────────┘   └──────────────────┘
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │     Aplicación Cliente Unificada     │
                     │  - ClientRouter (View Transitions)   │
                     │  - Custom Elements (Lifecycle Safe)  │
                     │  - Nano Stores (Shared Micro-state)  │
                     │  - Zero FOUC In-head Theme Script    │
                     └──────────────────────────────────────┘
```

### 3.2. Matriz de Idiomas y Tipado Estricto (`src/i18n/config.ts`)

```typescript
export const LOCALES = {
  en: { code: "en", label: "English", pathPrefix: "" },
  es: { code: "es", label: "Español", pathPrefix: "es" },
} as const;

export type SupportedLocale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: SupportedLocale = "en";

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return locale in LOCALES;
}

export function getLocalePaths() {
  return [{ params: { lang: undefined } }, { params: { lang: "es" } }];
}
```

### 3.3. Configuración Canónica de Astro (`astro.config.mjs`)

```javascript
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://arturonavax.dev",
  output: "static",
  trailingSlash: "always",
  build: {
    inlineStylesheets: "auto",
    format: "directory",
  },
  compressHTML: true,
  prefetch: {
    prefetchAll: false,
    defaultStrategy: "hover",
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es"],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      cssCodeSplit: true,
      cssMinify: "lightningcss",
    },
  },
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/search/"),
      i18n: {
        defaultLocale: "en",
        locales: { en: "en", es: "es" },
      },
    }),
  ],
});
```

### 3.4. Patrón de Rutas Paramétricas Catch-All (`src/pages/[...lang]/`)

En lugar de duplicar templates en `src/pages/es/`, todas las páginas se unifican bajo `src/pages/[...lang]/`:

```text
src/pages/
├── [...lang]/
│   ├── index.astro
│   ├── links.astro
│   ├── search.astro
│   ├── blog/
│   │   ├── index.astro
│   │   └── [slug].astro
│   ├── projects/
│   │   ├── index.astro
│   │   └── [slug].astro
│   ├── experience/
│   │   ├── index.astro
│   │   └── [slug].astro
│   ├── services/
│   │   ├── index.astro
│   │   └── [slug].astro
│   ├── case-studies/
│   │   └── index.astro
│   └── resume/
│       ├── index.astro
│       └── maker.astro
├── 404.astro
├── rss.xml.ts
├── search-index.json.ts
└── llms-full.txt.ts
```

Ejemplo de implementación unificada en `src/pages/[...lang]/blog/[slug].astro`:

```astro
---
import { render } from "astro:content";
import ArticleLayout from "@/layouts/ArticleLayout.astro";
import { DEFAULT_LOCALE, type SupportedLocale } from "@/i18n/config";
import { getVisibleCollection } from "@/utils/visibility";

export async function getStaticPaths() {
  const posts = await getVisibleCollection("posts");

  return posts.map((post) => {
    const [localePart, ...slugParts] = post.id
      .replace(/\.(md|mdx)$/, "")
      .split("/");
    const slugPart = slugParts.join("/");
    const lang = localePart === DEFAULT_LOCALE ? undefined : localePart;

    return {
      params: { lang, slug: slugPart },
      props: { post, currentLocale: localePart as SupportedLocale },
    };
  });
}

const { post, currentLocale } = Astro.props;
const { Content } = await render(post);
const isEs = currentLocale === "es";
---

<ArticleLayout
  title={post.data.title}
  description={post.data.description}
  locale={currentLocale}
  pubDate={post.data.pubDate}
  tags={post.data.tags}
  translationKey={post.data.translationKey}
  collectionName="posts"
  backHref={isEs ? "/es/blog/" : "/blog/"}
  backLabel={isEs ? "Volver a ensayos" : "Back to essays"}
>
  <Content />
</ArticleLayout>
```

### 3.5. Ciclo de Vida de Custom Elements y Componentes SPA-Safe

Para evitar memory leaks y bloqueos en el main thread, los componentes interactivos se aíslan en Custom Elements:

```typescript
// Component: src/components/ui/MatrixBackground.astro
class MatrixCanvasLayer extends HTMLElement {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  connectedCallback() {
    if (window.innerWidth < 768) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    this.canvas = this.querySelector("canvas");
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    if (!this.ctx) return;

    this.initCanvasDimensions();
    this.initRain();
    this.startRainLoop();

    this.resizeObserver = new ResizeObserver(() => {
      this.initCanvasDimensions();
      this.initRain();
    });
    this.resizeObserver.observe(this);
  }

  disconnectedCallback() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  private initCanvasDimensions() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    if (this.ctx) {
      this.ctx.resetTransform?.();
      this.ctx.scale(dpr, dpr);
    }
  }

  private initRain() {
    if (!this.canvas) return;
    const fontSize = 14;
    const columns = Math.floor(window.innerWidth / fontSize);
    this.drops = new Array(columns).fill(1).map(() => Math.floor(Math.random() * 50));
  }

  private startRainLoop() {
    const fontSize = 14;
    const characters = "0123456789ABCDEF<>/{};:_$#@!*&";
    const opacity = parseFloat(this.dataset.opacity || "0.15");

    const render = () => {
      if (!this.ctx || !this.canvas) return;
      this.ctx.fillStyle = "rgba(10, 10, 10, 0.08)";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = `rgba(217, 119, 6, ${opacity})`;
      this.ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < this.drops.length; i++) {
        const text = characters.charAt(Math.floor(Math.random() * characters.length));
        const x = i * fontSize;
        const y = this.drops[i] * fontSize;
        this.ctx.fillText(text, x, y);
        if (y > this.canvas.height && Math.random() > 0.975) {
          this.drops[i] = 0;
        }
        this.drops[i]++;
      }
      this.animationFrameId = requestAnimationFrame(render);
    };

    this.animationFrameId = requestAnimationFrame(render);
  }
}

if (!customElements.get("matrix-canvas-layer")) {
  customElements.define("matrix-canvas-layer", MatrixCanvasLayer);
}
```

### 3.6. Micro-Estado Atómico Reactivo con Nano Stores (`src/stores/uiState.ts`)

```typescript
import { atom } from "nanostores";

export const isSearchOpen = atom<boolean>(false);
export const isShortcutsOpen = atom<boolean>(false);
export const isSponsorshipModalOpen = atom<boolean>(false);

export function toggleSearchModal(forceState?: boolean): void {
  isSearchOpen.set(forceState !== undefined ? forceState : !isSearchOpen.get());
}

export function toggleShortcutsModal(forceState?: boolean): void {
  isShortcutsOpen.set(forceState !== undefined ? forceState : !isShortcutsOpen.get());
}

export function toggleSponsorshipModal(forceState?: boolean): void {
  isSponsorshipModalOpen.set(forceState !== undefined ? forceState : !isSponsorshipModalOpen.get());
}
```

### 3.7. Contratos de Almacenamiento Desacoplado (`src/lib/content/repository.ts`)

```typescript
export interface PostEntity {
  readonly id: string;
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly description: string;
  readonly publishDate: Date;
  readonly updatedDate?: Date;
  readonly tags: readonly string[];
  readonly content: string;
}

export interface IContentSourceProvider {
  fetchPosts(locale?: string): Promise<PostEntity[]>;
  fetchPostBySlug(slug: string, locale: string): Promise<PostEntity | null>;
}
```

---

## 4. Verificación Operativa, Telemetría y Validación en Tiempo de Ejecución (ODD)

### 4.1. Telemetría Edge Pública con Anonymized Hashing

Para cumplir con el respeto estricto a la privacidad sin sacrificar observabilidad, la telemetría se procesa en el perimetral sin cookies ni huellas invasivas:

```typescript
// cloudflare/telemetry-worker.ts (Integrado en cloudflare/worker.ts)
const clientIp = request.headers.get("cf-connecting-ip") || "0.0.0.0";
const encoder = new TextEncoder();
const hashBuffer = await crypto.subtle.digest(
  "SHA-256",
  encoder.encode(`${clientIp}-${new Date().toISOString().slice(0, 10)}`),
);
const visitorHash = Array.from(new Uint8Array(hashBuffer))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("")
  .slice(0, 16);
```

### 4.2. Esquema D1 Optimizado (`cloudflare/d1/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS edge_telemetry_events (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  path TEXT NOT NULL,
  locale TEXT NOT NULL,
  country TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  referrer TEXT
);

CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON edge_telemetry_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_path ON edge_telemetry_events(path);
CREATE INDEX IF NOT EXISTS idx_telemetry_hash ON edge_telemetry_events(visitor_hash);
```

### 4.3. Política de Acceso Zero Trust y Tunnels (`cloudflare/access-policy.json`)

El panel de analíticas y administración permanece 100% aislado del bundle público mediante Cloudflare Access:

```json
{
  "name": "Arturo Nava Private Analytics Gateway",
  "decision": "allow",
  "include": [{ "email": { "email": "contact@arturonavax.dev" } }],
  "require": [{ "auth_method": { "auth_method": "two_factor" } }],
  "rules": [{ "name": "Admins Only", "action": "allow" }]
}
```

### 4.4. Reglas de Cache e Inmutabilidad en el Perímetro (`public/_headers`)

```ini
# Immutable Cache Strategy for Fingerprinted Production Assets
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff

/fonts/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *
  X-Content-Type-Options: nosniff

# Document Delivery with Instant Revalidation
/*.html
  Cache-Control: public, max-age=0, must-revalidate
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()
```

### 4.5. Pruebas de Estrés y Navegación SPA sin Fugas de Memoria

El comportamiento en tiempo de ejecución se valida mediante un ciclo continuo de 10 transiciones de vista consecutivas (`Home` -> `Blog` -> `Article` -> `Projects` -> `Experience` -> `Home`). El snapshot del Heap de memoria debe verificar `detached DOM elements = 0` y `active requestAnimationFrame callbacks = 1` (exclusivo para el canvas montado en el viewport activo).

---

## 5. Matriz de Archivos Consolidados, Trazabilidad Cruzada y Certificación (DoD)

### 5.1. Matriz de Consolidación de Archivos (Reducción de 28 a 14)

| Archivo Obsoleto Eliminado | Archivo Canónico Consolidado | Estado de Verificación |
| :--- | :--- | :---: |
| `src/pages/es/index.astro` | `src/pages/[...lang]/index.astro` | **VERIFICADO** |
| `src/pages/es/resume.astro` | `src/pages/[...lang]/resume/index.astro` (refactorizado en [SPEC-002](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-002-general-tasks.md)) | **VERIFICADO** |
| `src/pages/es/links.astro` | `src/pages/[...lang]/links.astro` | **VERIFICADO** |
| `src/pages/es/search.astro` | `src/pages/[...lang]/search.astro` | **VERIFICADO** |
| `src/pages/es/blog/index.astro` | `src/pages/[...lang]/blog/index.astro` | **VERIFICADO** |
| `src/pages/es/blog/[slug].astro` | `src/pages/[...lang]/blog/[slug].astro` | **VERIFICADO** |
| `src/pages/es/projects/index.astro` | `src/pages/[...lang]/projects/index.astro` | **VERIFICADO** |
| `src/pages/es/projects/[slug].astro` | `src/pages/[...lang]/projects/[slug].astro` | **VERIFICADO** |
| `src/pages/es/experience/index.astro` | `src/pages/[...lang]/experience/index.astro` | **VERIFICADO** |
| `src/pages/es/experience/[slug].astro` | `src/pages/[...lang]/experience/[slug].astro` | **VERIFICADO** |
| `src/pages/es/services/index.astro` | `src/pages/[...lang]/services/index.astro` | **VERIFICADO** |
| `src/pages/es/services/[slug].astro` | `src/pages/[...lang]/services/[slug].astro` | **VERIFICADO** |
| `src/pages/es/case-studies/index.astro` | `src/pages/[...lang]/case-studies/index.astro` | **VERIFICADO** |
| `src/pages/es/rss.xml.ts` | Consolidado en `src/pages/rss.xml.ts` bilingüe | **VERIFICADO** |

### 5.2. Mapeo Bidireccional de Referencias Cruzadas

- **Base de [SPEC-002](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-002-general-tasks.md):** La consolidación de rutas paramétricas `[...lang]` permite a SPEC-002 modularizar el estudio `/resume/maker` y estructurar exportaciones multi-formato sin bifurcar plantillas en carpetas de idioma.
- **Base de [SPEC-003](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-003-future-improves.md):** El modelo de telemetría y desacoplamiento de almacenamiento de SPEC-001 se formaliza en la Arquitectura Hexagonal de puertos (`StoragePort`, `TelemetryPort`) y adaptadores perimetrales en Cloudflare Workers y D1.
- **Sometido a [SPEC-004](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-004-audit.md):** Todos los artefactos de SPEC-001 son auditados matemáticamente por SPEC-004 para garantizar 0 KB JS en rutas estáticas, CLS = 0.000 e inmutabilidad estricta de headers.

### 5.3. Criterios de Aceptación Finales (Definition of Done)

- [x] Compilación estática limpia vía `bun run build` generando todas las rutas (`en` y `es`) sin warnings.
- [x] Verificación de tipos estricta vía `bun run check` con 0 errores y 0 warnings.
- [x] Eliminación total de la carpeta `src/pages/es/` del control de versiones.
- [x] Métricas Core Web Vitals en umbrales de excelencia (LCP < 800ms, INP < 50ms, CLS = 0.000).
- [x] Telemetría asíncrona no invasiva operativa con persistencia en Cloudflare D1.
