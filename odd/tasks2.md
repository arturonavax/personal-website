# AUDITORÍA ARQUITECTÓNICA Y PROMPT DE EJECUCIÓN PARA AGENTE DE CÓDIGO (TOP 1 EDGE MULTIPROPÓSITO)

Actúa como un Principal Systems & Edge Performance Architect especializado en Astro v7, Tailwind CSS v4 y la capa gratuita de Cloudflare Edge (Workers Static Assets, D1, R2, Cache API y Workers Analytics Engine). Tu objetivo es ejecutar una refactorización quirúrgica sobre el repositorio `personal-website` para garantizar **0% de visitas ignoradas**, **probabilidad casi nula de duplicación de visitas**, **degradación progresiva automática ante límites de cuota D1 (límite estricto de 100,000 escrituras/día y 5,000,000 de filas leídas/día)**, **sincronización delta en R2 con costo mínimo de operaciones Clase A/B** y **Core Web Vitals perfectos (LCP < 0.8s, CLS = 0.000, INP < 35ms)**.

---

## DIAGNÓSTICO TÉCNICO DEL ESTADO ACTUAL DEL REPOSITORIO

- **Fuga de visitas en transiciones SPA y páginas pre-cargadas (`ClientRouter` + `prefetch`)**: La configuración en `astro.config.mjs` y el enrutamiento con `ClientRouter` en `src/layouts/BaseLayout.astro` pre-cargan documentos HTML mediante `prefetch`. Si `cloudflare/worker.ts` descarta las peticiones con cabeceras `Sec-Purpose: prefetch` o `Purpose: prefetch` ( a través de `src/lib/adapters/cloudflare/prefetch-circuit-breaker.adapter.ts`) y el navegador sirve luego esa vista desde la caché en memoria al hacer clic, **la visita real jamás genera una segunda petición de documento al Worker y se pierde**.

- **Riesgo de duplicación y amplificación de lectura/escritura en D1 (`d1-telemetry.adapter.ts`)**: La verificación de duplicados en `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts` y `cloudflare/d1/migrations/0010_telemetry_dedupe_and_index_pruning.sql` que depende de lecturas previas o múltiples índices secundarios multiplica el consumo de `rows_read` y `rows_written` en Cloudflare D1. En SQLite/D1, cada `INSERT` en una tabla con $N$ índices secundarios consume $1 + N$ escrituras de fila contra la cuota diaria gratuita de 100,000 filas escritas.

- **Degradación binaria en lugar de progresiva (`circuit-breaker.adapter.ts`)**: Los adaptadores `src/lib/adapters/cloudflare/circuit-breaker.adapter.ts`, `src/lib/adapters/cloudflare/bot-circuit-breaker.adapter.ts` y `src/lib/adapters/cloudflare/prefetch-circuit-breaker.adapter.ts` operan como cortacircuitos reactivos, pero carecen de una máquina de estados progresiva por umbrales de cuota (50%, 70%, 85%, 95%) con respaldo Write-Ahead Log (WAL) en R2 (`src/lib/adapters/cloudflare/r2-storage.adapter.ts`) para garantizar pérdida cero de visitas cuando D1 bloquea escrituras.

- **Operaciones Clase A/B innecesarias en el flujo de sincronización R2 (`scripts/lib/r2-content.mjs`)**: Los scripts `scripts/r2-push.mjs`, `scripts/r2-pull.mjs` y `scripts/lib/r2-content.mjs` deben evitar enumeraciones masivas (`ListObjectsV2`, operación Clase A) y lecturas individuales repetitivas (`GetObject`/`HeadObject`, operaciones Clase B) en cada compilación mediante un manifiesto direccionable por contenido (`_manifest.json`) con validación `ETag` y empaquetado atómico.

---

## TAREA 1: SISTEMA DE TELEMETRÍA EDGE HÍBRIDO (CERO VISITAS IGNORADAS Y CERO DUPLICACIÓN)

**Objetivo**: Unificar la captura de visitas entre el interceptor SSR/Edge (`cloudflare/worker.ts`) y las navegaciones cliente de Astro (`src/components/ui/EdgeViewCounter.astro` y `src/layouts/BaseLayout.astro`) usando deduplicación determinista en dos capas (L1 Cache API gratuita + L2 restricción `UNIQUE` en D1 sin `SELECT` previo).

