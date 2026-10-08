# SPEC-008: RESTAURACIÓN ARQUITECTÓNICA PERIMETRAL, BLINDAJE SSG PURO Y CONTROL ANTI-REGRESIÓN

## Diagnóstico Forense de la Re-arquitectura Fallida, Alineación con Workers Static Assets y Recuperación de Invariantes del Sistema

```yaml
id: SPEC-008-EDGE-ARCHITECTURE-RESTORATION-AND-HARDENING
title: Edge Infrastructure Restoration, Pure SSG Hardening & Anti-Regression Invariants
status: APPROVED / IMPLEMENTED
version: 1.0.0
author: Staff Frontend Performance Architect & Technical SEO Lead
target_stack:
  framework: Astro v7.3.4+ (Compilación Estática Pura / ClientRouter)
  styling: Tailwind CSS v4.3.3+ (CSS-First @theme Engine / LightningCSS)
  runtime: Cloudflare Edge (Workers, Workers Static Assets, D1, R2, Vectorize, Cache API)
  architecture: Hexagonal / Decoupled Ports & Adapters / Fail-Open Isolation
  locales: [en, es] (EN Primario -> ES Secundario -> Extensible N)
methodology: Organic/Operational-Driven Development (ODD)
cross_references:
  spec_001: openspec/specs/SPEC-001-big-refactor.md
  spec_002: openspec/specs/SPEC-002-general-tasks.md
  spec_003: openspec/specs/SPEC-003-future-improves.md
  spec_004: openspec/specs/SPEC-004-audit.md
  spec_005: openspec/specs/SPEC-005-performance-content-delivery.md
  spec_006: openspec/specs/SPEC-006-ux-editorial-refinements.md
  spec_007: openspec/specs/SPEC-007-frontend-stability-and-ux-polish.md
```

---

## 1. Resumen Ejecutivo y Diagnóstico Forense del Sistema

### 1.1. Diagnóstico de la Propuesta de Re-arquitectura ("Plan Inicial")

Se propuso una re-arquitectura con el objetivo de:

1. Optimizar el rendimiento perimetral en Cloudflare Workers y Pages.
2. Implementar telemetría resistente a adblockers en el Edge.
3. Incorporar búsqueda semántica vectorial con fallback estático.
4. Endurecer la seguridad en Cloudflare Edge.

No obstante, la ejecución de dicho plan mediante instrucciones destructivas de reemplazo ciego (`OVERWRITE entire file`) sobre 10 archivos nucleares del repositorio desató una cascada catastrófica de errores:

1. **Incompatibilidad Fatal de Adaptador en `astro.config.mjs`:**
   - La inserción innecesaria de `@astrojs/cloudflare` en un proyecto de compilación estática pura (`output: 'static'`) violó la regla #1 de `AGENTS.md` (_"SSG Purity: Server-Side Rendering (SSR) adapters are forbidden"_).
   - Generó rutas alteradas (como `dist/client`), provocando errores 404 masivos.
   - Eliminó la configuración de internacionalización (`i18n`), normalización estricta de barras (`trailingSlash: "always"`), serializador de mapas de sitio (`sitemap` con `x-default`) y minificación de scripts inline mediante `esbuild`.
   - Modificó erróneamente el dominio canónico a `https://arturonava.dev` (omitiendo la 'x'), rompiendo contratos de SEO y pruebas unitarias.

2. **Ruptura de Configuración de Edge en `wrangler.jsonc`:**
   - Removió `run_worker_first: true`, impidiendo que el Worker perimetral intercepte solicitudes para ejecutar redirecciones canónicas 308 de subdominios (`blog.`, `projects.`, `services.`, `maker.`), aislamiento de `/admin` y telemetría de navegación.
   - Modificó `not_found_handling` a `"single-page-application"`, destruyendo el manejo estándar de errores 404 de un sitio SSG y produciendo "Soft 404s" con penalización directa en indexación SEO.
   - Renombró arbitrariamente bindings declarados en adaptadores de arquitectura hexagonal (`STORAGE_BUCKET` -> `STORAGE`, `VECTORIZE_INDEX` -> `VECTOR_INDEX`).
   - Eliminó la ejecución cronometrada (`crons: ["0 2 * * *"]`) para rollups analíticos diarios en D1 (REQ-EDGE-04).

3. **Demolición del Router Perimetral en `cloudflare/worker.ts`:**
   - El Worker original de más de 700 líneas basado en Arquitectura Hexagonal y Resiliencia _Fail-Open_ fue reemplazado por un script monolítico básico de 150 líneas.
   - Se eliminaron:
     - El motor de canonicalización 308 de subdominios (`CloudflareEdgeRoutingPolicy`).
     - El aislamiento de doble superficie Zero Trust para `admin.arturonavax.dev`.
     - El blindaje contra prefetching especulativo (HTTP 204 en cabecera `Purpose: prefetch`).
     - El circuit breaker de búsqueda vectorial con degradación a memoria estática (`StaticMemorySearchAdapter`).
     - El manejo RFC 9111 de 304 Not Modified y caché inmutable de 1 año en `/_astro/*` y `/fonts/*`.
     - La ingesta corporativa de correo electrónico (`email-worker.ts`).

4. **Violación de Content Security Policy (CSP) en `public/_headers`:**
   - Eliminó las directivas `data:` y `https://static.cloudflareinsights.com` en `script-src` y `script-src-elem`, violando directamente la prueba `SPEC-006 REQ-UXE-18`.
   - Removió reglas de caché esenciales para PDFs (`stale-while-revalidate`), índices de búsqueda y artefactos de IA (`llms.txt`).

