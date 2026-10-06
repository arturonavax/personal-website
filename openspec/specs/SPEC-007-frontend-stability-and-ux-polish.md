# SPEC-007: Frontend Glitch Resolution, Layout Stabilization & UX Polish

## Metadata

- **Author**: Arturo Nava & Staff Performance Architect
- **Status**: Implemented
- **Date**: 2026-10-05
- **Priority**: High (P1)
- **Target Files**:
  - `src/components/common/Header.astro`
  - `src/components/ui/LanguageSuggestionBanner.astro`
  - `src/components/common/LanguageSwitcher.astro`
  - `src/components/ui/MatrixBackground.astro`
  - `src/pages/[...lang]/experience/[slug].astro`
  - `src/pages/[...lang]/index.astro`
  - `src/styles/resume.css`
  - `src/styles/global.css`
  - `tests/spec-007/spec-007.test.ts`

---

## 1.1 Methodology — ODD (Organic/Operational-Driven Development)

Flujo estándar ODD: Authorize → Explore (CodeGraph + skills) → Resolve Uncertainty → Classify (track in `odd/convert-specs/tasks.md`) → Implement → Check (`bun run check`, audit gates, CWV) → Close (verified outcome, memory if key).

- **Classify:** Substantial work → `odd/convert-specs/tasks.md` created before first edit.
- **Explore:** `codegraph` used before any `src/components/` or `src/styles/` edit.
- **Check:** All changes must preserve `CLS = 0.000`, `LCP < 800ms`, `INP < 50ms`; build passes `bun run build` / `bun run check`.

---

## 1. Problem Statement & Root Cause Analysis

1. **Header Scroll Glitch / Flickering on Wide Delta Scrolls**:
   - _Root Cause_: El listener de scroll carece de histéresis y commuta clases abruptamente ante saltos grandes de scroll (por ejemplo, desde el footer hasta el header). Los clicks en anchors disparan múltiples eventos donde `deltaY` oscila bruscamente, provocando layout thrashing y reinicio de animaciones.
2. **First-Load Content Flashes & Blank Zones**:
   - _Root Cause_: Bloques de texto condicionados a hidratación client-side o afectados por FOIT (Flash of Invisible Text) al cargar fuentes, dejando contenedores vacíos sin transición de entrada progresiva.
3. **Language Suggestion Banner ("Contenido disponible en") Consistency & Storage**:
   - _Root Cause_: Falta de integración global en la página principal (`/` o `/[...lang]/index.astro`). El estado de descarte no debe persistir indefinidamente ni compartirse en `localStorage`, sino aislarse a la sesión activa (`sessionStorage`). Si el usuario cambia manualmente el idioma, el banner debe suprimirse de inmediato.
4. **Incorrect "More" Nav Item Highlight on `/services`**:
   - _Root Cause_: Coincidencia de ruta ambigua en el dropdown "More" que evalúa positivamente rutas bajo `/services`, a pesar de que "Services" es un elemento visible de primer nivel en el menú principal.
5. **Matrix Background Reset & Non-SPA Transition on Experience Arrow Navigation**:
   - _Root Cause_: La navegación por teclado en experiencias utiliza asignación directa `window.location.href`, forzando un ciclo MPA completo en lugar de invocar `navigate()` del `ClientRouter`. El canvas no cuenta con `transition:persist`.
6. **Print Margin Asymmetry between `/resume/` and `/resume/maker/`**:
   - _Root Cause_: Disparidad de márgenes `@page` y paddings residuales de los contenedores interactivos entre la vista estática y la vista interactiva de `/resume/maker/`.

---

## 2. Technical Architecture & Detailed Requirements

### Component 1: Permanent Sticky Header Stabilization (`src/components/common/Header.astro`)

- **Rock-Solid Sticky Docking**:
  - Eliminar auto-ocultamiento dinámico (`transform: translate3d(...)` / `.header-hidden`): el ocultamiento del header en scroll rompe las cabeceras `sticky` secundarias en subpáginas (p. ej. en `/experience/` y la timeline de experiencia con `sticky top-14`) y genera flickering/layer-churn con `backdrop-filter: blur(...)` en Chromium.
  - El encabezado superior se ancla de forma 100% permanente e inmutable con CSS nativo: `position: sticky; top: 0; z-index: 50;` con `contain: layout style;` y sin repaints ni transformaciones por scroll.
  - Enlaces ancla y saltos de scroll mantienen el header firme sin saltos de layout ni glitches.

---

### Component 2: Progressive Content Entrance & Zero FOUC (`src/styles/global.css`)