- **Archivos a modificar**:
- `src/lib/ports/telemetry.port.ts`

- `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts`

- `cloudflare/worker.ts`

- `src/components/ui/EdgeViewCounter.astro`

- `cloudflare/d1/migrations/0010_telemetry_dedupe_and_index_pruning.sql`

- `tests/spec-011/edge-telemetry-dedupe.test.ts`

- **Instrucciones de implementación paso a paso**:

1. **Generación de clave idempotente determinista (`dedupe_key`) en el Edge**: En `cloudflare/worker.ts` y `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts`, calcula una huella SHA-256 truncada a 32 caracteres hexadecimales combinando la IP anonimizada (`CF-Connecting-IP`), `User-Agent` normalizado, ruta canónica sin barra final (`canonicalPath`), y la ventana temporal de 30 minutos (`Math.floor(Date.now() / 1800000)`).

2. **Deduplicación L1 gratuita en `caches.default` (0 lecturas D1)**: Antes de tocar D1 en `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts`, consulta `caches.default.match(new Request('[https://telemetry.internal/dedupe/](https://telemetry.internal/dedupe/)' + dedupeKey))`. Si existe coincidencia (`HIT`), retorna inmediatamente `{ recorded: false, deduplicated: true, layer: 'L1_CACHE' }` consumiendo **0 filas leídas y 0 filas escritas en D1**. Si es `MISS`, almacena en `caches.default.put()` una respuesta `204` con `Cache-Control: public, max-age=1800` dentro de `ctx.waitUntil()`.

3. **Sincronización exacta entre carga inicial y `ClientRouter` (0% visitas ignoradas en vistas pre-cargadas)**:

- En `cloudflare/worker.ts`, cuando entre una navegación real de documento (`Sec-Fetch-Mode === 'navigate'` y `Sec-Fetch-Dest === 'document'` sin cabecera `Sec-Purpose: prefetch` ni `Purpose: prefetch`), registra la visita asíncronamente en `ctx.waitUntil()` e inyecta la cabecera `X-Edge-Visit-Logged: 1` (o cookie efímera `ev_init=1; Max-Age=5; Path=/; SameSite=Lax`).

- En `src/components/ui/EdgeViewCounter.astro`, escucha el evento `astro:page-load`. En la primera carga de página (`isInitialLoad = true`), si la cookie `ev_init=1` está presente, **no dispares el beacon cliente** (evitando duplicar la visita que ya registró `cloudflare/worker.ts`) y simplemente hidrata el contador desde `/api/telemetry/views?path=...` (cacheado en el Edge por 60s).

- En todas las navegaciones subsiguientes de `ClientRouter` (`isInitialLoad === false`, incluyendo páginas que fueron pre-cargadas por `hover` o `viewport` y servidas desde la memoria del navegador sin pasar por el Worker), `src/components/ui/EdgeViewCounter.astro` debe enviar `navigator.sendBeacon('/api/telemetry/collect', JSON.stringify({ path: window.location.pathname, referrer: document.referrer, trigger: 'spa_transition' }))`.

- Añade un listener a `pageshow` (`event.persisted === true`) en `src/components/ui/EdgeViewCounter.astro` para capturar restauraciones desde `bfcache` (Back/Forward Cache) que de otro modo serían invisibles para el servidor.

```typescript
// Implementation contract for src/lib/adapters/cloudflare/d1-telemetry.adapter.ts
export interface TelemetryIngestionResult {
  recorded: boolean;
  deduplicated: boolean;
  degradationTier:
    | "NOMINAL"
    | "CONSERVATIVE"
    | "COMPACT_ROLLUP"
    | "CRITICAL_SURVIVAL"
    | "R2_WAL_FALLBACK";
  storageTarget:
    | "L1_CACHE"
    | "D1_RAW_AND_ROLLUP"
    | "D1_ROLLUP_ONLY"
    | "ANALYTICS_ENGINE_AND_R2_WAL";
}

export async function computeVisitDedupeKey(
  ip: string,
  userAgent: string,
  canonicalPath: string,
  timestampMs: number,
  dailySalt: string,
): Promise<string> {
  const bucket30m = Math.floor(timestampMs / 1_800_000);
  const raw = `${ip}|${userAgent.slice(0, 120)}|${canonicalPath}|${bucket30m}|${dailySalt}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

