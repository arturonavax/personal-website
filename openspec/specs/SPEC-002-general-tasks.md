# OpenSpec: Technical Implementation & Architectural Refactoring Specification

```yaml
id: SPEC-2026-REFACTOR-FEATURE-002
title: System Refactoring, Cloudflare Edge Hardening, Cross-Browser Print Engine & Interactive Resume Maker Studio
status: APPROVED-FOR-IMPLEMENTATION
version: 2.0.0
target_stack:
  framework: Astro v7.3.4+ (Static Output / ClientRouter)
  styling: Tailwind CSS v4.3.3+ (CSS-First @theme Engine)
  runtime: Cloudflare Edge (Workers, D1, R2, Vectorize, Cache API)
  architecture: Hexagonal / Decoupled Ports & Adapters
  locales: [en, es] (EN Primary Default -> ES Secondary -> Extensible N)
methodology: Spec-Driven Development (SDD) & Requirement-Driven Development (RDD)
```

---

## 1. Executive Summary & Architectural Alignment

Esta especificación técnica consolida y actualiza integralmente el alcance de `SPEC-2026-REFACTOR-FEATURE-002`, adaptándolo al estado actual del repositorio y a la arquitectura hexagonal desacoplada definida para Cloudflare Edge.

El objetivo central es eliminar la deuda técnica acumulada en activos no utilizados, blindar el Edge Worker contra solicitudes especulativas de prefetch, normalizar la experiencia de impresión tipográfica y navegación SPA entre navegadores (Firefox, Safari, Chromium y WebViews móviles), y migrar la nomenclatura de dominio heredada `cv` hacia `resume`. Asimismo, se formaliza la arquitectura del nuevo estudio interactivo **Resume Maker** en `/resume/maker/` y `/es/resume/maker/`, junto con un motor de exportación multi-formato (Markdown, JSON-LD/Schema.org, TOML y XML) con inyección reactiva de parámetros UTM.

### Tareas Fuera de Alcance (Out of Scope)

- Verificación manual externa de números telefónicos o identidad corporativa.
- Servicios upstream de terceros con fallas 503 ajenas a la infraestructura del proyecto.
- Tareas ya integradas en commits previos (remoción de enlaces pre-print y botones móviles obsoletos).

---

## 2. Requirements Matrix (RDD)

| ID         | Requerimiento Técnico                  | Componente / Capa Afectada                     | Criterio de Aceptación                                                                                                                         |
| :--------- | :------------------------------------- | :--------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| **REQ-01** | **Asset Pruning & Hygiene**            | `public/banner-*`                              | Eliminación de los 9 archivos PNG obsoletos (`16x9`, `3x1`, `4x1`). Bundle limpio en producción.                                               |
| **REQ-02** | **Clipboard Protocol (Anti-Mailto)**   | `src/components/ui/EmailCopyButton.astro`      | Cero activaciones accidentales del cliente de correo (`mailto:` eliminado). Copia asíncrona con toast accesible (`aria-live="polite"`).        |
| **REQ-03** | **Dynamic Canonical URL Integrity**    | `src/components/common/SEOHead.astro`          | Eliminación estricta de query params (`utm_*`, `tag`, `company`). Actualización reactiva tras transiciones de `ClientRouter`.                  |
| **REQ-04** | **Prefetch Telemetry Shielding**       | `cloudflare/worker.ts`                         | Detección de cabeceras `Purpose: prefetch` y `Sec-Purpose: prefetch`. Bypass de mutaciones D1 y ejecución no bloqueante vía `ctx.waitUntil()`. |
| **REQ-05** | **Single-Select Filter Bar**           | `src/components/ui/ExperienceFilterBar.astro`  | Selección mutuamente excluyente de empresas con alternancia a "All" al hacer clic en el filtro activo.                                         |
| **REQ-06** | **Search Modal SPA Routing**           | `src/components/ui/UniversalSearchModal.astro` | Navegación por teclado (`Enter`) acoplada a la API `navigate()` de `astro:transitions/client`. Cero full page reloads.                         |
| **REQ-07** | **Domain Migration: `cv` -> `resume`** | `src/content/`, `src/data/`, `src/types/`      | Migración de esquemas en `content.config.ts`, renombrado de archivos, colecciones y componentes de exportación.                                |
| **REQ-08** | **Cross-Browser Print Engine**         | `src/styles/global.css`, `resume/index.astro`  | Reglas `@page` y `@media print` normalizadas. Título dinámico `ArturoNava-CV-{lang}.pdf` sincronizado mediante `beforeprint`/`afterprint`.     |
| **REQ-09** | **Scroll-Margin Offset Normalization** | `src/styles/global.css`, `PageIndexNav.astro`  | Anclas y encabezados con `scroll-margin-top: calc(var(--header-height, 4rem) + 1.5rem)`. Cero oclusiones con sticky header.                    |
| **REQ-10** | **WAAPI Circular Reveal Hardening**    | `src/components/common/ThemeToggle.astro`      | Aislamiento en `::view-transition-group(root)` con contención explícita. Cero parpadeos en Firefox 129+ y Safari iOS.                          |
| **REQ-11** | **Multi-Format Serializers**           | `src/utils/resumeExporters.ts`                 | Serialización reactiva a Markdown puro, JSON tipado, TOML y XML estructurado con inyección dinámica de UTM.                                    |
| **REQ-12** | **Resume Maker Studio Route**          | `src/pages/[...lang]/resume/maker.astro`       | Editor monospace en tiempo real, selector de teléfono, sanitización de enlaces y vista previa idéntica a `/resume`.                            |

