# OpenSpec: Architecture, Performance & Scalability Specification

```yaml
id: SPEC-2026-ARCH-001
title: Enterprise Astro Edge Architecture, Zero-Duplication i18n & Cloudflare Infrastructure
status: READY-FOR-EXECUTION
author: Staff Frontend Performance Architect
target_framework: Astro v7+ / Cloudflare Workers Static Assets & Pages
methodology: Spec-Driven Development (SDD) / Requirement-Driven Architecture
```

---

## 1. Diagnóstico del Sistema y Oportunidades de Mejora

### 1.1. Deuda Técnica y Antipatrones Detectados

1. **Duplicación Crítica en Capa de Rutas (`src/pages/` vs `src/pages/es/`):**
   - El proyecto replica 14 archivos `.astro` completos entre la raíz y el subdirectorio `es/` (`index`, `blog/*`, `projects/*`, `experience/*`, `services/*`, `resume`, `links`, `search`, `case-studies`).
   - Esta redundancia multiplica el costo de mantenimiento por $2\times$, induce divergencias de UI/SEO (atributos `aria-*`, micro-interacciones) y anula la escalabilidad cuando se agreguen nuevos idiomas (`pt`, `de`, `fr`).

2. **Fugas de Memoria e Incompatibilidad con View Transitions (`ClientRouter`):**
   - Múltiples componentes interactivos (`MatrixBackground.astro`, `SystemTelemetryDemo.astro`, `UniversalSearchModal.astro`, `ShortcutsModal.astro`, `BlogFilterBar.astro`) instancian scripts imperativos mediante listeners globales en `document` o bucles `requestAnimationFrame`/`setInterval`.
   - En navegaciones SPA, los listeners globales no se limpian y los bucles de renderizado continúan ejecutándose en segundo plano, degradando el **INP (Interaction to Next Paint)** e incrementando el consumo de memoria heap en el cliente.

3. **Acoplamiento Directo al Sistema de Archivos Local (`src/content/`):**
   - `src/content.config.ts` utiliza cargadores `glob()` estrictamente atados a la estructura de carpetas física (`src/content/posts/en/*.md`).
   - No existe una interfaz abstracta que permita bifurcar o migrar progresivamente las fuentes de datos hacia Cloudflare R2, CMS headless o bases de datos SQLite en el Edge (Cloudflare D1).

4. **Monolito de Scripting sin Aislamiento de Ciclo de Vida:**
   - La lógica de filtrado de clientes en `/blog`, `/projects` y `/case-studies` re-renderiza manipulando el DOM de forma desincronizada con el estado de la aplicación.
   - Falta de un gestor de micro-estado atómico reactivo (<1KB) como `@nanostores/core` para comunicar modales, estado de búsqueda y telemetría sin recargar ni romper el hilo principal.

5. **Optimización de Caché y Headers en el Edge de Cloudflare:**
   - El archivo `public/_headers` actual carece de directivas estrictas de inmutabilidad (`public, max-age=31536000, immutable`) para bundles generados por Vite (`/_astro/*`) y activos multimedia, provocando revalidaciones innecesarias (`304 Not Modified`) que ralentizan la navegación edge-to-client.

---

## 2. Requerimientos del Sistema (Requirements-Driven Specification)

### REQ-01: Zero-Duplication i18n Engine

- **R1.1:** Las rutas deben definirse mediante parámetros dinámicos unificados (`src/pages/[...lang]/...`) o templates desacoplados, reduciendo las páginas físicas de 28 a 14.
- **R1.2:** Toda ruta debe resolver canónicos absolutos y etiquetas `hreflang` bidireccionales en tiempo de compilación estática (SSG).
- **R1.3:** La traducción de etiquetas UI debe ser estricta mediante TypeScript Generics con auto-completado y detección de claves faltantes en build time.

### REQ-02: Native Web Components Lifecycle (SPA-Safe Client Logic)

- **R2.1:** Prohibir scripts imperativos huérfanos en componentes de interfaz.
- **R2.2:** Todos los componentes interactivos (`MatrixBackground`, `SystemTelemetryDemo`, modales) deben implementarse como Custom Elements (`HTMLElement`), aprovechando `connectedCallback` y `disconnectedCallback` para garantizar montaje y desmontaje seguro durante las transiciones de `ClientRouter`.
- **R2.3:** Estado global cliente manejado exclusivamente mediante Nano Stores (`@nanostores/core`) con un peso bundle inferior a 1.5KB.

