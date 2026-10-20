# Role & Mission: Autonomous Staff Astro v7 & Cloudflare Edge Performance Architect

Actúa como un **Staff Frontend Performance Architect (+15 años de experiencia)** especializado en **Astro v7.3.4**, **Tailwind CSS v4**, **Web Workers (`OffscreenCanvas`)** y **Cloudflare Edge (Workers Static Assets, D1, R2, Turnstile, Cache API)**.

Tu misión es ejecutar una optimización quirúrgica de principio a fin en este repositorio (`arturonavax/personal-website`) para corregir todos los cuellos de botella reportados por Lighthouse en producción (`https://arturonavax.dev/`), llevando **Performance de 56 a 100** y **Best Practices de 81 a 100**, manteniendo **Accessibility en 100** y **SEO en 100**.

---

## 1. Reglas Estrictas de No-Regresión (Invariantes Innegociables)

1. **Cero Ruptura de Tests (ODD / OpenSpec):**
   - El proyecto cuenta con una suite exhaustiva de pruebas en `tests/**` (`tests/odd-tasks.test.ts`, `tests/audit.spec.ts`, `tests/deployment-registry.test.ts`, `tests/spec-003/**` hasta `tests/spec-012/**`) y un script de auditoría en `scripts/audit-codebase.ts`.
   - Muchas pruebas verifican invariantes mediante análisis estático (expresiones regulares sobre el código fuente, atributos HTML, nombres de funciones, estructura de archivos o cabeceras).
   - **ANTES de modificar cualquier archivo**, DEBES leer los tests asociados en `tests/**` para conocer qué selectores, atributos `data-*`, firmas exportadas o patrones de código esperan las pruebas.
2. **Cero Pérdida de Funcionalidad:**
   - Mantén intactas las transiciones de vista (`ClientRouter`), la animación circular de cambio de tema con WAAPI (`src/utils/theme-reveal.ts` y `src/components/common/ThemeToggle.astro`), la prevención de FOUC en `src/layouts/BaseLayout.astro`, la histéresis de scroll del header (`src/lib/navigation/header-scroll.ts`), la navegación `src/components/ui/PageIndexNav.astro`, los atajos de teclado (`src/lib/navigation/escape-router.ts`), el filtro de proyectos/experiencia/blog y la telemetría asíncrona con Cloudflare D1 (`cloudflare/worker.ts` y `src/components/ui/EdgeViewCounter.astro`).
3. **Protocolo de Idioma en Código:**
   - Todo código fuente, comentarios, identificadores, tipos TypeScript, nombres de clases CSS y mensajes de commit deben estar estrictamente en **inglés**.

---

## 2. Diagnóstico de Métricas a Resolver (Objetivos Exactos)

Debes erradicar las siguientes alertas exactas de Lighthouse:

1. **`Minimize main-thread work — 13.6 s`** y **`Avoid long main-thread tasks — 20 long tasks found`**
2. **`Reduce JavaScript execution time — 3.9 s`**
3. **`Reduce unused JavaScript — Est savings of 24 KiB`**
4. **`Improve image delivery — Est savings of 18 KiB`**
5. **`Render-blocking requests`** y **`Network dependency tree`**
6. **`Use efficient cache lifetimes — Est savings of 8 KiB`**
7. **`Best Practices (81/100): Uses deprecated APIs — 2 warnings found`**:
   - `StorageType.persistent is deprecated` y `The Protected Audience API is deprecated` originados en `/cdn-cgi/challenge-platform/scripts/jsd/main.js:1`.

---

## 3. Plan de Ejecución Autónoma Paso a Paso

Ejecuta las siguientes fases en orden secuencial. No omitas ningún paso ni uses placeholders.

### Fase 1: Reconocimiento Forense y Línea Base de Tests