---

## TAREA 2: PODA DE ÍNDICES EN D1 Y ESCRITURA ATÓMICA DE ROLLUPS PARA REDUCIR 70% EL USO DE CUOTA

**Objetivo**: Reducir la amplificación de escritura en SQLite/D1 y eliminar escaneos de tabla completa (`SCAN TABLE`) en el panel de administración (`src/pages/[...lang]/admin/index.astro`).

- **Archivos a modificar**:
- `cloudflare/d1/schema.sql`

- `cloudflare/d1/migrations/0010_telemetry_dedupe_and_index_pruning.sql`

- `cloudflare/d1/migrations/QUERIES.md`

- `src/pages/[...lang]/admin/index.astro`

- **Instrucciones de implementación paso a paso**:

1. **Optimización de esquema e índices en `0010_telemetry_dedupe_and_index_pruning.sql**`: Elimina todos los índices secundarios redundantes sobre `telemetry_events` (como índices separados por `country`, `device_type`, `visitor_type` o `utm_source`) que multiplican `rows_written` en cada `INSERT`. Conserva únicamente un índice único sobre `dedupe_key` (`UNIQUE INDEX idx_telemetry_events_dedupe_key`) y un índice compuesto por tiempo para purga (`idx_telemetry_events_created_at`).

2. **Upsert atómico sin lectura previa**: Sustituye cualquier patrón `SELECT ...` seguido de `INSERT` en `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts` por `INSERT OR IGNORE INTO telemetry_events (...) VALUES (...)` y actualiza los agregados diarios en `analytics_rollups` (`cloudflare/d1/migrations/0002_analytics_rollups.sql`) mediante `INSERT INTO analytics_rollups (...) VALUES (...) ON CONFLICT(date_bucket, path, visitor_category) DO UPDATE SET views = views + excluded.views, unique_visitors = unique_visitors + excluded.unique_visitors`.

3. **Consultas de Costo Constante $O(1)$ en `src/pages/[...lang]/admin/index.astro**`: Modifica el dashboard administrativo para que lea exclusivamente desde `analytics_rollups` indexado por `date_bucket` y cachee el JSON resultante en `caches.default` durante 120 segundos, garantizando que abrir el panel de administración consuma menos de 30 `rows_read` por consulta.

```sql
-- cloudflare/d1/migrations/0010_telemetry_dedupe_and_index_pruning.sql
DROP INDEX IF EXISTS idx_telemetry_country;
DROP INDEX IF EXISTS idx_telemetry_visitor_type;
DROP INDEX IF EXISTS idx_telemetry_path_created;
DROP INDEX IF EXISTS idx_prefetch_path;

CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_dedupe_key
  ON telemetry_events(dedupe_key);

CREATE INDEX IF NOT EXISTS idx_telemetry_created_at
  ON telemetry_events(created_at);

CREATE TABLE IF NOT EXISTS quota_state_daily (
  date_utc TEXT PRIMARY KEY,
  estimated_rows_written INTEGER NOT NULL DEFAULT 0,
  estimated_rows_read INTEGER NOT NULL DEFAULT 0,
  degradation_tier INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

PRAGMA optimize;

```

---

## TAREA 3: MÁQUINA DE ESTADOS DE DEGRADACIÓN PROGRESIVA CON WAL EN R2 (CERO PÉRDIDA DE DATOS)

**Objetivo**: Implementar una política de degradación elegante de 5 niveles basada en el consumo real y estimado de la cuota diaria de D1 (100,000 escrituras/día y 5,000,000 lecturas/día), descartando progresivamente telemetría ruidosa y activando un Write-Ahead Log (WAL) en R2 cuando D1 alcance su límite o devuelva error de cuota.