---

## 3. System Specification Document (SSD)

### 3.1 Domain Model & Collection Re-Architecture

Se reestructura la ruta de `src/pages/[...lang]/resume.astro` hacia una estructura de directorio modular:

- `src/pages/[...lang]/resume/index.astro` (Vista principal del currículum).
- `src/pages/[...lang]/resume/maker.astro` (Estudio de personalización y edición interactiva).

#### Content Collection Schema (`src/content.config.ts`)

```typescript
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { SUPPORTED_LOCALES } from "./i18n/locales";

const resumeCollection = defineCollection({
  loader: glob({
    pattern: "ArturoNava-Resume-*.md",
    base: "./src/content/resume",
  }),
  schema: z.object({
    canonicalId: z.string().default("arturo-nava-resume"),
    locale: z.enum(SUPPORTED_LOCALES),
    title: z.string().min(1),
    name: z.string().min(1),
    role: z.string().min(1),
    location: z.string().min(1),
    summary: z.string().min(1),
    updatedDate: z.coerce.date(),
    skills: z.record(z.string(), z.array(z.string())),
    contact: z.object({
      email: z.string().email(),
      github: z.string().url(),
      linkedin: z.string().url(),
      website: z.string().url(),
    }),
  }),
});

export const collections = {
  resume: resumeCollection,
  // ... rest of existing collections
};
```

---

### 3.2 Dynamic Telemetry Contract & Port (`src/lib/ports/telemetry.port.ts`)

```typescript
export interface EdgeTelemetryPayload {
  readonly path: string;
  readonly locale: string;
  readonly visitorHash: string;
  readonly referrer?: string;
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
}

export interface TelemetryIngestResult {
  readonly queued: boolean;
  readonly bypassed: boolean;
  readonly reason?: "prefetch" | "bot" | "invalid_payload";
}
```

---

## 4. Requirement-Driven Design & Implementation (RDD)

### 4.1 Asset Pruning Automation (REQ-01)

Comando determinista de eliminación de banners obsoletos:

```bash
# Execute in repository root
rm -f \
  public/banner-16x9-center.png \
  public/banner-16x9-left.png \
  public/banner-16x9-right.png \
  public/banner-3x1-center.png \
  public/banner-3x1-left.png \
  public/banner-3x1-right.png \
  public/banner-4x1-center.png \
  public/banner-4x1-left.png \
  public/banner-4x1-right.png
```

---

### 4.2 Accessible Clipboard Protocol Component (`src/components/ui/EmailCopyButton.astro`) (REQ-02)

