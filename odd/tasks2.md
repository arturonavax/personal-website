### Diagnóstico de Arquitectura y Rendimiento (Core Web Vitals & SPA)

El proyecto posee una base técnica sólida basada en **Astro v7.3.4**, **Tailwind CSS v4.3.3** y el ecosistema **Cloudflare Edge**. Sin embargo, presenta fricciones críticas de rendimiento, regresiones de layout, sobrecarga de scripts y fallas de consistencia en el comportamiento tipo SPA que impiden alcanzar puntuaciones perfectas de 100/100 en Core Web Vitals y Best Practices.

---

#### 1. Cuellos de Botella de Rendimiento y Core Web Vitals (CWV)

- **Saturación de Red y Errores 503 por Prefetching Agresivo:**
- _Causa raíz:_ El worker de Cloudflare (`cloudflare/worker.ts`) y los adaptadores de circuit breaker (`bot-circuit-breaker.adapter.ts`, `prefetch-circuit-breaker.adapter.ts`) detectan ráfagas de peticiones con cabeceras `Purpose: prefetch` o `Sec-Purpose: prefetch` disparadas por Astro `hover`/`viewport`. Al superar los umbrales de rate limit en Edge D1/KV, el edge worker responde con `503 Service Unavailable`, contaminando la consola del navegador y penalizando la métrica de _Best Practices_.
- _Solución:_ Discriminar las solicitudes especulativas en el worker perimetral para omitir el registro pesado en D1, servir contenido estático directamente desde la caché de Cloudflare Edge con cabeceras `Cache-Control: public, max-age=31536000, immutable` y aplicar bypass al circuit breaker para tráfico prefetch verificado.

- **Inestabilidad Visual (CLS > 0.000) por Cálculo Dinámico de Elementos Flotantes:**
- _Causa raíz:_ En `src/layouts/BaseLayout.astro`, las funciones `autoOrderFloatingStack` y `updateToastCollision` alteran directamente `item.style.order`, clases de elevación (`elevated-for-toast`) y estilos calculados tras cada ciclo de `astro:page-load` y redimensionamiento. Esto provoca _layout reflows_ en el hilo principal durante la hidratación inicial.
- _Solución:_ Reemplazar la manipulación imperativa del DOM por clases utilitarias puras en CSS con `@container` queries, `flex-direction: column-reverse` nativo y CSS Grid auto-placement.

- **Retraso de Interacción (INP > 50ms) y Bloqueo del Hilo Principal:**
- _Causa raíz:_ Se ejecutan bloques `<script is:inline>` pesados en el `<head>` y se registran múltiples escuchas de eventos cinéticos en `window` (`keydown`, `keyup`, `resize`, `visualViewport`). La cinemática de scroll tipo Vim (`kineticScrollLoop`) ejecuta un bucle continuo de `requestAnimationFrame` sin desacoplamiento de entrada.
- _Solución:_ Aislar los atajos globales y la navegación Vim en Web Workers o listeners pasivos de baja prioridad (`scheduler.postTask` / `requestIdleCallback`), asegurando que la respuesta a clics en modales y filtros sea inferior a 16ms.

- **Desplazamiento Vertical Oculto bajo el Header (Scroll Padding / Margin):**
- _Causa raíz:_ Al navegar mediante enlaces con hash (`#contact`, anclas de artículos o `PageIndexNav`), los elementos de destino quedan cubiertos por el `Header` fijo en navegadores móviles y Firefox debido a la ausencia de `scroll-margin-top: calc(var(--header-height) + 1.5rem)` en los encabezados `h1`, `h2`, `h3` y `section`.

---

#### 2. Inconsistencias de Lógica y Fallas Funcionales

- **Recarga Completa en Modal de Búsqueda Universal (`UniversalSearchModal.astro`):**
- _Problema:_ Al pulsar `Enter` en el input de búsqueda o sobre un resultado, el formulario dispara el evento de envío tradicional (`<form onsubmit>`), forzando una recarga de página clásica en lugar de una transición SPA gestionada por `ClientRouter.navigate()`.