### REQ-03: Zero FOUC & Core Web Vitals Constraints

- **R3.1:** CLS = `0.000` estricto en todas las rutas y en cambios de vista.
- **R3.2:** LCP < `0.8s` mediante pre-conexión de orígenes, tipografías locales con `font-display: swap` y metric overrides (`size-adjust`, `ascent-override`), y `<Image />` de Astro optimizado con `loading="eager"` y `fetchpriority="high"`.
- **R3.3:** INP < `50ms` mediante la eliminación total de tareas bloqueantes en el main thread (>16ms).

### REQ-04: Storage Provider Abstraction (Local / R2 Ready)

- **R4.1:** Crear una capa de abstracción `ContentRepository` desacoplada del pipeline de Astro.
- **R4.2:** El Content Layer de Astro v7 (`src/content.config.ts`) debe soportar carga híbrida: desarrollo local leyendo markdown de disco, y compilación remota o sincronizada leyendo blobs desde Cloudflare R2 vía S3 API / REST API.

### REQ-05: Private Edge Analytics & Zero Trust Observability

- **R5.1:** Telemetría pública no bloqueante vía `navigator.sendBeacon` hacia endpoints de Cloudflare Workers con volcado asíncrono a Cloudflare D1 / Analytics Engine.
- **R5.2:** Panel administrativo de analíticas aislado del build público, protegido a nivel de red mediante Cloudflare Access / Cloudflare Tunnels (Zero Trust), sin añadir JavaScript ni CSS al usuario final.

---

## 3. Arquitectura del Sistema

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
│  Private Admin Panel   │   │ Pre-rendered SSG   │   │ Cloudflare D1 /  │
│  (Auth Required)       │   │ Static HTML/CSS/JS │   │ Analytics Engine │
└────────────────────────┘   └──────────┬─────────┘   └──────────────────┘
                                        │
                                        ▼
                     ┌──────────────────────────────────────┐
                     │   Unified Client Application         │
                     │  - ClientRouter (View Transitions)   │
                     │  - Custom Elements (Lifecycle Safe)  │
                     │  - Nano Stores (Shared Micro-state)  │
                     │  - Zero FOUC In-head Theme Script    │
                     └──────────────────────────────────────┘
```

---

## 4. Plan de Refactorización y Blueprint de Implementación

### 4.1. Refactorización de i18n sin Duplicación de Código

#### 4.1.1. Matriz de Idiomas y Tipado Estricto (`src/i18n/config.ts`)

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

#### 4.1.2. Configuración de Rutas de Astro (`astro.config.mjs`)

```javascript
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "[https://arturonava.com](https://arturonava.com)",
  output: "static",
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
      cssMinify: "lightningcss",
    },
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: "en",
        locales: {
          en: "en-US",
          es: "es-ES",
        },
      },
    }),
  ],
});
```

#### 4.1.3. Patrón de Rutas Paramétricas Catch-All

En lugar de mantener `src/pages/index.astro` y `src/pages/es/index.astro`, se unifica la estructura dentro de `src/pages/[...lang]/`:

```
src/pages/
├── [...lang]/
│   ├── index.astro
│   ├── resume.astro
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
│   └── case-studies/
│       └── index.astro
├── 404.astro
├── robots.txt.ts
├── llms.txt.ts
└── search-index.json.ts
```

#### 4.1.4. Ejemplo de Implementación Unificada (`src/pages/[...lang]/blog/[slug].astro`)

```astro
---
import { getCollection, render } from "astro:content";
import ArticleLayout from "@/layouts/ArticleLayout.astro";
import { LOCALES, DEFAULT_LOCALE, type SupportedLocale } from "@/i18n/config";
import { useTranslations } from "@/i18n/utils";

export async function getStaticPaths() {
  const posts = await getCollection("posts");

  return posts.map((post) => {
    // Post ID format: "en/sub-50ms-fraud-engine-go" or "es/sub-50ms-fraud-engine-go"
    const [localePart, slugPart] = post.id.split("/");
    const lang = localePart === DEFAULT_LOCALE ? undefined : localePart;

    return {
      params: {
        lang,
        slug: slugPart,
      },
      props: {
        post,
        currentLocale: localePart as SupportedLocale,
      },
    };
  });
}