Reemplaza todos los hipervínculos `href="mailto:..."` evitando la invocación de clientes de correo nativos.

```astro
---
interface Props {
  email: string;
  label?: string;
  class?: string;
}

const { email, label, class: className = "" } = Astro.props;
---

<email-copy-trigger
  data-email={email}
  class={`inline-flex items-center gap-1.5 ${className}`}
>
  <button
    type="button"
    class="group inline-flex items-center gap-1.5 font-mono text-sm text-neutral-600 transition-colors hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 dark:text-neutral-400 dark:hover:text-neutral-100"
    aria-label={`Copy email address ${email} to clipboard`}
  >
    <span>{label || email}</span>
    <svg
      xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
      class="h-3.5 w-3.5 opacity-60 transition-transform group-hover:scale-110 group-active:scale-95"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
    </svg>
  </button>

  <span
    class="copy-feedback pointer-events-none fixed bottom-6 right-6 z-50 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 font-mono text-xs text-neutral-50 opacity-0 shadow-lg transition-opacity duration-200 dark:border-neutral-200 dark:bg-neutral-100 dark:text-neutral-900"
    role="status"
    aria-live="polite"
  >
    Copied to clipboard
  </span>
</email-copy-trigger>

<script>
  class EmailCopyTrigger extends HTMLElement {
    private button: HTMLButtonElement | null = null;
    private feedback: HTMLElement | null = null;
    private timeoutId: ReturnType<typeof setTimeout> | null = null;

    connectedCallback(): void {
      this.button = this.querySelector("button");
      this.feedback = this.querySelector(".copy-feedback");
      this.button?.addEventListener("click", this.handleCopy);
    }

    disconnectedCallback(): void {
      this.button?.removeEventListener("click", this.handleCopy);
      if (this.timeoutId) clearTimeout(this.timeoutId);
    }

    private handleCopy = async (): Promise<void> => {
      const email = this.dataset.email;
      if (!email) return;

      try {
        await navigator.clipboard.writeText(email);
        if (this.feedback) {
          this.feedback.classList.remove("opacity-0");
          this.feedback.classList.add("opacity-100");
          if (this.timeoutId) clearTimeout(this.timeoutId);
          this.timeoutId = setTimeout(() => {
            this.feedback?.classList.remove("opacity-100");
            this.feedback?.classList.add("opacity-0");
          }, 2000);
        }
      } catch (err) {
        console.error("Clipboard write operation failed:", err);
      }
    };
  }

  if (!customElements.get("email-copy-trigger")) {
    customElements.define("email-copy-trigger", EmailCopyTrigger);
  }
</script>
```

---

### 4.3 Pristine Canonical URLs & SPA Transitions (`src/components/common/SEOHead.astro`) (REQ-03)

```astro
---
import type { Locale } from "../../i18n/locales";

interface Props {
  title: string;
  description: string;
  locale: Locale;
  image?: string;
  articleDate?: Date;
}

const { title, description, locale, image } = Astro.props;

// Strip all search query parameters from canonical URL
const siteOrigin = Astro.site
  ? Astro.site.origin
  : "[https://arturonavax.dev](https://arturonavax.dev)";
const canonicalURL = new URL(Astro.url.pathname, siteOrigin);
---

<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonicalURL.href} />

  <!-- Dynamic Canonical Synchronization across ClientRouter Transitions -->
  <script is:inline>
    document.addEventListener("astro:page-load", () => {
      const canonicalLink = document.querySelector('link[rel="canonical"]');
      if (canonicalLink) {
        const cleanCanonicalUrl =
          window.location.origin + window.location.pathname;
        canonicalLink.setAttribute("href", cleanCanonicalUrl);
      }
    });
  </script>
</head>
```

---

### 4.4 Cloudflare Edge Worker Prefetch Shielding (`cloudflare/worker.ts`) (REQ-04)

Intercepta prefetchings especulativos de Astro y navegadores Chromium para proteger la cuota de lectura y escritura en Cloudflare D1.