- **Enlaces `mailto:` Invasivos:**
- _Problema:_ Los enlaces de correo ejecutan clientes externos de correo de forma disruptiva. Deben comportarse como un disparador de copiado directo al portapapeles con confirmación visual (toast) y retención del foco.

- **Desincronización de URLs Canónicas ante Navegación en Timeline y Parámetros UTM:**
- _Problema:_ Al navegar por los filtros de la experiencia laboral o compartir enlaces enriquecidos con `?utm_*`, la etiqueta `<link rel="canonical">` en el `<head>` no conserva su estado canónico absoluto estricto (debe omitir query params volátiles).

- **Colisión Visual en el Reveal Circular de Cambio de Tema en Firefox:**
- _Problema:_ La API nativa de `document.startViewTransition` en navegadores Gecko presenta desajustes de sincronización entre `::view-transition-old(root)` y `::view-transition-new(root)`, generando un salto brusco en lugar de una animación radial fluida.

- **Filtros de Búsqueda en `/experience`:**
- _Problema:_ La barra de filtrado permite selección múltiple errática entre empresas, dispersando la vista en estados vacíos en vez de actuar bajo un modelo de selección exclusiva (radio-pill) con opción de reinicio limpio.

- **Atajo "p" Visible en Vista Móvil:**
- _Problema:_ El indicador visual del atajo de teclado (`KbdBadge`) se muestra en pantallas táctiles (`max-width: 768px`) donde no existe teclado físico.

---

### Master Prompt para Agente de Código

A continuación se presenta la especificación estructurada en formato Markdown, diseñada para ser suministrada a un agente de codificación autónomo (Cursor Composer, Claude Code, Cline o Windsurf) para la ejecución integral de las correcciones.

````markdown
# TASK SPECIFICATION: 100/100 CORE WEB VITALS, SPA STABILITY & BEST PRACTICES ARCHITECTURAL REFACTOR

You are acting as a Staff Frontend Performance Architect and Cloudflare Edge Engineer.
Your objective is to resolve ALL performance bottlenecks, logical flaws, layout shifts, and SPA navigation inconsistencies in this Astro v7 + Tailwind CSS v4 repository without removing any existing functional features.

---

## 1. CORE OPERATING PRINCIPLES & CONSTRAINTS

1. **Zero Functionality Stripping:** Retain all existing features (Vim navigation, Matrix canvas background, universal search, coffee sponsorship, language suggestions, resume generator/exporters, analytics telemetry, view transitions). Fix logic and performance bugs in-place.
2. **Metrics Mandate:**
   - Google Lighthouse: 100/100 across Mobile and Desktop (Performance, Accessibility, Best Practices, SEO).
   - Core Web Vitals: Cumulative Layout Shift (CLS) = 0.000, Largest Contentful Paint (LCP) < 0.8s, Interaction to Next Paint (INP) < 50ms.
3. **SPA Fluidity:** Ensure client-side navigation using Astro's `ClientRouter` is instantaneous and never triggers unintended full-page document reloads.
4. **Code Language Policy:** Technical code, CSS class names, TypeScript types, and comments must be in ENGLISH.

---

## 2. PHASED EXECUTION INSTRUCTIONS

### PHASE 1: EDGE WORKER & PREFETCH CIRCUIT-BREAKER RESILIENCE

#### Files to Modify:

- `cloudflare/worker.ts`
- `src/lib/adapters/cloudflare/prefetch-circuit-breaker.adapter.ts`
- `src/lib/adapters/cloudflare/bot-circuit-breaker.adapter.ts`

#### Technical Requirements:

1. **Prefetch Request Isolation:** Detect client prefetch headers (`Purpose === 'prefetch'`, `Sec-Purpose === 'prefetch'`, or query param `?astro-prefetch`).
2. **Bypass Write Telemetry:** Do not trigger D1 database writes or circuit breaker increment counters on prefetch requests. Serve cached response headers immediately.
3. **Avoid 503 Flooding:** Return `204 No Content` or cached static assets with `Cache-Control: public, max-age=31536000, immutable` for asset prefetch checks, eliminating console 503 errors.