- **SSR-First Visibility**:
  - Todo el contenido estático debe ser legible desde el HTML inicial sin depender de la inicialización de scripts.
  - Para áreas con carga asíncrona o transiciones de contenido, usar un keyframe de blur progresivo en el compositor:

```css
@keyframes progressiveContentFade {
  0% {
    opacity: 0;
    filter: blur(8px);
    transform: translateY(6px);
  }
  100% {
    opacity: 1;
    filter: blur(0);
    transform: translateY(0);
  }
}

.progressive-reveal {
  animation: progressiveContentFade 300ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@media (prefers-reduced-motion: reduce) {
  .progressive-reveal {
    animation: none;
    opacity: 1;
    filter: none;
    transform: none;
  }
}
```

---

### Component 3: Session-Isolated Language Suggestion Banner

- **Global Injection**:
  - Incorporar `<LanguageSuggestionBanner />` en el layout raíz o directamente en `src/pages/[...lang]/index.astro` además de las subpáginas.
- **Session Keys**:
  - Descarte manual por `X`: `sessionStorage.setItem('lang_banner_dismissed', 'true')`
  - Conmutación manual de idioma (`<LanguageSwitcher />`): `sessionStorage.setItem('lang_manual_override', 'true')`
- **Render Guard**:

```typescript
const isDismissed = sessionStorage.getItem("lang_banner_dismissed") === "true";
const isManualOverride =
  sessionStorage.getItem("lang_manual_override") === "true";

if (isDismissed || isManualOverride) {
  bannerElement.hidden = true;
  bannerElement.style.display = "none";
}
```

---

### Component 4: Navigation Active State Isolation (`src/components/common/Header.astro`)

- **Route Matching Logic**:
  - Aislar expresamente la ruta `/services`:

```typescript
const isServicesActive =
  pathname.startsWith("/services") ||
  pathname.startsWith("/es/services") ||
  pathname.startsWith("/en/services");

const isMoreActive =
  MORE_ROUTES.some((route) => pathname.startsWith(route)) && !isServicesActive;
```

---

### Component 5: Matrix Background Persistence & SPA Navigation

- **Matrix Canvas Persistence (`src/components/ui/MatrixBackground.astro`)**:
  - Envolver el canvas en un contenedor con directiva de persistencia:

```astro
<div id="matrix-canvas-container" transition:persist="matrix-canvas-root">
  <canvas id="matrix-canvas" aria-hidden="true"></canvas>
</div>
```

- **Arrow Navigation & DOM Layering (`src/pages/[...lang]/experience/[slug].astro`)**:
  - Reemplazar asignaciones `window.location.href` por `navigate` de Astro.
  - Ordenación de capas en el DOM: Las flechas de viaje temporal (steppers `data-timeline-nav="past"` y `data-timeline-nav="future"`) se posicionan en el DOM **después** del `<header id="role-header">` con `z-index: 30` (y `sticky-experience-header` elevado a `z-index: 40`), garantizando que jamás queden ocluidas detrás del banner del empleo.

---

### Component 6: Print CV Margin Synchronization & Firefox Chrome Elimination (`src/styles/global.css`)

- **Supresión de Chrome en Firefox & Padding Idéntico a la Previsualización HTML**:
  - Para eliminar completamente cabeceras y pies de página nativos de Firefox (título, URL, timestamp y paginación fea), `@page` debe forzarse a `margin: 0mm !important`.
  - Reseteo total de contenedores ancestros (`main`, `#cv-sheet-container`, `#resume-maker-workspace`, `#preview-pane-container`) a `padding: 0 !important; margin: 0 !important;` para evitar sangrados fantasma en print.
  - El sangrado visual real del documento (A4) se fija de forma exacta e idéntica a la previsualización HTML (`md:p-12` = 48px) en el contenedor de la hoja tanto en `/resume/` (`#cv-document-sheet`) como en `/resume/maker/` (`#resume-live-preview`):

```css
@page {
  margin: 0mm !important;
  size: A4 portrait;
}

@media print {
  html,
  body {
    background: #ffffff !important;
    color: #000000 !important;
    font-size: 10pt;
    line-height: 1.4;
    margin: 0 !important;
    padding: 0 !important;
  }

  main,
  #cv-sheet-container,
  #resume-maker-workspace,
  #preview-pane-container {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    max-width: none !important;
    display: block !important;
  }

  #cv-document-sheet,
  #resume-live-preview {
    padding: 48px !important; /* Exact match to HTML preview md:p-12 */
    margin: 0 auto !important;
    width: 100% !important;
    max-width: 210mm !important;
    border: none !important;
    box-shadow: none !important;
  }

  .resume-maker-toolbar,
  .resume-export-bar,
  header,
  footer {
    display: none !important;
  }
}
```