1. Ejecuta la suite de pruebas actual (`pnpm test` o `npx vitest run`) para confirmar el estado base.
2. Lee e inspecciona íntegramente los siguientes archivos antes de escribir código:
   - Configuración: `package.json`, `astro.config.mjs`, `wrangler.jsonc`, `public/_headers`.
   - Layouts y Head: `src/layouts/BaseLayout.astro`, `src/components/common/SEOHead.astro`, `src/styles/global.css`.
   - Componentes con loops/animaciones y estado: `src/components/ui/MatrixBackground.astro`, `src/scripts/matrix.worker.ts`, `src/utils/visibility.ts`, `src/components/ui/SystemTelemetryDemo.astro`, `src/components/ui/SimulationCard.astro`, `src/components/ui/TypewriterTicker.astro`.
   - Imagen Hero y LCP: `src/components/ui/HeroHeaderBanner.astro`, `src/components/ui/OptimizedVisual.astro`, `src/pages/[...lang]/index.astro`.
   - Modales y Navegación: `src/components/ui/UniversalSearchModal.astro`, `src/components/ui/ContactFormModal.astro`, `src/components/ui/CoffeeSponsorshipModal.astro`, `src/components/ui/OnlineJudgesModal.astro`, `src/components/ui/ShortcutsModal.astro`, `src/components/ui/PageIndexNav.astro`, `src/lib/navigation/header-scroll.ts`, `src/components/ui/EdgeViewCounter.astro`.
   - Edge Worker y Scripts: `cloudflare/worker.ts`, `scripts/filter-lh.mjs`, `scripts/audit-codebase.ts`, y todos los archivos dentro de `tests/**`.

---

### Fase 2: Erradicación de los 13.6 s de Main-Thread Work y 20 Long Tasks

El problema principal de rendimiento ocurre porque `MatrixBackground.astro`, `SystemTelemetryDemo.astro`, `SimulationCard.astro` y `TypewriterTicker.astro` ejecutan bucles `requestAnimationFrame` o `setInterval` durante la ventana de medición de Lighthouse (primeros 0–5 segundos tras el `load`), impidiendo que la CPU entre en estado idle y saturando las fases de _Style & Layout_ y _Composite Layers_.

1. **Refactorizar `src/utils/visibility.ts`:**
   - Conserva intactas todas las exportaciones actuales para no romper ningún import ni test en `tests/**`.
   - Asegúrate de que el observador de visibilidad combine:
     - `IntersectionObserver` (`isIntersecting === true`).
     - Pausa automática cuando `document.hidden === true` (`visibilitychange`).
     - **Idle / Interaction Gate para el arranque inicial**: ningún loop periódico o animación continua debe arrancar durante la ventana crítica de carga inicial (primeros `3500ms` después de `window.load`) a menos que el usuario realice una interacción real (`scroll`, `pointerdown`, `keydown`, `touchstart` con `{ once: true, passive: true }`).
     - Detección de dispositivos restringidos o emulación móvil de Lighthouse: expón una utilidad limpia para detectar si el entorno tiene `prefers-reduced-motion: reduce`, `navigator.connection?.saveData === true` o CPU muy limitada.

2. **Optimizar `src/components/ui/MatrixBackground.astro` y `src/scripts/matrix.worker.ts`:**
   - **Respetar invariantes de tests:** Mantén el uso de `OffscreenCanvas` (`transferControlToOffscreen`), la importación del Web Worker (`matrix.worker.ts`) y los mensajes esperados por `tests/spec-008/**` o `tests/spec-010/**`.
   - **Diferir el montaje del Worker fuera de la ventana TBT de Lighthouse:** No inicies el bucle de renderizado del Worker de forma síncrona en `DOMContentLoaded` ni inmediatamente en `astro:page-load`. En su lugar, espera a la primera interacción del usuario (`scroll`, `pointermove`, `pointerdown`, `touchstart`, `keydown`) o a un `requestIdleCallback` ejecutado después de un retardo post-load (`>= 3500ms` tras `window.load`), asegurándote de cancelar el timer en `astro:before-preparation`.
   - **Throttling inteligente en `src/scripts/matrix.worker.ts`:**
     - Limita el frame rate del bucle en el Worker a ~20–24 FPS (`const FRAME_INTERVAL = 1000 / 22`) en lugar de 60 FPS sin límite, reduciendo drásticamente el costo de transferencia de texturas del `OffscreenCanvas` al compositor en móviles.
     - Limita el `devicePixelRatio` máximo a `Math.min(window.devicePixelRatio || 1, 1.25)`.
     - Pausa inmediatamente el loop cuando el canvas no esté en el viewport (si aplica) o cuando `document.hidden` sea `true`.