const { post, currentLocale } = Astro.props;
const { Content, headings, remarkPluginFrontmatter } = await render(post);
const t = useTranslations(currentLocale);
---

<ArticleLayout
  description="{post.data.description}"
  headings="{headings}"
  locale="{currentLocale}"
  publishDate="{post.data.publishDate}"
  readingTime="{remarkPluginFrontmatter?.readingTime}"
  slug="{Astro.params.slug!}"
  title="{post.data.title}"
  updatedDate="{post.data.updatedDate}"
>
  <Content />
</ArticleLayout>
```

---

### 4.2. Integración de SPA de Alto Rendimiento en Cloudflare Edge

#### 4.2.1. Gestión de Transiciones y Anti-FOUC (`src/layouts/BaseLayout.astro`)

```astro
---
import { ClientRouter } from "astro:transitions";
import SEOHead from "@/components/common/SEOHead.astro";
import Header from "@/components/common/Header.astro";
import Footer from "@/components/common/Footer.astro";
import UniversalSearchModal from "@/components/ui/UniversalSearchModal.astro";
import ShortcutsModal from "@/components/ui/ShortcutsModal.astro";
import type { SupportedLocale } from "@/i18n/config";

interface Props {
  title: string;
  description: string;
  locale: SupportedLocale;
  image?: string;
  articleDate?: Date;
}

const { title, description, locale, image, articleDate } = Astro.props;
---

<!doctype html>
<html lang={locale} class="scroll-smooth">
  <head>
    <SEOHead
      articleDate="{articleDate}"
      description="{description}"
      image="{image}"
      locale="{locale}"
      title="{title}"
    />
    <ClientRouter />

    <!-- Synchronous In-Head Theme Engine (Zero FOUC) -->
    <script is:inline>
      (function () {
        const storedTheme = localStorage.getItem("theme");
        const systemPrefersDark = window.matchMedia(
          "(prefers-color-scheme: dark)",
        ).matches;
        const resolvedTheme =
          storedTheme || (systemPrefersDark ? "dark" : "light");
        if (resolvedTheme === "dark") {
          document.documentElement.classList.add("dark");
          document.documentElement.style.colorScheme = "dark";
        } else {
          document.documentElement.classList.remove("dark");
          document.documentElement.style.colorScheme = "light";
        }
      })();

      document.addEventListener("astro:after-swap", () => {
        const storedTheme = localStorage.getItem("theme");
        const systemPrefersDark = window.matchMedia(
          "(prefers-color-scheme: dark)",
        ).matches;
        const resolvedTheme =
          storedTheme || (systemPrefersDark ? "dark" : "light");
        if (resolvedTheme === "dark") {
          document.documentElement.classList.add("dark");
          document.documentElement.style.colorScheme = "dark";
        } else {
          document.documentElement.classList.remove("dark");
          document.documentElement.style.colorScheme = "light";
        }
      });
    </script>
  </head>
  <body class="min-h-screen bg-neutral-50 text-neutral-900 antialiased selection:bg-neutral-900 selection:text-neutral-50 dark:bg-neutral-950 dark:text-neutral-100 dark:selection:bg-neutral-100 dark:selection:text-neutral-950">
    <div class="flex min-h-screen flex-col">
      <Header currentLocale="{locale}" />
      <main id="main-content" class="flex-1">
        <slot />
      </main>
      <Footer currentLocale="{locale}" />
    </div>

    <UniversalSearchModal currentLocale="{locale}" />
    <ShortcutsModal currentLocale="{locale}" />
  </body>
</html>
```

#### 4.2.2. Migración a Custom Elements para Ciclo de Vida Limpio (`src/components/ui/MatrixBackground.astro`)

```astro
---
interface Props {
  density?: number;
  opacity?: number;
}

const { density = 0.08, opacity = 0.15 } = Astro.props;
---

<matrix-canvas-layer
  data-density={density}
  data-opacity={opacity}
  class="pointer-events-none fixed inset-0 -z-10 block overflow-hidden"
>
  <canvas class="h-full w-full"></canvas>
</matrix-canvas-layer>

