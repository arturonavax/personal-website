# Tareas del Proyecto (ODD)

## SPEC-007: Print CV & Visual Fidelity

- [x] Unificación de estilos de impresión entre `/resume/` y `/resume/maker/` para geometría `@page` A4 (12mm 15mm) idéntica en Chromium y Firefox.
- [x] Supresión de fuentes variables en CSS de impresión para garantizar texto 100% seleccionable en PDFs generados por Firefox (REQ-PRINT-1).
- [x] Subrayado estricto solo en links del encabezado y unificación de párrafos de cabecera con `<br>` (REQ-PRINT-3, REQ-PRINT-4).
- [x] Elevación de capa superior para notificación "Copiado al portapapeles" sobre el banner de idiomas.
- [x] Caída inicial de caracteres en `MatrixBackground.astro` desde el borde superior (`next[i] = -Math.floor(...)`) para evitar sensación de congelamiento (REQ-PRINT-6).

## SPEC-008: Restauración Arquitectónica Perimetral y Blindaje SSG

- [x] Diagnóstico forense completo de las fallas introducidas por la propuesta de re-arquitectura destructiva (Plan inicial) y cascada de errores.
- [x] Desactivación y erradicación del adaptador SSR `@astrojs/cloudflare` en Astro para garantizar compilación estática pura (`output: 'static'`) y cero errores 404.
- [x] Reversión de la mutilación de componentes nucleares (`Header.astro`, `ExperienceTimeline.astro`, `resume/maker.astro`, `resume/index.astro`, `MatrixBackground.astro`).
- [x] Alineación de `wrangler.jsonc` con Workers Static Assets (`run_worker_first: true`, `not_found_handling: "404-page"`, bindings `STORAGE_BUCKET`, `VECTORIZE_INDEX`, `DB`, `AI`, crons).
- [x] Verificación de Content Security Policy en `public/_headers` (restitución de `data:` y `script-src-elem`).
- [x] Actualización de script `dev-prod` en `package.json` para ejecutar `wrangler dev` de forma nativa.
- [x] Ejecución y pase al 100% de la suite de pruebas unitarias (`bun test`: 140/140 pass).
- [x] Ejecución y pase al 100% de la compuerta de calidad estática (`bun scripts/audit-codebase.ts`: 0 violaciones).
- [x] Comprobación de tipos e integridad de Astro (`pnpm check`: 0 errores, 0 advertencias).
- [x] Compilación estática total verificada (`pnpm build`: 63 páginas generadas).

## SPEC-010: Top #1 Architecture, Edge Performance & Cloudflare Ecosystem Maximization

- [x] Consolidación de fuentes variables WOFF2 y eliminación de cortes estáticos redundantes en `public/fonts/` preservando compatibilidad de selección PDF (TASK-010-01).
- [x] Implementación de `@font-face` metric overrides (`size-adjust`, `ascent-override`) en `src/styles/global.css` para CLS = 0.000 (TASK-010-02).
- [x] Precarga exclusiva de `Geist-Variable.woff2` en `SEOHead.astro` (TASK-010-03).
- [x] Inyección de `content-visibility: auto` y `contain-intrinsic-size` en feeds de posts y proyectos (TASK-010-04).
- [x] Actualización de `public/_headers` con cabeceras de inmutabilidad y seguridad perimetral (TASK-010-05).
- [x] Implementación de `handleCachedGet` con `stale-while-revalidate` y `Cache-Tag` en `cloudflare/worker.ts` (TASK-010-06).
- [x] Buffer y batching asíncrono para telemetría en D1 mediante `ctx.waitUntil()` (TASK-010-07).
- [x] Integración de Workers AI (`@cf/baai/bge-small-en-v1.5`) en `vectorize-search.adapter.ts` y `wrangler.jsonc` (TASK-010-08).
- [x] Hardening y rate-limiting en validación de Turnstile captcha (TASK-010-09).
- [x] Generador dinámico Open Graph en build time (`/og/[...slug].png.ts`) con Satori + resvg (TASK-010-10).
- [x] Enlace dinámico de tarjetas Open Graph individuales en `SEOHead.astro` (TASK-010-11).
- [x] Sincronización completa de catálogo en `/llms-full.txt.ts` para indexación de LLMs (TASK-010-12).
- [x] Verificación completa de suite unitaria y compuertas estáticas (`bun test`, `audit-codebase.ts`, `pnpm check`) (TASK-010-13).
- [x] Verificación final de presupuesto de rendimiento y Lighthouse CI (TASK-010-14).