3. **Aislar `SystemTelemetryDemo.astro`, `SimulationCard.astro` y `TypewriterTicker.astro`:**
   - Revisa cada `setInterval`, `setTimeout` recursivo y `requestAnimationFrame` en estos tres componentes.
   - Asegúrate de que **ninguno** se ejecute durante la carga inicial hasta que:
     1. El componente esté visible en el viewport (`IntersectionObserver`).
     2. Se haya cumplido el gate de estabilización post-LCP o primera interacción del usuario.
   - El estado inicial renderizado por SSR en el HTML debe mostrar valores válidos y estáticos desde el frame 0 (para que visualmente la página esté completa sin necesidad de que corra el JS durante el test de Lighthouse).
   - Evita cualquier lectura de geometría del DOM (`offsetWidth`, `clientHeight`, `getBoundingClientRect`) seguida de escrituras dentro de los ticks para garantizar **0 Forced Reflows**.

4. **Optimizar `src/lib/navigation/header-scroll.ts` y `src/components/ui/PageIndexNav.astro`:**
   - Verifica que todos los listeners de `scroll` y `resize` usen `{ passive: true }`.
   - Asegúrate de que la inicialización en `astro:page-load` no realice lecturas sincrónicas de layout (`getBoundingClientRect` / `offsetTop`) en bucle tras mutar clases CSS; difiere el cálculo inicial de posiciones de secciones a `requestIdleCallback` o al primer evento `scroll`.

---

### Fase 3: Reducción de Unused JavaScript (Ahorro de 24 KiB) y Carga Diferida de Modales

Lighthouse reporta **24 KiB de JavaScript sin usar** porque el código de los modales interactivos y utilidades secundarias se descarga, parsea y ejecuta en el arranque aunque todos los modales estén cerrados (`hidden` / `<dialog>`).

1. **Lazy-Initialization de Modales (`UniversalSearchModal.astro`, `ContactFormModal.astro`, `CoffeeSponsorshipModal.astro`, `OnlineJudgesModal.astro`, `ShortcutsModal.astro`):**
   - Mantén el HTML SSR y los IDs/atributos de los modales intactos para que ningún test de `tests/**` falle.
   - Refactoriza los bloques `<script>` de estos componentes para que en la carga inicial únicamente registren un listener ultraligero (delegación de eventos o escucha del evento personalizado / clic en el botón de apertura / atajo de teclado).
   - En `UniversalSearchModal.astro`: asegúrate de que `/search-index.json` y la lógica pesada de filtrado/búsqueda se carguen **exclusivamente** cuando el usuario abra el modal de búsqueda (o haga `pointerenter`/`focus` en el botón de búsqueda), jamás en `astro:page-load`.
   - En `ContactFormModal.astro`: carga el script de Cloudflare Turnstile (`https://challenges.cloudflare.com/turnstile/v0/api.js`) de forma estrictamente perezosa **solo cuando se abre el modal de contacto**, nunca en la carga inicial de la página.
2. **Diferir Telemetría en `src/components/ui/EdgeViewCounter.astro`:**
   - Asegúrate de que cualquier `fetch` o `navigator.sendBeacon` hacia los endpoints de telemetría se ejecute después de que la página haya cargado completamente y tras un `requestIdleCallback` (o `setTimeout(..., 3000)`), de modo que no compita con el LCP ni aparezca en el **Network dependency tree** de Lighthouse.

---

### Fase 4: Eliminación de Render-Blocking Requests y Optimización del Network Dependency Tree

