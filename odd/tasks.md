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