```typescript
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

    // 1. Identify Speculative Prefetch Requests
    const isPrefetch =
      request.headers.get("Purpose") === "prefetch" ||
      request.headers.get("Sec-Purpose") === "prefetch" ||
      request.headers.get("X-Astro-Prefetch") !== null;

    // 2. Telemetry Ingestion Endpoint
    if (url.pathname === "/api/v1/telemetry" && request.method === "POST") {
      if (isPrefetch) {
        // Discard prefetch requests immediately without hitting D1
        return new Response(null, { status: 204 });
      }

      ctx.waitUntil(
        (async () => {
          try {
            const payload = (await request.json()) as Record<string, unknown>;
            const userAgent =
              request.headers.get("user-agent")?.slice(0, 512) || "unknown";
            const country = request.headers.get("cf-ipcountry") || "XX";

            await env.DB.prepare(
              `INSERT INTO edge_telemetry_events (
                id, timestamp, path, locale, country, user_agent, visitor_hash
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
              .bind(
                crypto.randomUUID(),
                Date.now(),
                String(payload.path || "").slice(0, 255),
                String(payload.locale || "en").slice(0, 10),
                country,
                userAgent,
                String(payload.visitorHash || "").slice(0, 32),
              )
              .run();
          } catch {
            // Edge telemetry errors are discarded to prevent client disruptions
          }
        })(),
      );

      return new Response(JSON.stringify({ queued: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Delegate to Static Assets
    const response = await env.ASSETS.fetch(request);

    // 4. Immutable Cache-Control for Hashed Assets
    if (
      url.pathname.startsWith("/_astro/") ||
      url.pathname.startsWith("/fonts/")
    ) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(response.body, { status: response.status, headers });
    }

    return response;
  },
};
```

---

### 4.5 Experience Single-Select Filter (`src/components/ui/ExperienceFilterBar.astro`) (REQ-05)

Reemplaza la lógica multi-filtro por un mecanismo mutuamente excluyente.

```astro
---
interface Props {
  companies: Array<{ id: string; name: string }>;
}

const { companies } = Astro.props;
---

<experience-filter-controller class="flex flex-wrap gap-2 py-4">
  <button
    type="button"
    data-company-filter="ALL"
    aria-pressed="true"
    class="filter-pill active"
  >
    All
  </button>
  {companies.map((c) => (
    <button
      type="button"
      data-company-filter={c.id}
      aria-pressed="false"
      class="filter-pill"
    >
      {c.name}
    </button>
  ))}
</experience-filter-controller>

<script>
  class ExperienceFilterController extends HTMLElement {
    connectedCallback(): void {
      const buttons = this.querySelectorAll<HTMLButtonElement>(
        "button[data-company-filter]",
      );

      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          const selectedCompany = btn.dataset.companyFilter;
          const isActive = btn.getAttribute("aria-pressed") === "true";

          if (isActive && selectedCompany !== "ALL") {
            this.setFilter("ALL");
          } else {
            this.setFilter(selectedCompany || "ALL");
          }
        });
      });
    }

    private setFilter(companyId: string): void {
      const buttons = this.querySelectorAll<HTMLButtonElement>(
        "button[data-company-filter]",
      );
      buttons.forEach((b) => {
        const matches = b.dataset.companyFilter === companyId;
        b.setAttribute("aria-pressed", matches ? "true" : "false");
        b.classList.toggle("active", matches);
      });

      const timelineItems = document.querySelectorAll<HTMLElement>(
        "[data-company-entry]",
      );
      timelineItems.forEach((item) => {
        const visible =
          companyId === "ALL" || item.dataset.companyEntry === companyId;
        item.style.display = visible ? "" : "none";
      });
    }
  }

  if (!customElements.get("experience-filter-controller")) {
    customElements.define(
      "experience-filter-controller",
      ExperienceFilterController,
    );
  }
</script>
```

---

### 4.6 Search Modal ClientRouter Integration (`src/components/ui/UniversalSearchModal.astro`) (REQ-06)

```typescript
// Script section inside UniversalSearchModal.astro
import { navigate } from "astro:transitions/client";