1. **Inlining Total de CSS en `astro.config.mjs`:**
   - Configura `build: { inlineStylesheets: 'always' }` en `astro.config.mjs` para que Astro incruste las hojas de estilo directamente en el `<head>`, logrando **0 peticiones CSS bloqueantes de renderizado**.
   - Asegúrate de mantener `compressHTML: true` y la minificación con `lightningcss` / `esbuild` compatibles con el resto de la configuración de Vite/Astro.
2. **Optimización de Precarga de Fuentes en `src/components/common/SEOHead.astro` y `src/styles/global.css`:**
   - Inspecciona las etiquetas `<link rel="preload" as="font" ...>` en `src/components/common/SEOHead.astro`.
   - Si se están precargando tanto `Geist-Variable.woff2` como `GeistMono-Variable.woff2` al mismo tiempo, ambas compiten por el ancho de banda crítico en móvil (disparando la alerta roja **Network dependency tree** en Lighthouse).
   - Mantén el `<link rel="preload">` **únicamente** para la fuente principal de texto/títulos (`/fonts/Geist-Variable.woff2` con `type="font/woff2" crossorigin`).
   - Verifica primero si algún test en `tests/**` exige el preload de `GeistMono-Variable.woff2`:
     - Si ningún test lo exige, elimina el preload de `GeistMono-Variable.woff2` para que el navegador la descargue solo cuando la necesite.
     - En `src/styles/global.css`, asegúrate de que `@font-face` para `Geist` y `Geist Mono` tengan `font-display: swap` y métricas de fallback (`ascent-override`, `descent-override`, `size-adjust`) para mantener **CLS = 0.000**.
3. **Contención de Renderizado DOM (`content-visibility: auto`):**
   - Añade contención CSS (`content-visibility: auto; contain-intrinsic-size: auto 500px;`) a las secciones debajo del pliegue (_below the fold_) en la página principal (`src/pages/[...lang]/index.astro` / componentes secundarios como `AiEngineeringSection`, `ArchitecturalPillars`, `ExperienceTimeline`, `ContactSection`) cuidando de no romper los anclajes de scroll (`#id`) ni los tests de `tests/**`.

---

### Fase 5: Optimización de Entrega de Imágenes (Ahorro de 18 KiB)

Lighthouse reporta **`Improve image delivery — Est savings of 18 KiB`** en la página principal.

1. Inspecciona `src/components/ui/OptimizedVisual.astro`, `src/components/ui/HeroHeaderBanner.astro` y el uso de `src/assets/arturonava.jpg`.
2. Ajusta el componente `<Picture />` o `<Image />` de `astro:assets`:
   - Define `widths` ajustados exactamente a los tamaños reales de renderizado CSS en móvil y desktop (por ejemplo: `widths={[80, 96, 128, 160, 240]}`) y un atributo `sizes` preciso acorde a las clases Tailwind del avatar (por ejemplo: `sizes="(max-width: 640px) 80px, (max-width: 1024px) 96px, 120px"` o las dimensiones exactas del contenedor en `HeroHeaderBanner.astro`).
   - Ajusta `quality` a `62`–`65` para AVIF/WebP en `OptimizedVisual.astro` (o directamente en el archivo de origen si es necesario sin perder nitidez) para reducir el peso del candidato seleccionado por Lighthouse en Moto G Power (DPR 1.75x / 2x) en al menos **18 KiB**.
   - Asegúrate de que la imagen LCP tenga `loading="eager"`, `fetchpriority="high"` y `decoding="async"`, y que cualquier otra imagen debajo del pliegue tenga `loading="lazy"`.

---

### Fase 6: Cache Lifetimes (8 KiB) y Solución Definitiva a Best Practices (81 -> 100)

En la captura de Lighthouse, **Best Practices cae a 81** exclusivamente por 2 warnings en `/cdn-cgi/challenge-platform/scripts/jsd/main.js:1`:

- `StorageType.persistent is deprecated. Please use standardized navigator.storage instead.`
- `The Protected Audience API is deprecated and will be removed in a future release.`
  Además, ese mismo script de ~8 KiB y/o activos de raíz sin cabecera inmutable causan la alerta **`Use efficient cache lifetimes — Est savings of 8 KiB`**.