<script>
  class MatrixCanvasLayer extends HTMLElement {
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private animationFrameId: number | null = null;
    private drops: number[] = [];
    private resizeObserver: ResizeObserver | null = null;

    connectedCallback() {
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
        this.ctx.scale(dpr, dpr);
      }
    }

    private initRain() {
      if (!this.canvas) return;
      const fontSize = 16;
      const columns = Math.floor(this.canvas.width / fontSize);
      this.drops = new Array(columns).fill(1);
    }

    private startRainLoop() {
      const fontSize = 16;
      const characters = "0123456789ABCDEF<>/{};:_$#@!*&";
      const opacity = parseFloat(this.dataset.opacity || "0.15");

      const render = () => {
        if (!this.ctx || !this.canvas) return;

        this.ctx.fillStyle = "rgba(10, 10, 10, 0.08)";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.fillStyle = `rgba(34, 197, 94, ${opacity})`;
        this.ctx.font = `${fontSize}px monospace`;

        for (let i = 0; i < this.drops.length; i++) {
          const text = characters.charAt(
            Math.floor(Math.random() * characters.length),
          );
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
</script>
```

#### 4.2.3. Estado Compartido Ultraligero con Nano Stores (`src/stores/uiState.ts`)

```typescript
import { atom } from "nanostores";

export const isSearchOpen = atom<boolean>(false);
export const isShortcutsOpen = atom<boolean>(false);
export const isSponsorshipModalOpen = atom<boolean>(false);

export function toggleSearchModal(forceState?: boolean) {
  isSearchOpen.set(forceState !== undefined ? forceState : !isSearchOpen.get());
}

export function toggleShortcutsModal(forceState?: boolean) {
  isShortcutsOpen.set(
    forceState !== undefined ? forceState : !isShortcutsOpen.get(),
  );
}

export function toggleSponsorshipModal(forceState?: boolean) {
  isSponsorshipModalOpen.set(
    forceState !== undefined ? forceState : !isSponsorshipModalOpen.get(),
  );
}
```

---

### 4.3. Pipeline de Almacenamiento Desacoplado (Local Markdown + Cloudflare R2 Migration Ready)

#### 4.3.1. Interfaz de Repositorio de Contenido (`src/lib/content/repository.ts`)

```typescript
import type { CollectionEntry } from 'astro:content';

export interface PostEntity {
  id: string;
  slug: string;
  locale: string;
  title: string;
  description: string;
  publishDate: Date;
  updatedDate?: Date;
  tags: string[];
  content: string;
}

export interface IContentSourceProvider {
  fetchPosts(locale?: string): Promise<PostEntity[]>;
  fetchPostBySlug(slug: string, locale: string): Promise<PostEntity null |>;
}
```

#### 4.3.2. Adaptador Local y Adaptador Cloudflare R2 (`src/lib/content/providers.ts`)

```typescript
import type { IContentSourceProvider, PostEntity } from './repository';
import { getCollection } from 'astro:content';

export class LocalFilesystemProvider implements IContentSourceProvider {
  async fetchPosts(locale?: string): Promise<PostEntity[]> {
    const rawPosts = await getCollection('posts');
    return rawPosts
      .filter((post) => {
        const [postLocale] = post.id.split('/');
        return locale ? postLocale === locale : true;
      })
      .map((post) => {
        const [postLocale, slug] = post.id.split('/');
        return {
          id: post.id,
          slug,
          locale: postLocale,
          title: post.data.title,
          description: post.data.description,
          publishDate: post.data.publishDate,
          updatedDate: post.data.updatedDate,
          tags: post.data.tags || [],
          content: post.body || '',
        };
      });
  }

  async fetchPostBySlug(slug: string, locale: string): Promise<PostEntity null |> {
    const posts = await this.fetchPosts(locale);
    return posts.find((p) => p.slug === slug && p.locale === locale) || null;
  }
}

export class CloudflareR2Provider implements IContentSourceProvider {
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private bucketName: string;

  constructor(config: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
  }) {
    this.endpoint = config.endpoint;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.bucketName = config.bucketName;
  }

  async fetchPosts(locale?: string): Promise<PostEntity[]> {
    // S3-compatible fetch protocol against Cloudflare R2 storage
    const indexUrl = `${this.endpoint}/${this.bucketName}/index-${locale || 'all'}.json`;
    const response = await fetch(indexUrl, {
      headers: {
        Authorization: `Bearer ${this.secretAccessKey}`,
      },
    });

    if (!response.ok) {
      console.warn(`[CloudflareR2Provider] Fallback: unable to load remote index from ${indexUrl}`);
      return [];
    }

    return (await response.json()) as PostEntity[];
  }

  async fetchPostBySlug(slug: string, locale: string): Promise<PostEntity null |> {
    const rawUrl = `${this.endpoint}/${this.bucketName}/posts/${locale}/${slug}.md`;
    const response = await fetch(rawUrl);
    if (!response.ok) return null;

    // Parses frontmatter and body remotely during dynamic SSG build
    const rawText = await response.text();
    return this.parseMarkdownPayload(rawText, slug, locale);
  }

  private parseMarkdownPayload(raw: string, slug: string, locale: string): PostEntity {
    // Frontmatter extraction helper
    const parts = raw.split(/^---$/m);
    const body = parts.slice(2).join('---').trim();
    return {
      id: `${locale}/${slug}`,
      slug,
      locale,
      title: slug.replace(/-/g, ' '),
      description: '',
      publishDate: new Date(),
      tags: [],
      content: body,
    };
  }
}

export function createContentRepository(): IContentSourceProvider {
  const useRemoteR2 = process.env.ENABLE_R2_CONTENT === 'true';
  if (useRemoteR2 && process.env.R2_ENDPOINT && process.env.R2_SECRET_KEY) {
    return new CloudflareR2Provider({
      endpoint: process.env.R2_ENDPOINT,
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_KEY,
      bucketName: process.env.R2_BUCKET_NAME || 'arturonava-content',
    });
  }
  return new LocalFilesystemProvider();
}
```

---

### 4.4. Telemetría Edge Pública & Dashboard Privado con Zero Trust

#### 4.4.1. Edge Worker de Telemetría (`cloudflare/telemetry-worker.ts`)

```typescript
export interface Env {
  ANALYTICS_DB: D1Database;
  CF_VERSION_METADATA: { id: string };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Public Edge Ingestion Endpoint
    if (url.pathname === "/api/v1/telemetry" && request.method === "POST") {
      try {
        const payload = (await request.json()) as {
          path: string;
          locale: string;
          referrer?: string;
          screenResolution?: string;
          connectionType?: string;
        };

        const country = request.headers.get("cf-ipcountry") || "UNKNOWN";
        const userAgent = request.headers.get("user-agent") || "UNKNOWN";
        const clientIp = request.headers.get("cf-connecting-ip") || "0.0.0.0";

        // Anonymized hash of client IP for unique visitors without cookies
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest(
          "SHA-256",
          encoder.encode(
            `${clientIp}-${new Date().toISOString().slice(0, 10)}`,
          ),
        );
        const visitorHash = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 16);

        await env.ANALYTICS_DB.prepare(
          `INSERT INTO edge_telemetry_events (
            id, timestamp, path, locale, country, user_agent, visitor_hash, referrer
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            crypto.randomUUID(),
            Date.now(),
            payload.path.slice(0, 255),
            payload.locale.slice(0, 10),
            country,
            userAgent.slice(0, 512),
            visitorHash,
            payload.referrer?.slice(0, 255) || null,
          )
          .run();

        return new Response(JSON.stringify({ status: "queued" }), {
          status: 202,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin":
              "[https://arturonava.com](https://arturonava.com)",
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "invalid_payload" }), {
          status: 400,
        });
      }
    }

    // Fallback
    return new Response("Edge Gateway Operational", { status: 200 });
  },
};
```

#### 4.4.2. Esquema D1 Optimizado (`cloudflare/d1/schema.sql`)

```sql
-- Edge Telemetry Table for Zero-Tracking Analytics
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

#### 4.4.3. Configuración de Acceso Zero Trust y Tunnels (`cloudflare/access-policy.json`)

Para garantizar que el panel de analíticas no aumente el peso del bundle del sitio público y permanezca 100% privado:

```json
{
  "name": "Arturo Nava Private Analytics Gateway",
  "decision": "allow",
  "include": [
    {
      "email": {
        "email": "contact@arturonava.com"
      }
    }
  ],
  "require": [
    {
      "auth_method": {
        "auth_method": "two_factor"
      }
    }
  ],
  "rules": [
    {
      "name": "Admins Only",
      "action": "allow"
    }
  ]
}
```

---

### 4.5. Configuración de Headers Inmutables en Cloudflare Edge (`public/_headers`)

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
  Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()

# Raw Feeds and Discovery Artifacts
/sitemap-*.xml
  Cache-Control: public, max-age=3600, must-revalidate
  Content-Type: application/xml; charset=UTF-8

/robots.txt
  Cache-Control: public, max-age=3600, must-revalidate

/llms*.txt
  Cache-Control: public, max-age=3600, must-revalidate
  Content-Type: text/plain; charset=UTF-8
```

---

## 5. Matriz de Archivos a Eliminar y Consolidar

La ejecución de esta especificación permite suprimir inmediatamente los siguientes archivos redundantes en el repositorio:

| Archivo Obsoleto (A Eliminar)                          | Archivo Canónico Consolidado                                     |
| :----------------------------------------------------- | :--------------------------------------------------------------- |
| `src/pages/es/index.astro`                             | `src/pages/[...lang]/index.astro`                                |
| `src/pages/es/resume.astro`                            | `src/pages/[...lang]/resume.astro`                               |
| `src/pages/es/links.astro`                             | `src/pages/[...lang]/links.astro`                                |
| `src/pages/es/search.astro`                            | `src/pages/[...lang]/search.astro`                               |
| `src/pages/es/blog/index.astro`                        | `src/pages/[...lang]/blog/index.astro`                           |
| `src/pages/es/blog/[slug].astro`                       | `src/pages/[...lang]/blog/[slug].astro`                          |
| `src/pages/es/projects/index.astro`                    | `src/pages/[...lang]/projects/index.astro`                       |
| `src/pages/es/projects/[slug].astro`                   | `src/pages/[...lang]/projects/[slug].astro`                      |
| `src/pages/es/experience/index.astro`                  | `src/pages/[...lang]/experience/index.astro`                     |
| `src/pages/es/experience/[slug].astro`                 | `src/pages/[...lang]/experience/[slug].astro`                    |
| `src/pages/es/services/index.astro`                    | `src/pages/[...lang]/services/index.astro`                       |
| `src/pages/es/services/[slug].astro`                   | `src/pages/[...lang]/services/[slug].astro`                      |
| `src/pages/es/case-studies/index.astro`                | `src/pages/[...lang]/case-studies/index.astro`                   |
| `src/pages/es/rss.xml.ts`                              | Consolidado en `src/pages/rss.xml.ts` con soporte multi-idioma   |
| `src/pages/search-index-en.json.ts` & `...-es.json.ts` | Consolidado en `src/pages/search-index.json.ts` con segmentación |

**Beneficio Inmediato:** Reducción del 50% de la superficie de código en páginas, eliminación de 14 duplicaciones de plantilla y soporte nativo para nuevos idiomas con cero archivos adicionales.

---

## 6. Criterios de Aceptación y Validación Automática (Definition of Done)

1. **Compilación Estática:**

   ```bash
   pnpm build
   ```

   El build debe generar todas las variantes (`/blog/...` y `/es/blog/...`) con cero advertencias de Astro y validación estricta de TypeScript (`pnpm astro check`).

2. **Core Web Vitals Thresholds:**
   - **CLS:** `0.000` (validado mediante Chrome DevTools Performance Trace tras 5 transiciones consecutivas).
   - **LCP:** `< 800ms` en emulación móvil Fast 3G.
   - **INP:** `< 50ms` en interacción con filtros y modales.

3. **Prueba de Inmunidad de Memoria en SPA:**
   - Navegar en ciclo `Home` -> `Blog` -> `Article` -> `Projects` -> `Home` 10 veces continuas.
   - Validar en DevTools Memory Heap Snapshot que los elementos `matrix-canvas-layer` y los event listeners de `UniversalSearchModal` se liberan (`detached DOM elements = 0`).

4. **Zero Trust & Edge Verification:**
   - Probar con `wrangler pages dev dist` que todas las rutas estáticas responden con código `200 OK` y cabeceras `Cache-Control` inmutables para assets en `/_astro/`.