function executeNavigation(targetUrl: string): void {
  const modal = document.querySelector<HTMLElement>("#universal-search-dialog");
  if (modal && "close" in modal) {
    (modal as HTMLDialogElement).close();
  }
  navigate(targetUrl);
}

// Intercept selection event
document.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key === "Enter") {
    const activeResult = document.querySelector<HTMLAnchorElement>(
      '.search-result-item[aria-selected="true"]',
    );
    if (activeResult?.href) {
      event.preventDefault();
      executeNavigation(activeResult.href);
    }
  }
});
```

---

### 4.7 Domain Migration & Content Renaming (REQ-07)

1. **Reestructuración de Directorios y Archivos:**

```bash
# Migration commands
mkdir -p src/content/resume
mv src/content/cv/ArturoNava-CV-en.md src/content/resume/ArturoNava-Resume-en.md
mv src/content/cv/ArturoNava-CV-es.md src/content/resume/ArturoNava-Resume-es.md
rm -rf src/content/cv

mv src/data/cv.ts src/data/resume.ts
mv src/components/ui/CvExportBar.astro src/components/ui/ResumeExportBar.astro
mv src/components/ui/CvAttributionBar.astro src/components/ui/ResumeAttributionBar.astro

# Restructure resume page into directory
mkdir -p src/pages/[...lang]/resume
mv src/pages/[...lang]/resume.astro src/pages/[...lang]/resume/index.astro
```

---

### 4.8 Cross-Browser Print Normalization (`src/styles/global.css`) (REQ-08, REQ-09)

```css
/* Scroll margin alignment against sticky navbar */
[id] {
  scroll-margin-top: calc(var(--header-height, 4rem) + 1.5rem);
}

/* Print Styles Normalization (Firefox, Safari, Chromium) */
@media print {
  @page {
    margin: 1.2cm 1cm 1.2cm 1cm;
    size: A4 portrait;
  }

  html,
  body {
    background: #ffffff !important;
    color: #111827 !important;
    font-size: 10pt !important;
    line-height: 1.35 !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  /* Structural UI suppression */
  header,
  footer,
  nav,
  aside,
  dialog,
  .print-hidden,
  #matrix-background {
    display: none !important;
  }

  /* Clean print boundaries */
  article,
  section,
  .resume-entry-block {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
}
```

#### Dynamic Print Title Injection (`src/pages/[...lang]/resume/index.astro`)

```astro
<script is:inline>
  window.addEventListener("beforeprint", () => {
    window.__priorDocTitle = document.title;
    const currentLang = document.documentElement.lang || "en";
    document.title = `ArturoNava-CV-${currentLang}`;
  });

  window.addEventListener("afterprint", () => {
    if (window.__priorDocTitle) {
      document.title = window.__priorDocTitle;
    }
  });
</script>
```

---

### 4.9 WAAPI Circular Reveal Hardening (`src/components/common/ThemeToggle.astro`) (REQ-10)

```typescript
// Inside ThemeToggle circular wave controller
async function executeThemeToggle(event: MouseEvent): Promise<void> {
  const isDark = document.documentElement.classList.contains("dark");
  const targetTheme = isDark ? "light" : "dark";

  if (
    !document.startViewTransition ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    applyTheme(targetTheme);
    return;
  }

  const originX = event.clientX;
  const originY = event.clientY;
  const maxHypotRadius = Math.hypot(
    Math.max(originX, window.innerWidth - originX),
    Math.max(originY, window.innerHeight - originY),
  );

  const transition = document.startViewTransition(() => {
    applyTheme(targetTheme);
  });

  await transition.ready;

  // Enforce isolation in Firefox 129+
  document.documentElement.animate(
    {
      clipPath: [
        `circle(0px at ${originX}px${originY}px)`,
        `circle(${maxHypotRadius}px at ${originX}px${originY}px)`,
      ],
    },
    {
      duration: 380,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      pseudoElement: "::view-transition-new(root)",
    },
  );
}
```

---

### 4.10 Multi-Format Resume Serialization Engine (`src/utils/resumeExporters.ts`) (REQ-11)

```typescript
export interface ResumeDataset {
  name: string;
  role: string;
  location: string;
  summary: string;
  skills: Record<string, string[]>;
  contact: {
    email: string;
    github: string;
    linkedin: string;
    website: string;
  };
}

export function injectUtmParams(url: string, utmContent: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("utm_source", "resume");
    parsed.searchParams.set("utm_medium", "document");
    parsed.searchParams.set("utm_content", utmContent);
    return parsed.toString();
  } catch {
    return url;
  }
}