---

## 3. Low-Cost Local Testing Suite

Comando de ejecución rápida (<500ms):

```bash
pnpm test tests/spec-007/spec-007.test.ts
```

Fichero de pruebas (`tests/spec-007/spec-007.test.ts`):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("SPEC-007: Frontend Glitches & UX Verification", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  describe("Requirement 3: Language Banner Session Isolation", () => {
    it("suppresses banner when sessionStorage has lang_banner_dismissed", () => {
      sessionStorage.setItem("lang_banner_dismissed", "true");
      const isVisible = !(
        sessionStorage.getItem("lang_banner_dismissed") === "true"
      );
      expect(isVisible).toBe(false);
    });

    it("suppresses banner when language was switched manually", () => {
      sessionStorage.setItem("lang_manual_override", "true");
      const isVisible = !(
        sessionStorage.getItem("lang_banner_dismissed") === "true" ||
        sessionStorage.getItem("lang_manual_override") === "true"
      );
      expect(isVisible).toBe(false);
    });
  });

  describe('Requirement 4: Nav "More" vs "Services" Active State', () => {
    function getActiveNav(pathname: string) {
      const isServices = pathname.includes("/services");
      const moreRoutes = ["/resume/maker", "/links"];
      const isMore =
        moreRoutes.some((r) => pathname.includes(r)) && !isServices;
      return { isServices, isMore };
    }

    it("activates Services and NOT More when on /services routes", () => {
      const { isServices, isMore } = getActiveNav(
        "/es/services/backend-performance-audit",
      );
      expect(isServices).toBe(true);
      expect(isMore).toBe(false);
    });
  });

  describe("Requirement 5: Matrix Background & SPA Transition Contract", () => {
    it("MatrixBackground component must declare transition:persist", () => {
      const matrixCode = readFileSync(
        resolve(process.cwd(), "src/components/ui/MatrixBackground.astro"),
        "utf-8",
      );
      expect(matrixCode).toMatch(/transition:persist/);
    });

    it("Experience page shortcut handler must import and use navigate from astro:transitions/client", () => {
      const expSlugCode = readFileSync(
        resolve(process.cwd(), "src/pages/[...lang]/experience/[slug].astro"),
        "utf-8",
      );
      expect(expSlugCode).toMatch(/astro:transitions\/client/);
      expect(expSlugCode).not.toMatch(/window\.location\.href\s*=/);
    });
  });

  describe("Requirement 6: Print CV Margin Synchronization", () => {
    it("global.css defines @page margin: 0mm !important and uniform 48px sheet padding", () => {
      const globalCss = readFileSync(
        resolve(process.cwd(), "src/styles/global.css"),
        "utf-8",
      );
      expect(globalCss).toMatch(/@page\s*\{[^}]*margin:\s*0mm\s*!important/i);
      expect(globalCss).toMatch(/padding:\s*48px\s*!important/i);
    });
  });
});
```

---

## 4. Acceptance Criteria Checklist

- [x] **Header Scroll Stability**: No hay parpadeos ni ciclos rápidos de visibilidad al desplazarse entre anclas distantes (`#contact` -> `#about`).
- [x] **Zero Layout/Text Glitch**: El texto del primer render está disponible de inmediato con animación de desenfoque progresivo opcional en el compositor.
- [x] **Banner Session Storage**: El aviso de idioma aparece en la home, se cierra definitivamente con la `X` durante la sesión y no reaparece si el usuario conmutó manualmente de idioma.
- [x] **Menú More Aislado**: `/services/*` activa exclusivamente el enlace `Services`; `More` permanece inactivo.
- [x] **Persistencia SPA en Matrix**: Navegar entre experiencias con flechas mantiene el fondo de Matrix sin reiniciar el canvas ni recargar la página completa.
- [x] **Márgenes de Impresión Idénticos**: La vista de impresión en `/resume/` y `/resume/maker/` comparte márgenes `@page` exactos y elimina espaciados residuales de contenedor.
- [x] **Tests Verificados**: `pnpm test tests/spec-007/spec-007.test.ts` pasa en verde.

- [] El Print PDF CV de /resume/maker/ debe arreglar su problema de "resolucion", debe mostrarse con la misma calidad que el Print PDF CV que en /resume/maker/
- [] En el Print PDF CV lo clickeable no debe tener subrayado al menos que se haya especificado con algo aparte de el link.
- [] Todo el texto dentro del Print PDF CV debe ser seleccionable de forma normal, no texto virtual ni nada raro.