- **Archivos a modificar**:
- `src/lib/adapters/cloudflare/circuit-breaker.adapter.ts`

- `src/lib/adapters/cloudflare/prefetch-circuit-breaker.adapter.ts`

- `src/lib/adapters/cloudflare/bot-circuit-breaker.adapter.ts`

- `src/lib/adapters/cloudflare/d1-telemetry.adapter.ts`

- `cloudflare/cron-scheduler.ts`

- **Instrucciones de implementación paso a paso**:

1. **Seguimiento de cuota sin fricción en `circuit-breaker.adapter.ts**`: Mantén un contador en memoria por Isolate sincronizado cada 50 peticiones con `caches.default` (`[https://telemetry.internal/quota/YYYY-MM-DD](https://telemetry.internal/quota/YYYY-MM-DD)`) y la tabla `quota_state_daily`. Además, inspecciona `result.meta.rows_written` y `result.meta.rows_read` devueltos por cada `env.DB.batch()` o `.run()` de Cloudflare D1 para acumular el gasto exacto del día UTC actual.

2. **Implementa los 5 niveles progresivos de degradación (`DegradationTier`)**:

- **Nivel 0 — `NOMINAL` (< 50% de cuota: < 50,000 escrituras / < 2.5M lecturas)**:
- Registra eventos completos de visitas humanas en `telemetry_events`, agregados en `analytics_rollups`, bots verificados (buscadores y crawlers de IA como `GPTBot`, `ClaudeBot`, `PerplexityBot`), `contact_leads`, y muestreo al 10% de `prefetch_analytics`.

- **Nivel 1 — `CONSERVATIVE` (50% – 70% de cuota: 50,000 – 70,000 escrituras)**:
- En `src/lib/adapters/cloudflare/prefetch-circuit-breaker.adapter.ts`, **apaga al 100% las escrituras en D1 de `prefetch_analytics**`.

- En `src/lib/adapters/cloudflare/bot-circuit-breaker.adapter.ts`, **descarta el registro individual de bots genéricos/scanners**, conservando únicamente el registro de crawlers de IA e indexadores SEO principales en `analytics_rollups`.

- **Nivel 2 — `COMPACT_ROLLUP` (70% – 85% de cuota: 70,000 – 85,000 escrituras)**:
- **Suspende la inserción de filas individuales en `telemetry_events**`.

- Descarta metadatos no prioritarios (User-Agent crudo, resolución, latencia de red secundaria, parámetros query no-UTM) y **agrupa las visitas en memoria del Isolate durante ventanas de 15 segundos (o hasta 25 eventos)** para hacer un único `env.DB.batch()` contra `analytics_rollups`. Esto reduce la relación de escritura de 1:1 a ~1:25 por visita humana.

- **Nivel 3 — `CRITICAL_SURVIVAL` (85% – 95% de cuota: 85,000 – 95,000 escrituras)**:
- **Congela el 100% de las escrituras de telemetría en D1** para reservar las últimas 15,000 escrituras del día exclusivamente a conversiones de negocio (`contact_leads` desde `src/components/ui/ContactFormModal.astro` e incidentes críticos en `circuit_breaker_incidents`).

- Desvía el 100% de las visitas verificadas hacia **Workers Analytics Engine** (`env.ANALYTICS?.writeDataPoint()`, que cuenta con 100,000 puntos/día gratuitos independientes de D1) y hacia el buffer **R2 Write-Ahead Log (WAL)**.

- **Nivel 4 — `R2_WAL_FALLBACK` (> 95% de cuota o captura de excepción `D1_ERROR` por límite diario)**:
- Si D1 lanza error de límite diario (`rows read` o `rows written` agotados), activa inmediatamente el estado `R2_WAL_FALLBACK` en `caches.default` hasta las `00:00 UTC`.

- **Continuidad absoluta de visitas y leads en R2**: Escribe los lotes de visitas en `env.R2_BUCKET.put('wal/telemetry/' + dateUtc + '/' + isolateId + '-' + batchTs + '.ndjson', body)` y cualquier formulario de contacto en `env.R2_BUCKET.put('wal/leads/' + uuid + '.json', leadPayload)` usando `src/lib/adapters/cloudflare/r2-storage.adapter.ts`.

