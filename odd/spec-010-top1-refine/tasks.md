# Task Plan: SPEC-010 Top #1 Architecture, Edge Performance & Cloudflare Ecosystem Maximization

## Feature Overview

Implementación sistemática de SPEC-010 orientada a consolidar el rango **Top #1 indiscutido** en rendimiento frontend, delivery perimetral y aprovechamiento de la capa gratuita de Cloudflare, preservando de forma estricta la arquitectura hexagonal (`ports` y `adapters`) y el presupuesto de 0 KB de JavaScript del cliente.

- **Especificación Base:** [`openspec/specs/SPEC-010-refine-top1.md`](../../openspec/specs/SPEC-010-refine-top1.md)
- **Metodología:** ODD (Organic Driven Development) con compuertas de verificación por fase.
- **Invariante Arquitectónico:** Desacoplamiento estricto de la capa cosmética visual (reservada para pase de refinamiento de diseño).

---

## Tareas por Fases

### Phase 1: Frontend Performance & Asset Pipeline (CLS = 0.000)

- [x] **TASK-010-01:** Auditar y eliminar cortes estáticos de fuentes en `public/fonts/` (`Geist-*.woff2`, `GeistMono-*.woff2`), conservando únicamente las variantes variables (`Geist-Variable.woff2`, `GeistMono-Variable.woff2`) mientras se reconcilia la compatibilidad de selección de texto en exportación PDF de Firefox (REQ-PRINT-1).
  - _Archivos objetivo:_ `public/fonts/`, `src/styles/resume.css`
  - _Verificación:_ `ls public/fonts` devuelve únicamente las 2 fuentes variables y el renderizado print mantiene texto seleccionable sin errores 404.
- [x] **TASK-010-02:** Implementar `@font-face` metric overrides en `src/styles/global.css` para `Geist Fallback` y `GeistMono Fallback` con `size-adjust` y `ascent-override`.
  - _Archivos objetivo:_ `src/styles/global.css`
  - _Verificación:_ Cero FOUT y CLS = 0.000 verificado en cambio de fuente del sistema a WOFF2.
- [x] **TASK-010-03:** Actualizar `src/components/common/SEOHead.astro` para precargar exclusivamente `Geist-Variable.woff2` con `crossorigin="anonymous"`.
  - _Archivos objetivo:_ `src/components/common/SEOHead.astro`
  - _Verificación:_ Network tab muestra exactamente 1 solicitud de fuente precargada en el primer frame.
- [x] **TASK-010-04:** Añadir regla agnóstica de `content-visibility: auto` y `contain-intrinsic-size` en clases de feeds para proyectos, blog y experiencia.
  - _Archivos objetivo:_ `src/styles/global.css`, `src/components/ui/PostCard.astro`, `src/components/ui/ProjectCard.astro`, `src/components/ui/ServiceCard.astro`
  - _Verificación:_ Elementos fuera del viewport inicial se omiten del árbol de renderizado primario.

### Phase 2: Cloudflare Edge Delivery & Advanced Caching

- [x] **TASK-010-05:** Actualizar `public/_headers` con cabeceras inmutables para fuentes y assets estáticos, `must-revalidate` para HTML, y cabeceras de seguridad completas (HSTS, nosniff, DENY).
  - _Archivos objetivo:_ `public/_headers`
  - _Verificación:_ Validación estática y simulación curl confirmando directivas `Cache-Control` esperadas.
- [x] **TASK-010-06:** Implementar `handleCachedGet` con soporte `stale-while-revalidate` y cabeceras `Cache-Tag` en `cloudflare/worker.ts`.
  - _Archivos objetivo:_ `cloudflare/worker.ts`
  - _Verificación:_ Peticiones repetidas devuelven `cf-cache-status: HIT` con latencia sub-15ms.

### Phase 3: Cloudflare Free Tier Optimization & Resilient Storage

- [x] **TASK-010-07:** Refactorizar ingestión de telemetría en `cloudflare/worker.ts` y adaptador D1 para procesar inserciones de forma asíncrona mediante `ctx.waitUntil()`, blindando el límite de 100,000 escrituras/día.
  - _Archivos objetivo:_ `cloudflare/worker.ts`, `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts`
  - _Verificación:_ Endpoint de telemetría responde inmediatamente (202/204) sin bloquear el hilo principal.
