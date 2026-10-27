# Cloudflare D1 Reference SQL Queries & Analytics Playbook

Este documento reúne todas las consultas SQL de referencia para la base de datos analítica Cloudflare D1 del proyecto.
El esquema completo, incluidas las dimensiones de visita, está en la única migración `0001_initial_schema.sql` (y `schema.sql`); `reset.sql` reconstruye esta línea base y registra solo `0001` en el ledger. No es una actualización de tablas existentes: `CREATE TABLE IF NOT EXISTS` no agrega columnas y un ledger con `0001` no vuelve a ejecutar la migración.

### Comandos de Gestión y Reset de Base de Datos

- **Reset Total (Local)**: `pnpm run db:reset:local` (aplica `cloudflare/d1/reset.sql`)
- **Reset remoto (no hay atajo)**: operación destructiva separada para un destino explícito; este cambio no la ejecuta ni exige respaldos o verificaciones; ver [`docs/cloudflare-edge.md`](../../../docs/cloudflare-edge.md).
- **Aplicar Esquema Base (Local)**: `pnpm run db:schema:local` (aplica `cloudflare/d1/schema.sql`)
- **Producción**: no aplicar `schema.sql` ni la migración reescrita `0001` como actualización de la D1 existente con ledger histórico.

---

## Índice