---

### PHASE 2: UNIVERSAL SEARCH & CLIENT ROUTER SPA INTEGRATION

#### File to Modify:

- `src/components/ui/UniversalSearchModal.astro`

#### Technical Requirements:

1. **Prevent Form Submission Reloads:**
   - Intercept the modal `<form>` `submit` event: call `e.preventDefault()`.
2. **Astro ClientRouter Navigation:**
   - When the user presses `Enter` on an input or selects a search result item, close the modal cleanly, restore `document.body` overflow styles, and navigate using `navigate(targetUrl)` from `astro:transitions/client`.
   - Ensure the focus trap is released and focus returns to the initiating search button or target main content.

---

### PHASE 3: CANONICAL URL & QUERY-PARAM SANITIZATION

#### Files to Modify:

- `src/components/common/SEOHead.astro`
- `src/layouts/BaseLayout.astro`
- `src/lib/seo/schema-builder.ts`

#### Technical Requirements:

1. **Strict Canonical URLs:**
   - Ensure the generated `<link rel="canonical" href="...">` is always an absolute, normalized URL stripped of all tracking query parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `ref`).
2. **Dynamic Route Updates:**
   - In `BaseLayout.astro` during `astro:after-swap`, synchronize the canonical link href with `window.location.origin + window.location.pathname` to ensure client transitions update document head metadata accurately.

---

### PHASE 4: ACCESSIBILITY, EMAIL COPY & RESPONSIVE SHORTCUTS

#### Files to Modify:

- `src/components/ui/ContactSection.astro`
- `src/components/ui/EmailCopyButton.astro`
- `src/components/ui/ResumeExportBar.astro`
- `src/components/common/Header.astro`

#### Technical Requirements:

1. **Email Behavior Normalization:**
   - Replace open-ended `mailto:` links with an interactive copy-to-clipboard button.
   - On click, copy the email address (`arturo@arturonavax.dev`) to the system clipboard, trigger an accessible live-region notification/toast (`Email copied to clipboard`), and keep the user on the page without launching third-party desktop mail applications.
2. **Hide Keyboard Badges on Touch/Mobile Devices:**
   - In `ResumeExportBar.astro`, `Header.astro`, and all navigation elements, conditionally hide keyboard badges (`<kbd>`, e.g., the `"p"` download shortcut badge) using Tailwind CSS: `hidden md:inline-flex`.

---

### PHASE 5: ELIMINATE CLS & STREAMLINE FLOATING ACTION STACK

#### Files to Modify:

- `src/layouts/BaseLayout.astro`
- `src/styles/global.css`
- `src/components/ui/PageIndexNav.astro`
- `src/components/ui/BackToTopButton.astro`

#### Technical Requirements:

1. **Zero-Reflow Floating Stack:**
   - Deprecate JavaScript-driven layout mutation loops (`autoOrderFloatingStack` and `updateToastCollision`).
   - Implement native CSS positioning for `#floating-actions-stack` using CSS Flexbox with `flex-direction: column-reverse`, `gap: 0.75rem`, and fixed `pointer-events-none` container dimensions to guarantee `CLS = 0.000`.
2. **Scroll Offset Margin:**
   - In `src/styles/global.css`, declare global scroll margins for all heading anchors and target sections:
     ```css
     :target,
     h1[id],
     h2[id],
     h3[id],
     section[id] {
       scroll-margin-top: calc(var(--header-height, 4rem) + 1.5rem);
     }
     ```
   - This resolves Firefox and mobile navigation issues where content scrolled behind the sticky navigation bar.

---

### PHASE 6: LOGO & ABOUT SCROLL-TO-TOP OPTIMIZATION

#### File to Modify:

- `src/components/common/Header.astro`

#### Technical Requirements:

1. **Same-Page Scroll Optimization:**
   - On the Brand Logo and "About" navigation link, add click handlers:
     - Check if `window.location.pathname` matches the target URL (`/` or `/es/`).
     - If already on the active page, intercept with `e.preventDefault()` and execute `window.scrollTo({ top: 0, behavior: 'smooth' })`.
     - Update URL hash if appropriate, bypassing redundant view-transition lifecycles.

---

### PHASE 7: EXPERIENCE FILTER BAR EXCLUSIVITY

#### File to Modify:

- `src/components/ui/ExperienceFilterBar.astro`

#### Technical Requirements:

1. **Single-Select / Mutual Exclusivity Logic:**
   - Refactor the company filter pills from multi-select array toggles to a single active filter state (`activeCompany: string | null`).
   - Clicking an active company pill resets the filter to show all experiences.
   - Clicking an inactive company pill sets it as the sole active filter.
   - Synchronize URL search params cleanly without triggering full document page reloads.

---

### PHASE 8: THEME TOGGLE WAAPI CIRCULAR REVEAL CROSS-BROWSER FIX

#### File to Modify:

- `src/utils/theme-reveal.ts`
- `src/styles/global.css`

#### Technical Requirements:

1. **Firefox & Fallback Stabilization:**
   - Verify feature support: `if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches)`.
   - Prevent background color blinking during transition by locking CSS pseudo-elements:
     ```css
     ::view-transition-old(root),
     ::view-transition-new(root) {
       animation: none;
       mix-blend-mode: normal;
       display: block;
     }
     ```
   - For light-to-dark vs dark-to-light modes, enforce explicit `z-index` stacking orders on the transition pseudo-elements so the circular wave reveals the incoming DOM without white flashes or frame tearing.

---

## 3. VERIFICATION & VALIDATION PROTOCOL

Run and pass all automated audits and test suites:

```bash
# 1. Type and template integrity check
pnpm run check

# 2. Automated architectural and CLS verification
bun test

# 3. Production build
pnpm run build

# 4. Mobile & Desktop Lighthouse Audit (Target: 100/100)
pnpm run audit:mobile
```
````

```

---

### Hoja de Ruta de Implementación para el Agente

| Fase | Ámbito de Intervención | Archivos Involucrados | Criterio de Éxito |
| :--- | :--- | :--- | :--- |
| **Fase 1** | Cloudflare Edge Worker & Circuit Breakers | `cloudflare/worker.ts`, adaptadores prefetch | Eliminación de errores 503 en peticiones de prefetch. |
| **Fase 2** | Modal de Búsqueda SPA | `src/components/ui/UniversalSearchModal.astro` | Navegación instantánea vía `navigate()` sin recarga de ventana. |
| **Fase 3** | SEO Canónico Estricto | `src/components/common/SEOHead.astro`, `BaseLayout.astro` | Canonical limpio sin query strings de tracking en todas las rutas. |
| **Fase 4** | Accesibilidad & UI Móvil | `ContactSection.astro`, `EmailCopyButton.astro`, `Header.astro` | Enlace `mailto:` sustituido por copia interactiva; badges de atajos ocultos en pantallas `< 768px`. |
| **Fase 5** | Estabilidad de Layout (CLS) | `BaseLayout.astro`, `global.css`, `PageIndexNav.astro` | CLS = 0.000 verificado; anclas visibles bajo el header fijo con `scroll-margin-top`. |
| **Fase 6** | Ergonomía de Navegación | `Header.astro`, `BrandLogo.astro` | Clic en Logo o About en ruta activa realiza scroll suave hacia arriba sin recargar. |
| **Fase 7** | Lógica de Filtros | `src/components/ui/ExperienceFilterBar.astro` | Filtro por empresa exclusivo (radio behavior) sin estados vacíos accidentales. |
| **Fase 8** | WAAPI Reveal Cross-Browser | `src/utils/theme-reveal.ts`, `src/styles/global.css` | Transición radial de tema sin saltos en Firefox y Chrome. |

Al suministrar este master prompt a tu agente de código, la ejecución se concentrará estrictamente en resolver los cuellos de botella sin introducir código redundante ni alterar las funcionalidades nativas del portafolio.

```