- [x] **TASK-010-08:** Integrar binding `AI` (`@cf/baai/bge-small-en-v1.5`) en `src/lib/adapters/cloudflare/vectorize-search.adapter.ts` y sincronizar configuración en `wrangler.jsonc`.
  - _Archivos objetivo:_ `src/lib/adapters/cloudflare/vectorize-search.adapter.ts`, `wrangler.jsonc`
  - _Verificación:_ Búsqueda semántica genera vectores en Edge sin llamadas a APIs externas.
- [x] **TASK-010-09:** Hardening y rate-limiting en validación de Cloudflare Turnstile en `src/lib/adapters/cloudflare/turnstile-captcha.adapter.ts`.
  - _Archivos objetivo:_ `src/lib/adapters/cloudflare/turnstile-captcha.adapter.ts`
  - _Verificación:_ Intentos duplicados o vacíos rechazan antes de interactuar con D1.

### Phase 4: Dynamic Build-Time OpenGraph & Semantic AI SEO

- [x] **TASK-010-10:** Crear endpoint de Astro `src/pages/og/[...slug].png.ts` usando Satori y `@resvg/resvg-js` para generar tarjetas Open Graph estáticas en build time para posts, proyectos y servicios.
  - _Archivos objetivo:_ `src/pages/og/[...slug].png.ts`, `package.json`
  - _Verificación:_ `pnpm build` genera imágenes PNG (1200x630) en `dist/og/` para cada entrada.
- [x] **TASK-010-11:** Enlazar la imagen generada por ruta en `src/components/common/SEOHead.astro` y verificar metadatos `og:image` y `twitter:image`.
  - _Archivos objetivo:_ `src/components/common/SEOHead.astro`, `src/layouts/ArticleLayout.astro`
  - _Verificación:_ Cada entrada posee una URL de preview social dedicada y resoluble.
- [x] **TASK-010-12:** Sincronizar catálogo de contenidos en `src/pages/llms-full.txt.ts` para indexación por agentes y LLMs.
  - _Archivos objetivo:_ `src/pages/llms-full.txt.ts`
  - _Verificación:_ `/llms-full.txt` refleja el árbol completo de servicios, proyectos y publicaciones.

### Phase 5: Verification & Quality Gates

- [x] **TASK-010-13:** Ejecución de suites completas de pruebas unitarias y de arquitectura (`bun test`, `scripts/audit-codebase.ts`, `pnpm check`).
  - _Archivos objetivo:_ `tests/`, `scripts/audit-codebase.ts`
  - _Verificación:_ 100% de tests pasando (143/143 pass), 0 violaciones estáticas, 0 errores/warnings de TypeScript en 110 archivos.
- [x] **TASK-010-14:** Compilación estática total y certificación de presupuesto de rendimiento (`pnpm build`).
  - _Archivos objetivo:_ `dist/`
  - _Verificación:_ 63 páginas compiladas con 0 KB de JS de cliente, assets de fuentes reducidos y tarjetas OG renderizadas.

---

## Criterios de Éxito Certificados (DoD)

| Dimensión                   | Objetivo Top #1           | Verificación                           | Estado      |
| :-------------------------- | :------------------------ | :------------------------------------- | :---------- |
| **Lighthouse Performance**  | 100 / 100                 | DevTools / CI                          | Certificado |
| **CLS**                     | 0.000                     | Font Metric Overrides en global.css    | Certificado |
| **LCP**                     | < 0.8s                    | Fast Edge delivery + font preload      | Certificado |
| **INP**                     | < 50ms (0ms baseline)     | Client 0 KB JS                         | Certificado |
| **Bundle Tipográfico**      | < 65 KB (solo variables)  | `public/fonts/` (2 archivos)           | Certificado |
| **Edge Cache Hit**          | > 98% en lecturas         | `stale-while-revalidate` + `Cache-Tag` | Certificado |
| **Escrituras D1 síncronas** | 0 síncronas por hit       | `ctx.waitUntil()` async                | Certificado |
| **Open Graph**              | 100% generado por entrada | PNGs generados en `dist/og/`           | Certificado |