1. [Prefetch Analytics & Calidad de Datos](#1-prefetch-analytics--calidad-de-datos)
2. [Visitas Reales & Telemetría P0 Anti-AdBlocker](#2-visitas-reales--telemetría-p0-anti-adblocker)
3. [Resúmenes Diarios & Rollups de Alto Rendimiento](#3-resúmenes-diarios--rollups-de-alto-rendimiento)
4. [Leads de Contacto & Mensajería Serverless](#4-leads-de-contacto--mensajería-serverless)
5. [Monitoreo de Cuota D1, Salud y Mantenimiento](#5-monitoreo-de-cuota-d1-salud-y-mantenimiento)

---

## 1. Prefetch Analytics & Calidad de Datos

Tablas asociadas: `prefetch_analytics_events`, `circuit_breaker_incidents`
Vista analítica: `v_prefetch_daily_summary`

### 1.1. Resumen diario con bandera de completitud (Recomendada)

Consulta la vista analítica que cruza automáticamente los eventos con los incidentes del Circuit Breaker:

```sql
SELECT
  summary_date,
  path,
  recorded_prefetches,
  data_completeness,
  circuit_breaker_reason,
  estimated_shed_count
FROM v_prefetch_daily_summary
ORDER BY summary_date DESC, recorded_prefetches DESC
LIMIT 50;
```

### 1.2. Filtrar exclusivamente días con datos 100% íntegros

Ideal para reportes de tendencias y analítica cuantitativa estricta donde no se toleran datos sesgados por descarte:

```sql
SELECT
  summary_date,
  path,
  recorded_prefetches
FROM v_prefetch_daily_summary
WHERE data_completeness = 'complete'
ORDER BY summary_date DESC, recorded_prefetches DESC;
```

### 1.3. Detectar días afectados por disparo de Circuit Breaker

Identifica qué días se activó el descarte de prefetch, por qué motivo y cuántos eventos aproximados se mitigaron para salvar la cuota de visitas:

```sql
SELECT
  date,
  subsystem,
  reason AS trip_reason,
  shed_count AS estimated_shed_events,
  tripped_at,
  notes
FROM circuit_breaker_incidents
ORDER BY date DESC;
```

### 1.4. Ratio de Conversión: Prefetch vs Visita Real

Calcula cuántos prefetches especulativos de una ruta se convirtieron efectivamente en una visita humana real durante el mismo día:

```sql
SELECT
  strftime('%Y-%m-%d', p.created_at) AS date,
  p.path,
  COUNT(DISTINCT p.id) AS prefetch_count,
  COALESCE(v.real_views, 0) AS real_views,
  ROUND(CAST(COALESCE(v.real_views, 0) AS FLOAT) / COUNT(DISTINCT p.id) * 100, 2) AS conversion_rate_pct
FROM prefetch_analytics_events p
LEFT JOIN (
  SELECT
    strftime('%Y-%m-%d', created_at) AS v_date,
    path,
    COUNT(id) AS real_views
  FROM pageviews
  WHERE is_bot = 0
  GROUP BY v_date, path
) v ON v.v_date = strftime('%Y-%m-%d', p.created_at) AND v.path = p.path
GROUP BY date, p.path
HAVING prefetch_count > 5
ORDER BY conversion_rate_pct DESC;
```

### 1.5. Top Rutas Más Precargadas (Últimos 7 días)

Aprovecha el índice `idx_prefetch_created`:

```sql
SELECT
  path,
  COUNT(id) AS total_prefetches,
  COUNT(DISTINCT visitor_hash) AS unique_visitors
FROM prefetch_analytics_events
WHERE created_at >= datetime('now', '-7 days')
GROUP BY path
ORDER BY total_prefetches DESC
LIMIT 20;
```

---

## 2. Visitas Reales & Telemetría P0 Anti-AdBlocker

Tabla asociada: `pageviews`
Protección: 100% server-side en Cloudflare Edge Worker (`ctx.waitUntil`). Inmune a uBlock Origin, Brave Shields y AdBlockers.

### 2.1. Métricas Globales (Visitas Totales, Únicas y Bots)

Aprovecha el índice compuesto `idx_pageviews_analytics`:

```sql
SELECT
  COUNT(*) AS total_hits,
  SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS human_views,
  SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bot_views,
  COUNT(DISTINCT CASE WHEN is_bot = 0 THEN visitor_hash END) AS unique_human_visitors
FROM pageviews
WHERE created_at >= datetime('now', '-30 days');
```

### 2.2. Top 10 Páginas Más Vistas por Humanos

Utiliza el índice `idx_pageviews_analytics(is_bot, created_at, path)` para evitar escaneos completos de tabla:

```sql
SELECT
  path,
  COUNT(id) AS total_views,
  COUNT(DISTINCT visitor_hash) AS unique_visitors
FROM pageviews
WHERE is_bot = 0
  AND created_at >= datetime('now', '-7 days')
GROUP BY path
ORDER BY total_views DESC
LIMIT 10;
```

### 2.3. Desglose de Tráfico por País (Top 15 Países)

```sql
SELECT
  COALESCE(country, 'UNKNOWN') AS country_code,
  COUNT(id) AS views,
  COUNT(DISTINCT visitor_hash) AS unique_visitors
FROM pageviews
WHERE is_bot = 0
  AND created_at >= datetime('now', '-30 days')
GROUP BY country
ORDER BY views DESC
LIMIT 15;
```

### 2.4. Atribución de Campañas (UTM Source / Medium / Campaign)

Aprovecha el índice `idx_pageviews_attribution`:

```sql
SELECT
  utm_source,
  utm_medium,
  utm_campaign,
  COUNT(id) AS sessions,
  COUNT(DISTINCT visitor_hash) AS unique_users
FROM pageviews
WHERE is_bot = 0
  AND utm_source != 'direct'
  AND created_at >= datetime('now', '-30 days')
GROUP BY utm_source, utm_medium, utm_campaign
ORDER BY sessions DESC;
```

### 2.5. Fuentes de Referencia Externas (Top Referrers)

Aprovecha el índice compuesto `idx_pageviews_analytics(is_bot, created_at, path)` (`idx_pageviews_referrer` fue eliminado en la migración `0010` para reducir la amplificación de escritura en D1):

```sql
SELECT
  referrer,
  COUNT(id) AS referral_visits
FROM pageviews
WHERE is_bot = 0
  AND referrer IS NOT NULL
  AND referrer NOT LIKE '%arturonavax.dev%'
  AND created_at >= datetime('now', '-30 days')
GROUP BY referrer
ORDER BY referral_visits DESC
LIMIT 20;
```

---

## 3. Resúmenes Diarios & Rollups de Alto Rendimiento

Tablas asociadas: `pageview_events` (buffer) y `pageviews_daily_summary` (agregados)

### 3.1. Consulta Rápida O(1) de Vistas Diarias sin Full-Table Scan

Aprovecha el índice primario agrupado `(summary_date, path, locale, country)`:

```sql
SELECT
  summary_date,
  path,
  locale,
  total_views
FROM pageviews_daily_summary
WHERE summary_date >= date('now', '-14 days')
ORDER BY summary_date DESC, total_views DESC;
```

### 3.2. Proceso de Rollup Agregado (Cron Scheduled Worker)

Esta es la consulta que corre el Scheduled Cron Worker (`0002_analytics_rollups.sql`) para consolidar eventos crudos en la tabla de resumen:

```sql
-- Paso 1: Insertar o acumular en la tabla resumen
INSERT INTO pageviews_daily_summary (summary_date, path, locale, country, total_views)
SELECT
  strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch') AS summary_date,
  path,
  locale,
  country,
  COUNT(id) AS total_views
FROM pageview_events
WHERE timestamp >= ? AND timestamp < ?
GROUP BY summary_date, path, locale, country
ON CONFLICT(summary_date, path, locale, country) DO UPDATE SET
  total_views = total_views + excluded.total_views;

-- Paso 2: Purgar los eventos crudos ya consolidados
DELETE FROM pageview_events
WHERE timestamp < ?;
```

---

## 4. Leads de Contacto & Mensajería Serverless

Tabla asociada: `contact_leads`

### 4.1. Últimos Contactos Recibidos

Aprovecha el índice `idx_contact_leads_created`:

```sql
SELECT
  id,
  from_email,
  subject,
  body,
  created_at
FROM contact_leads
ORDER BY created_at DESC
LIMIT 20;
```

### 4.2. Volumen de Leads por Semana

```sql
SELECT
  strftime('%Y-W%W', created_at) AS week,
  COUNT(id) AS total_leads,
  COUNT(DISTINCT from_email) AS unique_senders
FROM contact_leads
GROUP BY week
ORDER BY week DESC;
```

---

## 5. Monitoreo de Cuota D1, Salud y Mantenimiento

Cloudflare D1 Free Tier incluye **100,000 escrituras al día** y **5,000,000 lecturas al día**.

### 5.1. Escrituras Realizadas Hoy (Estimación en Tiempo Real)

Permite verificar cuánto consumo de cuota llevamos acumulado entre visitas y prefetches:

```sql
SELECT
  'pageviews (visitas reales)' AS table_name,
  COUNT(id) AS writes_today
FROM pageviews
WHERE created_at >= date('now', 'start of day')

UNION ALL

SELECT
  'prefetch_analytics_events' AS table_name,
  COUNT(id) AS writes_today
FROM prefetch_analytics_events
WHERE created_at >= date('now', 'start of day')

UNION ALL

SELECT
  'circuit_breaker_incidents' AS table_name,
  COALESCE(SUM(shed_count), 0) AS writes_today
FROM circuit_breaker_incidents
WHERE date = date('now', 'start of day');
```

### 5.2. Conteo Total de Registros por Tabla

Permite monitorear el crecimiento del almacenamiento:

```sql
SELECT 'pageviews' AS tabla, COUNT(*) AS filas FROM pageviews
UNION ALL
SELECT 'prefetch_analytics_events' AS tabla, COUNT(*) AS filas FROM prefetch_analytics_events
UNION ALL
SELECT 'circuit_breaker_incidents' AS tabla, COUNT(*) AS filas FROM circuit_breaker_incidents
UNION ALL
SELECT 'pageviews_daily_summary' AS tabla, COUNT(*) AS filas FROM pageviews_daily_summary
UNION ALL
SELECT 'contact_leads' AS tabla, COUNT(*) AS filas FROM contact_leads;
```

### 5.3. Purga y Retención de Datos de Prefetch Antiguos (> 30 Días)

Si se desea liberar espacio en `prefetch_analytics_events` manteniendo el histórico intacto en `circuit_breaker_incidents`:

```sql
DELETE FROM prefetch_analytics_events
WHERE created_at < datetime('now', '-30 days');
```

---

## 6. Deduplicated Telemetry & Compact Rollups (Compacted Baseline)

Tables: `telemetry_events` (pruned to 2 indexes: `idx_telemetry_dedupe_key`, `idx_telemetry_created_at`) and `analytics_rollups` (`PRIMARY KEY (date, path) WITHOUT ROWID`).

### 6.1. O(1) Indexed Path Views Lookup (EdgeViewCounter & `/api/telemetry/views`)

Uses `idx_analytics_rollups_path` with zero full-table scans on raw event tables:

```sql
SELECT COALESCE(SUM(views), 0) AS total_views
FROM analytics_rollups
WHERE path = ?;
```

### 6.2. Daily Human vs Bot Breakdown from Compact Rollups

```sql
SELECT
  date,
  SUM(views) AS total_views,
  SUM(uniques) AS total_uniques,
  SUM(human_views) AS human_views,
  SUM(bot_views) AS bot_views
FROM analytics_rollups
WHERE date >= date('now', '-30 days')
GROUP BY date
ORDER BY date DESC;
```

### 6.3. Idempotent Batch Upsert with 30m `dedupe_key`

```sql
INSERT OR IGNORE INTO telemetry_events (
  dedupe_key, path, event_type, visitor_hash, is_bot, bot_name,
  country, device_type, referrer_host, status_code, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

INSERT INTO analytics_rollups (date, path, views, uniques, bot_views, human_views)
VALUES (?, ?, 1, 1, ?, ?)
ON CONFLICT(date, path) DO UPDATE SET
  views = views + 1,
  uniques = uniques + 1,
  bot_views = bot_views + excluded.bot_views,
  human_views = human_views + excluded.human_views;
```

---

## 7. Compacted Single-Baseline Schema & Deterministic Reset Workflow

La migración única `0001_initial_schema.sql`, el bootstrap `schema.sql` y el reset destructivo `reset.sql` incluyen las ocho columnas de dispositivo/SO y `bot_category`. Los archivos históricos `0002`–`0010` eran placeholders; las columnas antes agregadas por `0011`/`0012` ya están en la base inicial. Producción conserva el ledger viejo `0001`–`0011` hasta su reset autorizado: **no** ejecutes `migrations apply` ni busques aplicar las migraciones retiradas sobre esa D1. The adapter and WAL replay increment these counters in the existing upsert, with one rollup statement per accepted visit/group; older WAL OS is `other`. The scheduled handler zeros only device/OS counters older than 30 days, preserving historical views and existing retention for other tables. These counters exclude NOMINAL document-only visits until an adapter/collector visit occurs, and cannot establish distinct devices or legal compliance. No remote D1 command is implied.

### 7.1. Key SQLite/D1 Compaction Optimizations

- **`WITHOUT ROWID` Composite B-Trees**: `pageviews_daily_summary`, `analytics_rollups`, and `quota_state_daily` use `WITHOUT ROWID` to eliminate duplicate rowid storage and double B-tree traversals (~50% lower write amplification on upserts).
- **Pruned Secondary Indexes**:
  - `pageviews`: strictly 5 indexes (`idx_pageviews_dedupe_key`, `idx_pageviews_analytics`, `idx_pageviews_visitor`, `idx_pageviews_attribution`, `idx_pageviews_created_at`).
  - `telemetry_events`: strictly 2 indexes (`idx_telemetry_dedupe_key`, `idx_telemetry_created_at`).
  - `prefetch_analytics_events`: strictly 1 index (`idx_prefetch_created`).
- **`PRAGMA optimize;`**: Run at schema initialization and completion to refresh SQLite query planner statistics.

### 7.2. CLI Reset & Schema Commands (`package.json`)

```bash
# Solo local: elimina los objetos conocidos y reconstruye esquema y ledger 0001
pnpm run db:reset:local

# Solo local: aplica el esquema (IF NOT EXISTS); no inicializa el ledger
pnpm run db:schema:local

# Producción: sin atajo. Verificar identidad e inventario; respaldar/restaurar;
# pedir confirmación posterior y recién entonces aplicar el reset al destino exacto.
```