3. **Reconciliación automática post-reset en `cloudflare/cron-scheduler.ts**`:

- Configura el Cron Trigger a las `00:05 UTC` en `wrangler.jsonc` y `cloudflare/cron-scheduler.ts` para listar el prefijo `wal/leads/` y `wal/telemetry/` en R2 (1 operación Clase A), volcar de forma compacta los leads en `contact_leads` y los conteos agregados en `analytics_rollups` de D1, y eliminar los objetos WAL procesados de R2. **Resultado: 0 visitas perdidas y 0 leads perdidos bajo cualquier escenario de agotamiento de cuota**.

```typescript
// Implementation blueprint for src/lib/adapters/cloudflare/circuit-breaker.adapter.ts
export enum QuotaDegradationTier {
  NOMINAL = 0, // < 50% D1 quota: Full telemetry + 10% prefetch sampling
  CONSERVATIVE = 1, // 50% - 70%: Drop prefetch D1 writes & generic bot raw logs
  COMPACT_ROLLUP = 2, // 70% - 85%: Stop raw telemetry_events; batch-upsert analytics_rollups only
  CRITICAL_SURVIVAL = 3, // 85% - 95%: Reserve D1 exclusively for contact_leads; telemetry -> R2 WAL + Analytics Engine
  R2_WAL_FALLBACK = 4, // > 95% or D1 quota error: 100% R2 WAL persistence for leads & visits; Cron replay at 00:05 UTC
}

export function resolveDegradationTier(
  rowsWritten: number,
  rowsRead: number,
  d1HardBlocked: boolean,
): QuotaDegradationTier {
  if (d1HardBlocked) return QuotaDegradationTier.R2_WAL_FALLBACK;
  const writeRatio = rowsWritten / 100_000;
  const readRatio = rowsRead / 5_000_000;
  const maxRatio = Math.max(writeRatio, readRatio);

  if (maxRatio >= 0.95) return QuotaDegradationTier.R2_WAL_FALLBACK;
  if (maxRatio >= 0.85) return QuotaDegradationTier.CRITICAL_SURVIVAL;
  if (maxRatio >= 0.7) return QuotaDegradationTier.COMPACT_ROLLUP;
  if (maxRatio >= 0.5) return QuotaDegradationTier.CONSERVATIVE;
  return QuotaDegradationTier.NOMINAL;
}
```

---

## TAREA 4: SINCRONIZACIÓN DE CONTENIDO CON R2 ULTRA-EFICIENTE, ESCALABLE Y RENTABLE

**Objetivo**: Reducir en más de un 98% el consumo de operaciones Clase A (`PutObject`, `ListObjectsV2`) y Clase B (`GetObject`, `HeadObject`) de Cloudflare R2 tanto en compilación (`scripts/r2-pull.mjs`, `scripts/r2-push.mjs`, `scripts/lib/r2-content.mjs`) como en ejecución (`src/lib/adapters/cloudflare/r2-storage.adapter.ts`, `src/lib/content/providers.ts`, `src/lib/content/repository.ts`).

- **Archivos a modificar**:
- `scripts/lib/r2-content.mjs`

- `scripts/r2-push.mjs`

- `scripts/r2-pull.mjs`

- `src/lib/adapters/cloudflare/r2-storage.adapter.ts`

- `src/lib/content/providers.ts`

- `src/lib/content/repository.ts`

- `docs/content-sync.md`

- **Instrucciones de implementación paso a paso**:

1. **Manifiesto Direccionable por Contenido (`_manifest.v2.json`) en `scripts/lib/r2-content.mjs**`:

- Genera un único archivo índice `content/_manifest.v2.json` que contenga:
- `rootHash`: SHA-256 global determinista calculado sobre todos los pares `relativePath:sha256` ordenados alfabéticamente.

- `bundleKey`: clave de un archivo comprimido `content/_bundle-${rootHash.slice(0, 12)}.tar.gz` que agrupa todas las colecciones (`src/content/{posts,projects,experience,services,resume}`) en un único objeto binario.