export function serializeResumeToJSON(
  data: ResumeDataset,
  utmTag: string,
): string {
  const enriched = {
    "@context": "[https://schema.org](https://schema.org)",
    "@type": "Person",
    name: data.name,
    jobTitle: data.role,
    address: data.location,
    description: data.summary,
    url: injectUtmParams(data.contact.website, utmTag),
    sameAs: [
      injectUtmParams(data.contact.github, utmTag),
      injectUtmParams(data.contact.linkedin, utmTag),
    ],
    skills: data.skills,
  };
  return JSON.stringify(enriched, null, 2);
}

export function serializeResumeToTOML(
  data: ResumeDataset,
  utmTag: string,
): string {
  let toml = `name = "${data.name}"\nrole = "${data.role}"\nlocation = "${data.location}"\nsummary = "${data.summary.replace(/"/g, '\\"')}"\n\n`;
  toml += `[contact]\nemail = "${data.contact.email}"\nwebsite = "${injectUtmParams(data.contact.website, utmTag)}"\n\n`;
  toml += `[skills]\n`;
  for (const [category, skillsList] of Object.entries(data.skills)) {
    toml += `${category} = [${skillsList.map((s) => `"${s}"`).join(", ")}]\n`;
  }
  return toml;
}

export function serializeResumeToXML(
  data: ResumeDataset,
  utmTag: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<resume>
  <profile>
    <name>${data.name}</name>
    <role>${data.role}</role>
    <location>${data.location}</location>
    <summary><![CDATA[${data.summary}]]></summary>
    <website>${injectUtmParams(data.contact.website, utmTag)}</website>
  </profile>
</resume>`.trim();
}
```

---

### 4.11 Resume Maker Studio (`src/pages/[...lang]/resume/maker.astro`) (REQ-12)

```astro
---
import BaseLayout from "../../../layouts/BaseLayout.astro";
import ResumeExportBar from "../../../components/ui/ResumeExportBar.astro";
import { getCollection } from "astro:content";
import { SUPPORTED_LOCALES, type Locale } from "../../../i18n/locales";

export function getStaticPaths() {
  return SUPPORTED_LOCALES.map((locale) => ({
    params: { lang: locale === "en" ? undefined : locale },
    props: { locale },
  }));
}

interface Props {
  locale: Locale;
}

const { locale } = Astro.props;
const resumeEntries = await getCollection("resume");
const activeEntry =
  resumeEntries.find((r) => r.data.locale === locale) || resumeEntries[0];
const initialBody = activeEntry?.body || "";
---

<BaseLayout
  $
  {activeEntry.data.name}
  `
  }
  Maker
  Studio
  description="Interactive developer markdown resume generator with real-time preview and export tools."
  locale="{locale}"
  title="{`Resume"
  —