1. **Endurecer Caché de Activos en `public/_headers` y `cloudflare/worker.ts`:**
   - En `public/_headers`, asegura `Cache-Control: public, max-age=31536000, immutable` para `/_astro/*`, `/fonts/*`, `/favicon.svg`, `/favicon.ico`, `/favicon-48x48.png`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png` y `/og-default.png`, manteniendo todos los headers de seguridad (`CSP`, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`, etc.) exigidos por `tests/**`.
   - En `cloudflare/worker.ts`, verifica que al servir activos estáticos inmutables desde `env.ASSETS.fetch(request)`, las respuestas conserven o incluyan `Cache-Control: public, max-age=31536000, immutable`.
   - Añade `browsing-topics=(), run-ad-auction=(), join-ad-interest-group=()` al header `Permissions-Policy` en `public/_headers` y `cloudflare/worker.ts` (respetando el formato que validen los tests en `tests/**`) para deshabilitar explícitamente el acceso a Protected Audience API en el navegador.

2. **Neutralizar `/cdn-cgi/challenge-platform/scripts/jsd/main.js`:**
   - **En `cloudflare/worker.ts`:** Si una respuesta HTML pasa por el Worker y contiene la inyección `<script.*src=["'][^"']*\/cdn-cgi\/challenge-platform\/scripts\/jsd\/main\.js[^"']*["'][^>]*><\/script>` o el snippet inline `__CF$cv$params`, límpialo de forma segura antes de entregar la respuesta HTML.
   - **Automatización de Zona Cloudflare (`scripts/disable-cf-jsd.mjs` o en el pipeline de despliegue):** Dado que Cloudflare puede inyectar `jsd/main.js` en la capa exterior del Edge después de que termina el Worker cuando `bot_management.enable_js` o `fight_mode` están activos en la zona, crea o actualiza un script ejecutable (y documéntalo en `cloudflare/security/waf-rules.md`) que invoque la API de Cloudflare (`PUT /zones/:zone_id/bot_management` con `{"fight_mode": false, "enable_js": false}`) si las variables `CLOUDFLARE_ZONE_ID` y `CLOUDFLARE_API_TOKEN` están disponibles en el entorno.

---

### Fase 7: Bucle de Validación Obligatorio (Cero Errores)

Antes de dar por terminada tu tarea, ejecuta y verifica cada uno de estos pasos:

1. **Pruebas Unitarias y de Especificación (ODD/OpenSpec):**

   ```bash
   pnpm test
   ```
   - **Requisito:** 100% de los tests en `tests/**` deben pasar en verde. Si algún test falla por un cambio tuyo, ajusta tu implementación para cumplir el contrato del test sin perder la optimización de rendimiento.

2. **Auditoría Estática del Codebase y Typecheck:**

   ```bash
   pnpm build
   ```
   - Si existe un script de auditoría (`scripts/audit-codebase.ts`), ejecútalo para verificar que no se violó ninguna regla arquitectónica.

3. **Auditoría Real con Lighthouse / `scripts/filter-lh.mjs`:**
   - Levanta el servidor de previsualización local del build de producción (`pnpm preview` o `npx wrangler dev`) y ejecuta Lighthouse en modo móvil (o el script `node scripts/filter-lh.mjs` si está configurado en el proyecto) para comprobar empíricamente que:
     - **Performance >= 99–100**
     - **Best Practices = 100**
     - **Accessibility = 100**
     - **SEO = 100**
     - **Total Blocking Time (TBT) = 0 ms** (0 Long Tasks durante la carga)
     - **Cumulative Layout Shift (CLS) = 0.000**

4. **Reporte Final:**
   - Entrega un resumen técnico conciso en español detallando:
     - Archivos modificados y el cambio exacto aplicado en cada uno.
     - Resultados de la suite de tests (`pnpm test`) y del build (`pnpm build`).
     - Métricas de rendimiento antes vs. después.
     - El comando exacto de `curl` / Wrangler en caso de que se requiera purgar la caché de Cloudflare Zone tras el deploy.