- `entries`: mapa de cada archivo (`src/content/**` y `public/remote-assets/**`) con `{ sha256, size, contentType, immutableKey }`.

2. **Sincronización Delta sin `ListObjectsV2` en `scripts/r2-push.mjs**`:

- Descarga únicamente `content/_manifest.v2.json` desde R2 (1 sola operación Clase B; **prohibido ejecutar `ListObjectsV2**` que consume cuota Clase A).

- Compara el `rootHash` local con el `rootHash` remoto. Si son idénticos, aborta el push inmediatamente en `<30ms` con **0 operaciones Clase A**.

- Si hay diferencias, sube en paralelo (con concurrencia limitada a 6) **únicamente los archivos cuyo `sha256` haya cambiado**, genera y sube el nuevo `content/_bundle-${shortHash}.tar.gz` (1 operación Clase A) y actualiza al final `content/_manifest.v2.json` (1 operación Clase A).

3. **Descarga Instantánea por Bundle o Delta en `scripts/r2-pull.mjs**`:

- Envía una petición `GetObject` a `content/_manifest.v2.json` enviando `If-None-Match` con el `ETag` guardado en `.cache/r2-manifest.json`.

- Si R2 responde `304 Not Modified` o el `rootHash` coincide con `.cache/r2-manifest.json` y los directorios `src/content/*` existen localmente, termina inmediatamente consumiendo **1 sola operación Clase B y 0 bytes de transferencia**.

- Si es un entorno efímero de CI/CD en frío (donde `src/content/` está vacío) o hay más de 5 archivos modificados en texto, descarga el archivo único `content/_bundle-${shortHash}.tar.gz` (1 sola operación Clase B) y extráelo en memoria hacia `src/content/`, en lugar de hacer decenas o cientos de llamadas `GetObject` individuales.

- Para activos pesados en `public/remote-assets/`, descarga únicamente los archivos faltantes o cuyo `sha256` difiera del manifiesto.

4. **Caché Edge con `stale-while-revalidate` en `src/lib/adapters/cloudflare/r2-storage.adapter.ts**`:

- Envuelve `getObject()` en `src/lib/adapters/cloudflare/r2-storage.adapter.ts` con `caches.default`. Cuando un objeto se lea de R2 en el Edge, guárdalo en `caches.default` con `Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800` y su `ETag`, logrando que el 99.9% de las lecturas en caliente desde los Workers se sirvan desde la Cache API gratuita sin consumir operaciones Clase B de R2.

---

## TAREA 5: MAXIMIZACIÓN DE LA CAPA GRATUITA DE WORKERS STATIC ASSETS Y RENDIMIENTO EXTREMO AL USUARIO

**Objetivo**: Asegurar que el 100% de los recursos estáticos jamás invoquen el Worker (ahorrando las 100,000 invocaciones gratuitas/día de Cloudflare Workers exclusivamente para rutas dinámicas/API y documentos HTML) y blindar el puntaje 100/100 de Core Web Vitals.

- **Archivos a modificar**:
- `wrangler.jsonc`

- `cloudflare/worker.ts`

- `public/_headers`

- `src/layouts/BaseLayout.astro`

- `src/components/ui/MatrixBackground.astro`

- `src/scripts/matrix.worker.ts`

- `src/components/ui/UniversalSearchModal.astro`

- **Instrucciones de implementación paso a paso**:

1. **Bypass de Worker para activos estáticos en `wrangler.jsonc` y `cloudflare/worker.ts**`:

- Verifica en `wrangler.jsonc` que la configuración de `assets` sirva directamente desde la red Edge de Cloudflare todos los archivos estáticos (`/_astro/*`, `/fonts/*`, `/remote-assets/*`, `/downloads/*`, `/favicon*`, `/icon-*`, `/og-*`, `/robots.txt`, `/sitemap*.xml`, `/site.webmanifest`) sin ejecutar `run_worker_first` sobre rutas de activos.

- En `cloudflare/worker.ts`, añade un retorno temprano ultrarrápido para cualquier petición de activo estático que llegue al Worker, delegándola a `env.ASSETS.fetch(request)` sin instanciar adaptadores de D1, R2 ni telemetría.