>
  <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4 dark:border-neutral-800">
      <div>
        <h1 class="font-mono text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          Resume Studio Maker
        </h1>
        <p class="font-mono text-xs text-neutral-500">
          Live customization & layout testing
        </p>
      </div>

      <div class="flex items-center gap-3">
        <label for="phone-selector" class="sr-only">
          Add Contact Phone
        </label>
        <select
          id="phone-selector"
          class="rounded border border-neutral-300 bg-white px-2.5 py-1.5 font-mono text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <option value="">No Phone</option>
          <option value="+573000000000">Colombia (+57)</option>
          <option value="+10000000000">USA (+1)</option>
        </select>

        <button
          id="strip-links-action"
          type="button"
          class="rounded border border-neutral-300 px-3 py-1.5 font-mono text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Strip Links
        </button>

        <button
          id="trigger-print-action"
          type="button"
          class="rounded bg-neutral-900 px-3.5 py-1.5 font-mono text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-950"
        >
          Print PDF
        </button>
      </div>
    </header>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div class="flex flex-col">
        <label
          for="markdown-raw-input"
          class="mb-2 font-mono text-xs text-neutral-500"
        >
          Markdown Document Source
        </label>
        <textarea
          id="markdown-raw-input"
          class="h-[760px] w-full resize-none rounded-lg border border-neutral-300 bg-neutral-50 p-4 font-mono text-xs leading-relaxed text-neutral-900 focus:border-neutral-900 focus:outline-none dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200"
          spellcheck="false"
        >{initialBody}</textarea>
      </div>

      <div class="flex flex-col">
        <span class="mb-2 font-mono text-xs text-neutral-500">
          Live Typography Preview
        </span>
        <div
          id="resume-live-preview"
          class="prose prose-neutral h-[760px] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-8 shadow-sm dark:prose-invert dark:border-neutral-800 dark:bg-neutral-900"
        ></div>
      </div>
    </div>

    <div class="mt-8 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <ResumeExportBar currentLocale="{locale}" />
    </div>
  </main>
</BaseLayout>

<script>
  import { marked } from "marked";

  const editor = document.getElementById(
    "markdown-raw-input",
  ) as HTMLTextAreaElement | null;
  const preview = document.getElementById(
    "resume-live-preview",
  ) as HTMLDivElement | null;
  const stripBtn = document.getElementById(
    "strip-links-action",
  ) as HTMLButtonElement | null;
  const printBtn = document.getElementById(
    "trigger-print-action",
  ) as HTMLButtonElement | null;

  function updateLivePreview(): void {
    if (!editor || !preview) return;
    preview.innerHTML = marked.parse(editor.value) as string;
  }

  editor?.addEventListener("input", updateLivePreview);
  updateLivePreview();

  stripBtn?.addEventListener("click", () => {
    if (!editor) return;
    editor.value = editor.value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    updateLivePreview();
  });

  printBtn?.addEventListener("click", () => {
    window.print();
  });
</script>
```

---

## 5. Operational Verification & Testing Matrix (ODD)

| Check ID   | Verification Target   | Test Procedure                                          | Acceptance Threshold                                                                                   |
| :--------- | :-------------------- | :------------------------------------------------------ | :----------------------------------------------------------------------------------------------------- |
| **VAL-01** | Asset Footprint       | Ejecutar `find public/ -name "banner*"`                 | 0 archivos encontrados. Bundle estático sin imágenes huérfanas.                                        |
| **VAL-02** | Mailto Neutralization | Clic en cualquier botón de email                        | Portapapeles actualizado; toast visible; cero ventanas del SO abiertas.                                |
| **VAL-03** | Canonical Cleansing   | Acceder a `/resume?utm_source=test&ref=github`          | `<link rel="canonical">` refleja estrictamente `https://arturonavax.dev/resume`.                       |
| **VAL-04** | Prefetch Shield       | `curl -H "Purpose: prefetch" -X POST /api/v1/telemetry` | HTTP 204 No Content; 0 escrituras en base de datos D1.                                                 |
| **VAL-05** | Filter Exclusivity    | Clic alternado entre empresas en Timeline               | Máximo 1 empresa activa; retorno a "All" al presionar botón activo.                                    |
| **VAL-06** | Search SPA Router     | Seleccionar resultado en modal y presionar `Enter`      | Cambio de ruta instantáneo mediante `ClientRouter` sin flash de recarga.                               |
| **VAL-07** | Print Boundary        | `window.print()` en Chrome, Firefox y Safari            | Nombre `ArturoNava-CV-{lang}.pdf`, cero elementos UI visibles, sin saltos de página dentro de bloques. |
| **VAL-08** | Studio Parity         | Edición de markdown en `/resume/maker`                  | Renderizado sub-16 ms en DOM preview; estilos tipográficos 1:1 con `/resume`.                          |