5. **Destrucción Secundaria en `odd/tasks.md`:**
   - Para intentar parchar los errores 404 introducidos por la re-arquitectura, se elaboró un conjunto de tareas erróneas que amputó componentes de presentación:
     - `Header.astro`: Reducido de 1118 líneas a un menú rígido, perdiendo resolución de rutas activas (`/services/*` vs "Más"), soporte de idiomas y colapso responsivo dinámico.
     - `ExperienceTimeline.astro`: Reemplazado por datos estáticos fijos, desconectándolo de las colecciones de contenido de Astro.
     - `resume/maker.astro`: El editor avanzado de CV (Resume Maker Studio con sincronización de scroll, alternador de teléfono y filtros ATS) fue reemplazado por un marcador de posición de 20 líneas.
     - `resume/index.astro`: Mutilado y desalineado de los estándares de impresión unificada A4 de SPEC-007.
     - `MatrixBackground.astro`: Se eliminó la persistencia de transiciones SPA y la animación desde el borde superior (`next[i] = -Math.floor(Math.random() * 24)`).

---

## 2. Invariantes del Sistema y Arquitectura de Recuperación

### 2.1. Validación del Commit `fb10674d5412ec18278b99b105d2e482d15a2212`

El commit `fb10674d5412ec18278b99b105d2e482d15a2212` representa el estado de referencia perfecto y funcional del repositorio:

- **140/140 pruebas unitarias pasando** en Bun (`bun test`).
- **0 violaciones arquitectónicas** en la auditoría estática (`bun scripts/audit-codebase.ts`).
- **0 errores, 0 advertencias, 0 sugerencias** en Astro (`astro check`).
- **63 rutas estáticas compiladas exitosamente** en 3.67s (`pnpm build`).

### 2.2. Modelo de Despliegue en Cloudflare: Workers + Static Assets

El despliegue oficial para el repositorio es **Cloudflare Workers con Workers Static Assets** (no Cloudflare Pages clásico):

```text
Solicitud Entrante (HTTP/HTTPS)
               │
               ▼
┌──────────────────────────────────────────────┐
│  Cloudflare Edge Worker (run_worker_first)   │
│  - Redirección 308 de subdominios canónicos  │
│  - Redirección 308 de /admin hacia subdominio│
│  - Blindaje 204 para prefetch especulativo   │
│  - Telemetría no bloqueante (ctx.waitUntil)  │
│  - Endpoints dedicados (/api/search, /views) │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Workers Static Assets (env.ASSETS)          │
│  - Directorio: ./dist                        │
│  - HTML trailing slash: auto-trailing-slash  │
│  - Error 404: 404-page                       │
│  - Activos inmutables: Cache-Control 1 año   │
└──────────────────────────────────────────────┘
```

1. **Astro SSG Puro:** Astro compila a `./dist` sin adaptadores SSR.
2. **Workers Entrypoint:** `cloudflare/worker.ts` gobierna la red perimetral mediante bindings declarados en `wrangler.jsonc`.
3. **Comando de Desarrollo Local:** `pnpm dlx wrangler dev` (reemplazando comandos obsoletos de `wrangler pages dev`).

---

## 3. Matriz de Requerimientos de Blindaje (RDD)

| ID             | Requerimiento Técnico                     | Componente                                            | Criterio de Aceptación (PASS)                                                                                                                        |
| :------------- | :---------------------------------------- | :---------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REQ-RST-01** | **Preservación de SSG Puro**              | `astro.config.mjs`, `package.json`                    | Cero dependencias de adaptadores SSR (`@astrojs/cloudflare`). Compilación estática directa en `./dist`.                                              |
| **REQ-RST-02** | **Integridad de Bindings de Edge**        | `wrangler.jsonc`                                      | Conservación estricta de `DB`, `STORAGE_BUCKET`, `VECTORIZE_INDEX`, `AI`, `run_worker_first: true` y `not_found_handling: "404-page"`.               |
| **REQ-RST-03** | **Router Hexagonal Perimetral**           | `cloudflare/worker.ts`                                | 100% de rutas perimetrales (308 subdominios, aislamiento de admin, prefetch 204, fail-open search, R2 assets) operando con adaptadores desacoplados. |
| **REQ-RST-04** | **Restauración de UI y UX de Precisión**  | `Header.astro`, `ExperienceTimeline.astro`, `resume/` | Restauración íntegra de la barra de navegación responsive (1118 líneas), línea de tiempo conectada a datos de experiencia y Resume Maker Studio.     |
| **REQ-RST-05** | **Conformidad Estricta de Seguridad CSP** | `public/_headers`                                     | CSP validada por SPEC-006 con inclusión de `data:` y `script-src-elem`.                                                                              |
| **REQ-RST-06** | **Comprobación Cuádruple de Compuertas**  | Suite de Pruebas y CI                                 | 140/140 pruebas pasando en Bun, auditoría de código limpia, `astro check` sin errores y `pnpm build` sin fallos.                                     |

---

## 4. Verificación y Evidencia de Ejecución (ODD)

### 4.1. Comandos de Validación

1. `bun test` -> Debe reportar `140 pass, 0 fail`.
2. `bun scripts/audit-codebase.ts` -> Debe reportar `[PASS] All architectural static gates certified successfully`.
3. `pnpm check` -> Debe reportar `0 errors, 0 warnings, 0 hints`.
4. `pnpm build` -> Debe generar exitosamente los 63 archivos estáticos en `./dist`.

---