## SPEC-010 Subsystem B.3 / Edge Optimization: Circuit Breaker de Telemetría Priorizada y Segmentación de Prefetch

- [x] Creación de migración D1 `0004_prefetch_analytics.sql` para tabla dedicada `prefetch_analytics_events` (TASK-OPT-01).
- [x] Definición de puertos `PrefetchTelemetryEvent` y `PrefetchCircuitBreakerPort` en `src/lib/ports/telemetry.port.ts` (TASK-OPT-02).
- [x] Implementación de `PrefetchQuotaCircuitBreaker` en `src/lib/adapters/cloudflare/prefetch-circuit-breaker.adapter.ts` con protección de cuota D1 (100k writes/día), ratio proporcional de prefetch vs visitas y kill-switch configurable `ENABLE_PREFETCH_TELEMETRY` (TASK-OPT-03).
- [x] Implementación de `recordPrefetch` en `D1TelemetryAdapter` y `recordPrefetchAnalyticsNonBlocking` en `cloudflare/worker.ts` (TASK-OPT-04).
- [x] Cableado en el fast-path GET de `cloudflare/worker.ts`: peticiones `isPrefetch` se evalúan con el Circuit Breaker y se persisten en background; visitas reales (`!isPrefetch`) se mantienen como prioridad P0 en `pageviews` asegurando telemetría 100% anti-adblocker server-side (TASK-OPT-05).
- [x] Pruebas unitarias e integración en `tests/spec-010/prefetch-circuit-breaker.test.ts` pasando 150/150 pruebas (TASK-OPT-06).
- [x] Verificación integral de compuertas estáticas (`audit-codebase.ts`: 0 violaciones, `pnpm check`: 0 errores en 111 archivos, `pnpm build`: 63 páginas generadas) (TASK-OPT-07).

## SPEC-010 Subsystem B.4 / Data Quality: Circuit Breaker Incident Logging & Completeness Warning System

- [x] Creación de migración D1 `0005_circuit_breaker_incidents.sql` con tabla `circuit_breaker_incidents` y vista analítica `v_prefetch_daily_summary` con flag de completitud (`data_completeness: 'complete' | 'partial'`) (TASK-QUAL-01).
- [x] Definición de puertos `CircuitBreakerIncident` y `PrefetchDailySummaryWithQuality` en `src/lib/ports/telemetry.port.ts` (TASK-QUAL-02).
- [x] Extensión de `PrefetchQuotaCircuitBreaker` con discriminación de razón de disparo (`budget_exhausted`, `proportional_storm`, `kill_switch`) y deduplicación por día (TASK-QUAL-03).
- [x] Implementación de `recordCircuitBreakerIncident` en `cloudflare/worker.ts` con persistencia asíncrona no bloqueante (`ctx.waitUntil`) e integración de `data_quality_warnings` en el endpoint `/api/metrics` (TASK-QUAL-04).
- [x] Implementación de métodos de consulta analítica `getCircuitBreakerIncidents` y `getPrefetchSummaryWithQuality` en `D1TelemetryAdapter` (TASK-QUAL-05).
- [x] Pruebas automatizadas unitarias y de integración pasando al 100% (152/152 pass) en `prefetch-circuit-breaker.test.ts` (TASK-QUAL-06).
