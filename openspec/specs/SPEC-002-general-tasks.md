# SPEC-002: REFACTORIZACIÓN GENERAL, HARDENING DE EDGE Y ESTUDIO RESUME MAKER

## Refactorización del Sistema, Blindaje Perimetral en Cloudflare Edge, Motor de Impresión Cross-Browser y Estudio Interactivo de Currículum

```yaml
id: SPEC-002-REFACTOR-FEATURE
title: System Refactoring, Cloudflare Edge Hardening, Cross-Browser Print Engine & Interactive Resume Maker Studio
status: APPROVED / IMPLEMENTED
version: 2.0.0
author: Staff Frontend Performance Architect & Technical SEO Lead
target_stack:
  framework: Astro v7.3.4+ (Compilación Estática Pura / ClientRouter)
  styling: Tailwind CSS v4.3.3+ (CSS-First @theme Engine / LightningCSS)
  runtime: Cloudflare Edge (Workers, D1, R2, Vectorize, Cache API)
  architecture: Hexagonal / Decoupled Ports & Adapters
  locales: [en, es] (EN Primario por defecto -> ES Secundario -> Extensible N)
methodology: Organic/Operational-Driven Development (ODD)
cross_references:
  spec_001: openspec/specs/SPEC-001-big-refactor.md
  spec_002: openspec/specs/SPEC-002-general-tasks.md
  spec_003: openspec/specs/SPEC-003-future-improves.md
  spec_004: openspec/specs/SPEC-004-audit.md
```

---

## 1. Resumen Ejecutivo, Diagnóstico y Alineación Metodológica

### 1.1. Contexto y Diagnóstico del Sistema

Esta especificación técnica consolida la refactorización integral, la higiene de activos y las mejoras de interacción en el cliente y perimetrales del proyecto `personal-website`. Aborda las siguientes deficiencias detectadas:

1. **Polución de Activos Obsoletos en `public/`:** Existencia de múltiples variantes de banners pre-renderizados (`public/banner-*`) no consumidos por ningún componente, generando sobrecarga en el repositorio y en el empaquetado de producción.
2. **Fricción de Experiencia de Usuario con Enlaces `mailto:`:** El uso directo de hipervínculos con esquema `mailto:` provocaba aperturas accidentales y bloqueantes de clientes nativos de correo no deseados por el usuario. Se requería un protocolo seguro de portapapeles asíncrono con confirmación accesible (`aria-live="polite"`).
3. **Contaminación de Parámetros UTM en Canónicos:** Enlaces entrantes con parámetros de campañas (`utm_source`, `ref`, etc.) contaminaban la URL canónica evaluada dinámicamente en navegaciones SPA mediante `ClientRouter`.
4. **Degradación de Cuotas Edge por Prefetching Especulativo:** Las solicitudes especulativas de Astro y motores Chromium (`Purpose: prefetch` / `Sec-Purpose: prefetch`) impactaban los endpoints de telemetría, disparando escrituras innecesarias en Cloudflare D1.
5. **Inconsistencias en el Motor de Impresión (@media print):** Discrepancias visuales y saltos de página inapropiados en Safari, Firefox y Chrome al generar el PDF del currículum, sumado a títulos de documento no sincronizados con el idioma activo.
6. **Deuda de Nomenclatura de Dominio (`cv` vs `resume`):** Desalineación conceptual en esquemas de datos, nombres de carpetas (`src/content/cv` vs estándar internacional `resume`) y componentes asociados.
7. **Ausencia de un Estudio Monospace de Personalización:** Carencia de un entorno en vivo (`/resume/maker`) que permita modificar Markdown en tiempo real, alternar selectores de teléfono para ofertas internacionales y serializar exportaciones a JSON-LD, TOML y XML estructurado con atribución UTM.

### 1.2. Metodología ODD (Organic/Operational-Driven Development)

Flujo único de trabajo: Authorize → Explore → Resolve Uncertainty → Classify → Track (before first write, create `odd/tasks/<feature>.md`) → Implement (test-first when deterministic) → Check → Close.