2. **Cacheado agresivo en Edge Cache API para endpoints de lectura y OG Images**:

- En `src/pages/og/[...slug].png.ts`, `src/pages/search-index.json.ts`, `src/pages/rss.xml.ts` y `src/pages/llms-full.txt.ts`, asegura cabeceras `Cache-Control: public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400` para que el CDN de Cloudflare absorba el tráfico repetido sin golpear el Worker.

3. **Aislamiento de Hilo Principal e INP < 35ms en Componentes Interactivos**:

- En `src/components/ui/MatrixBackground.astro` y `src/scripts/matrix.worker.ts`, implementa suspensión automática del bucle `requestAnimationFrame` en el `OffscreenCanvas` cuando `document.hidden === true`, cuando el canvas salga del viewport (`IntersectionObserver`), o cuando el navegador reporte ahorro de energía o `prefers-reduced-motion: reduce`.

- En `src/components/ui/UniversalSearchModal.astro`, garantiza que `/search-index.json` (`src/pages/search-index.json.ts`) y el adaptador de búsqueda (`src/lib/adapters/cloudflare/vectorize-search.adapter.ts` / `src/lib/adapters/fallback/static-memory-search.adapter.ts`) se carguen **exclusivamente bajo demanda** al presionar `⌘K` / `/` o al hacer `pointerenter` en el botón del buscador, almacenando el índice en `sessionStorage` para no repetir descargas entre transiciones de `ClientRouter`.

---

## TAREA 6: SUITE DE VERIFICACIÓN Y TESTS DE REGRESIÓN

**Objetivo**: Validar matemáticamente y mediante pruebas automatizadas que la integración de telemetría, la deduplicación, la degradación progresiva por cuota y la sincronización R2 cumplen todas las invariantes arquitectónicas.

- **Archivos a modificar / ejecutar**:
- `tests/spec-011/edge-telemetry-dedupe.test.ts`

- `tests/spec-010/prefetch-circuit-breaker.test.ts`

- `tests/audit.spec.ts`

- `scripts/audit-codebase.ts`

- **Casos de prueba obligatorios a implementar y validar**:

1. **Test de Cero Visitas Ignoradas (`tests/spec-011/edge-telemetry-dedupe.test.ts`)**: Simula una petición `GET /en/blog/post-1` con `Sec-Purpose: prefetch` (no debe contar como visita) seguida de una transición cliente `ClientRouter` hacia `/en/blog/post-1` vía `POST /api/telemetry/collect` (debe registrarse exactamente 1 vez).

2. **Test de Cero Duplicación Dual SSR + Cliente (`tests/spec-011/edge-telemetry-dedupe.test.ts`)**: Simula una navegación directa `GET /en/projects` (`Sec-Fetch-Mode: navigate`) seguida inmediatamente del disparo de `astro:page-load` en `EdgeViewCounter.astro`; verifica que `dedupe_key` + la marca `ev_init=1` en L1 Cache API bloqueen la duplicación con **0 lecturas a D1** y **1 sola escritura efectiva**.

3. **Test de Escalera de Degradación Progresiva (`tests/spec-010/prefetch-circuit-breaker.test.ts`)**: Simula los umbrales de cuota al 40% (`NOMINAL`), 55% (`CONSERVATIVE`), 75% (`COMPACT_ROLLUP`), 90% (`CRITICAL_SURVIVAL`) y 100% / excepción `D1_ERROR` (`R2_WAL_FALLBACK`), comprobando que en el nivel 4 tanto las visitas como los envíos de `contact_leads` se persistan en el mock de R2 (`wal/telemetry/*` y `wal/leads/*`) y se reconcilien en D1 al ejecutar `cloudflare/cron-scheduler.ts`.

4. **Test de Sincronización R2 de Costo Mínimo**: Verifica que `scripts/r2-pull.mjs` con `rootHash` idéntico realice exactamente **1 llamada `GetObject**` (`_manifest.v2.json`) y **0 llamadas `ListObjectsV2**`.

- **Comandos de validación final que debes ejecutar**:

```bash
pnpm run typecheck
pnpm test
pnpm run build
npx tsx scripts/audit-codebase.ts

```