- **Explore:** Según `AGENTS.md`, usar `codegraph` antes de cualquier refactor (sect. 6); los 7 specs se exploraron previamente (`SPEC-001` a `SPEC-007`).
- **Classify:** Trabajo sustancial (7 archivos, estructura `odd/`, multi-file edit); se creó `odd/convert-specs/tasks.md` con 9 sub-tareas antes de cualquier modificación.
- **Track:** Este archivo (`SPEC-002`) se actualiza por tareas con commits de unidad de trabajo (`feat(spec): standardize methodology to ODD`).
- **Implement / Check:** Todo cambio preserva los invariantes técnicos (`REQ-*`, `VAL-*`) y pasa `bun run check`; la verificación ODD incluye `CLS = 0.000`, `LCP < 800ms`, `INP < 50ms`.
- **Close:** Resultado verificado; memoria guardada (esta decisión) si es clave.

### 1.3. Matriz de Trazabilidad y Referencias Cruzadas entre Especificaciones

- **Conexión con [SPEC-001: Arquitectura Enterprise Edge y Rutas Dinámicas i18n](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-001-big-refactor.md):** SPEC-002 consume la infraestructura de rutas dinámicas `src/pages/[...lang]/` establecida por SPEC-001 para estructurar modularmente `/resume/index.astro` y `/resume/maker.astro` sin duplicar plantillas entre idiomas.
- **Conexión con [SPEC-003: Arquitectura Hexagonal y Cloudflare Edge Desacoplado](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-003-future-improves.md):** SPEC-002 implementa el blindaje perimetral contra prefetch especulativo que protege las cuotas del adaptador `D1TelemetryAdapter` formalizado en SPEC-003, y alinea los exportadores de datos con los puertos de serialización.
- **Conexión con [SPEC-004: Auditoría Arquitectónica Global y Verificación Extrema](file:///home/arthurnavah/repos/github.com/arturonavax/personal-website/openspec/specs/SPEC-004-audit.md):** SPEC-004 audita las compuertas de rendimiento introducidas en SPEC-002 (CLS = 0.000 durante la impresión, canónicos sanitizados sin polución UTM, y aislamiento de animaciones WAAPI).

---

## 2. Matriz de Requerimientos y Compuertas Cuantitativas (RDD)

### 2.1. Requerimientos Funcionales y Técnicos (REQ-*)

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
| **REQ-11** | **Multi-Format Serializers**           | `src/utils/resumeExporters.ts`                 | Serialización reactiva a Markdown puro, JSON tipado (Schema.org), TOML y XML estructurado con inyección dinámica de UTM.                       |
| **REQ-12** | **Resume Maker Studio Route**          | `src/pages/[...lang]/resume/maker.astro`       | Editor monospace en tiempo real, selector de teléfono, sanitización de enlaces y vista previa idéntica a `/resume`.                            |

### 2.2. Criterios de Aceptación Cuantitativos y Umbrales de Rendimiento

| Métrica / Parámetro              | Condición de Aprobación (PASS)                        | Condición de Fallo (FAIL)                                   | Método de Medición                            |
| :------------------------------- | :---------------------------------------------------- | :---------------------------------------------------------- | :-------------------------------------------- |
| **Higiene de `public/`**         | 0 archivos `banner-*` en `public/`                    | $\ge 1$ archivo huérfano detectado                          | `find public/ -name "banner*"`                |
| **Invocación de Correo**         | 0 aperturas de cliente nativo (`mailto:`)             | Cualquier apertura forzada del SO                           | Pruebas de interacción automatizadas          |
| **Canónicos Limpios**            | URL canónica idéntica a `origin + pathname`           | Parámetros UTM o filtros presentes en `link[rel=canonical]` | Inspección DOM en carga y tras navegación SPA |
| **Protección D1**                | 0 mutaciones en base de datos en peticiones prefetch  | Inserción en D1 con cabecera `Purpose: prefetch`            | Simulación HTTP curl a `/api/v1/telemetry`    |
| **Rendimiento de Impresión**     | 0 cortes de bloques tipográficos entre páginas        | Corte huérfano en cabeceras o items de experiencia          | Renderizado de prueba PDF en Chromium y Gecko |
| **Presupuesto de Estudio Maker** | Latencia de parseo Markdown $< 16\text{ ms}$ (60 FPS) | Bloqueo de hilo principal $> 50\text{ ms}$ en escritura     | Profiling de CPU en DevTools                  |

---

## 3. Especificación del Sistema, Tipos e Invariantes Formales (SDD)

### 3.1. Reestructuración del Modelo de Dominio y Colecciones

Se reestructura la ruta `src/pages/[...lang]/resume.astro` hacia un subdirectorio modular:

- `src/pages/[...lang]/resume/index.astro` (Vista principal del currículum para lectura e impresión).
- `src/pages/[...lang]/resume/maker.astro` (Estudio de personalización y edición interactiva).

#### Esquema de Colección de Contenido (`src/content.config.ts`)

Conforme a la actualización de Zod v4, las validaciones de cadenas formateadas (`url`, `email`) emplean constructores de primer nivel:

```typescript
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { SUPPORTED_LOCALES } from "./i18n/locales";

export const localizedBaseSchema = z.object({
  canonicalId: z
    .string()
    .describe("Stable entity identifier shared across all language variants")
    .optional(),
  translationKey: z.string().optional(),
  locale: z.enum(SUPPORTED_LOCALES),
  draft: z.boolean().default(false),
  visible: z.boolean().default(true),
});

const resumeCollection = defineCollection({
  loader: glob({
    pattern: "ArturoNava-Resume-*.md",
    base: "./src/content/resume",
  }),
  schema: localizedBaseSchema.extend({
    canonicalId: z.string().default("arturo-nava-resume"),
    title: z.string().min(1),
    name: z.string().min(1),
    role: z.string().min(1),
    location: z.string().min(1),
    summary: z.string().min(1),
    updatedDate: z.coerce.date(),
    skills: z.record(z.string(), z.array(z.string())),
    contact: z.object({
      email: z.email(),
      github: z.url(),
      linkedin: z.url(),
      website: z.url(),
    }),
  }),
});

export const collections = {
  resume: resumeCollection,
};
```

---

### 3.2. Contrato de Telemetría Dinámica en el Edge (`src/lib/ports/telemetry.port.ts`)

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

export interface TelemetryPort {
  recordPageview(payload: EdgeTelemetryPayload): Promise<TelemetryIngestResult>;
}
```

---

### 3.3. Contrato de Serialización Multi-Formato (`src/utils/resumeExporters.ts`)

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
```

---

## 4. Verificación Operativa, Telemetría y Validación en Tiempo de Ejecución (ODD)

### 4.1. Higiene Automatizada de Activos (REQ-01)

Comando determinista de eliminación de banners obsoletos en la raíz del proyecto:

```bash
# Ejecutar en la raíz del repositorio
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

### 4.2. Componente de Portapapeles Accesible (`src/components/ui/EmailCopyButton.astro`) (REQ-02)

Neutraliza enlaces `href="mailto:..."`, implementando copia asíncrona mediante la Clipboard API y feedback visual/sonoro accesible:

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
      xmlns="http://www.w3.org/2000/svg"
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

### 4.3. Sanitización Canónica y Sincronización SPA (`src/components/common/SEOHead.astro`) (REQ-03)

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

// Normalización canónica absoluta sin query parameters
const siteOrigin = Astro.site ? Astro.site.origin : "https://arturonavax.dev";
const canonicalURL = new URL(Astro.url.pathname, siteOrigin);
---

<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonicalURL.href} />

  <!-- Sincronización canónica reactiva en transiciones ClientRouter -->
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

### 4.4. Blindaje contra Prefetch en Cloudflare Worker (`cloudflare/worker.ts`) (REQ-04)

Descarta peticiones especulativas sin afectar la cuota de operaciones D1:

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

    // 1. Identificar peticiones especulativas de prefetch
    const isPrefetch =
      request.headers.get("Purpose") === "prefetch" ||
      request.headers.get("Sec-Purpose") === "prefetch" ||
      request.headers.get("X-Astro-Prefetch") !== null;

    // 2. Endpoint de ingestión de telemetría
    if (url.pathname === "/api/v1/telemetry" && request.method === "POST") {
      if (isPrefetch) {
        // Descartar prefetch inmediatamente con 204 No Content
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
            // Failsafe silencioso para no degradar al cliente
          }
        })(),
      );

      return new Response(JSON.stringify({ queued: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Delegación a activos estáticos
    const response = await env.ASSETS.fetch(request);

    // 4. Inmutabilidad en activos con hash
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

### 4.5. Filtro Mutuamente Excluyente (`src/components/ui/ExperienceFilterBar.astro`) (REQ-05)

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

### 4.6. Enrutamiento SPA en Modal de Búsqueda (`UniversalSearchModal.astro`) (REQ-06)

```typescript
import { navigate } from "astro:transitions/client";

function executeNavigation(targetUrl: string): void {
  const modal = document.querySelector<HTMLElement>("#universal-search-dialog");
  if (modal && "close" in modal) {
    (modal as HTMLDialogElement).close();
  }
  navigate(targetUrl);
}

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

### 4.7. Migración de Dominio y Limpieza de Nomenclatura (REQ-07)

Comandos ejecutados para normalizar el dominio `cv` hacia `resume`:

```bash
# Migración de colecciones y archivos de datos
mkdir -p src/content/resume
mv src/content/cv/ArturoNava-CV-en.md src/content/resume/ArturoNava-Resume-en.md
mv src/content/cv/ArturoNava-CV-es.md src/content/resume/ArturoNava-Resume-es.md
rm -rf src/content/cv

mv src/data/cv.ts src/data/resume.ts
mv src/components/ui/CvExportBar.astro src/components/ui/ResumeExportBar.astro
mv src/components/ui/CvAttributionBar.astro src/components/ui/ResumeAttributionBar.astro

# Estructurar directorio modular para resume
mkdir -p src/pages/[...lang]/resume
mv src/pages/[...lang]/resume.astro src/pages/[...lang]/resume/index.astro
```

---

### 4.8. Normalización de Impresión y Margen de Desplazamiento (`global.css`) (REQ-08, REQ-09)

```css
/* Scroll-margin alineado contra el encabezado sticky */
[id] {
  scroll-margin-top: calc(var(--header-height, 4rem) + 1.5rem);
}

/* Normalización de impresión universal (@media print) */
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

  /* Supresión de interfaz estructural */
  header,
  footer,
  nav,
  aside,
  dialog,
  .print-hidden,
  #matrix-background {
    display: none !important;
  }

  /* Prevención estricta de saltos de página dentro de bloques de contenido */
  article,
  section,
  .resume-entry-block {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
}
```

#### Inyección Dinámica del Título de Impresión (`src/pages/[...lang]/resume/index.astro`)

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

### 4.9. Aislamiento de Animación WAAPI en Alternador de Tema (`ThemeToggle.astro`) (REQ-10)

```typescript
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

  // Aislamiento explícito de pseudo-elemento para Firefox 129+ y WebKit
  document.documentElement.animate(
    {
      clipPath: [
        `circle(0px at ${originX}px ${originY}px)`,
        `circle(${maxHypotRadius}px at ${originX}px ${originY}px)`,
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

### 4.10. Motores de Serialización Multi-Formato (`src/utils/resumeExporters.ts`) (REQ-11)

Generación de exportaciones estructuradas con `@id` invariable (`https://arturonavax.dev/#person`) e inyección UTM:

```typescript
export function serializeResumeToJSON(
  data: ResumeDataset,
  utmTag: string,
): string {
  const enriched = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": "https://arturonavax.dev/#person",
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

### 4.11. Estudio Monospace Resume Maker (`src/pages/[...lang]/resume/maker.astro`) (REQ-12)

Ruta interactiva que combina edición en tiempo real de Markdown, selector de prefijo telefónico y botones de sanitización/impresión directa:

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
  title={`Resume Maker Studio — ${activeEntry.data.name}`}
  description="Interactive developer markdown resume generator with real-time preview and export tools."
  locale={locale}
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
      <ResumeExportBar currentLocale={locale} />
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

### 4.12. Matriz de Validación Operativa (VAL-*)

| ID         | Objetivo de Verificación | Procedimiento Operativo de Prueba                       | Umbral de Aceptación                                                                            |
| :--------- | :----------------------- | :------------------------------------------------------ | :---------------------------------------------------------------------------------------------- |
| **VAL-01** | Huella de Activos        | Ejecutar `find public/ -name "banner*"`                 | 0 archivos encontrados. Bundle estático sin imágenes huérfanas.                                 |
| **VAL-02** | Neutralización Mailto    | Clic en cualquier botón de email                        | Portapapeles actualizado; toast visible; cero ventanas del SO abiertas.                         |
| **VAL-03** | Sanitización Canónica    | Acceder a `/resume?utm_source=test&ref=github`          | `<link rel="canonical">` refleja estrictamente `https://arturonavax.dev/resume`.                |
| **VAL-04** | Blindaje Prefetch        | `curl -H "Purpose: prefetch" -X POST /api/v1/telemetry` | HTTP 204 No Content; 0 escrituras en base de datos D1.                                          |
| **VAL-05** | Filtro Exclusivo         | Clic alternado entre empresas en Timeline               | Máximo 1 empresa activa; retorno a "All" al presionar botón activo.                             |
| **VAL-06** | Router SPA en Búsqueda   | Seleccionar resultado en modal y presionar `Enter`      | Cambio de ruta instantáneo mediante `ClientRouter` sin flash de recarga.                        |
| **VAL-07** | Límites de Impresión     | `window.print()` en Chrome, Firefox y Safari            | Nombre `ArturoNava-CV-{lang}.pdf`, cero elementos UI visibles, sin saltos de página en bloques. |
| **VAL-08** | Paridad de Estudio Maker | Edición de markdown en `/resume/maker`                  | Renderizado sub-16 ms en DOM preview; estilos tipográficos 1:1 con `/resume`.                   |

---

## 5. Matriz de Certificación, Criterios de Aceptación y Estado de Implementación (DoD)

```
================================================================================
          SPEC-002: CERTIFICACIÓN DE IMPLEMENTACIÓN (DEFINITION OF DONE)
================================================================================

[x] REQ-01 / VAL-01: 9 variantes de banners obsoletos eliminadas de public/.
[x] REQ-02 / VAL-02: EmailCopyButton.astro desplegado; mailto: completamente neutralizado.
[x] REQ-03 / VAL-03: SEOHead.astro sanitiza parámetros de consulta en el enlace canónico.
[x] REQ-04 / VAL-04: cloudflare/worker.ts intercepta prefetch especulativo con HTTP 204.
[x] REQ-05 / VAL-05: ExperienceFilterBar.astro opera con filtro de selección única con alternancia.
[x] REQ-06 / VAL-06: UniversalSearchModal.astro ejecuta navigate() de ClientRouter sin full reload.
[x] REQ-07: Dominio cv completamente migrado a resume en schemas, colecciones y rutas.
[x] REQ-08 / VAL-07: Reglas @page y @media print garantizan PDF limpio y título sincronizado.
[x] REQ-09: scroll-margin-top configurado con offset del header en todas las anclas con ID.
[x] REQ-10: WAAPI Circular Reveal contenido y validado en Firefox 129+, Chromium y Safari.
[x] REQ-11: resumeExporters.ts serializa JSON-LD (@id unificado), TOML y XML con UTM.
[x] REQ-12 / VAL-08: /resume/maker y /es/resume/maker completamente operativos y verificados.
================================================================================
```
