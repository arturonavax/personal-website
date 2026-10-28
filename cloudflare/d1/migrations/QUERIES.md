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
  FROM telemetry_events
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

Fuente de visitas: `telemetry_events` (detalle humano NOMINAL/CONSERVATIVE, retención 7 días; bots muestreados, retención 30 días). El primer documento se agenda con `ctx.waitUntil`, pero las rutas SPA confirmadas requieren el collector. Ninguna respuesta `202` prueba persistencia.

### 2.1. Métricas Globales (Visitas Totales, Únicas y Bots)

Este ejemplo consulta detalle retenido en `telemetry_events`; para métricas históricas consulta `analytics_rollups`:

```sql
SELECT
  COUNT(*) AS total_hits,
  SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS human_views,
  SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bot_views,
  COUNT(DISTINCT CASE WHEN is_bot = 0 THEN visitor_hash END) AS unique_human_visitors
FROM telemetry_events
WHERE datetime(created_at) >= datetime('now', '-7 days');
```

### 2.2. Top 10 Páginas Más Vistas por Humanos

Usa el índice `idx_telemetry_analytics(is_bot, created_at, path)`:

```sql
SELECT
  path,
  COUNT(id) AS total_views,
  COUNT(DISTINCT visitor_hash) AS unique_visitors
FROM telemetry_events
WHERE is_bot = 0
  AND datetime(created_at) >= datetime('now', '-7 days')
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
FROM telemetry_events
WHERE is_bot = 0
  AND datetime(created_at) >= datetime('now', '-7 days')
GROUP BY country
ORDER BY views DESC
LIMIT 15;
```

### 2.4. Atribución de Campañas (UTM Source / Medium / Campaign)

La atribución acotada vive en el mismo registro humano:

```sql
SELECT
  utm_source,
  utm_medium,
  utm_campaign,
  COUNT(id) AS sessions,
  COUNT(DISTINCT visitor_hash) AS unique_users
FROM telemetry_events
WHERE is_bot = 0
  AND utm_source != 'direct'
  AND datetime(created_at) >= datetime('now', '-7 days')
GROUP BY utm_source, utm_medium, utm_campaign
ORDER BY sessions DESC;
```

### 2.5. Fuentes de Referencia Externas (Top Referrers)

El campo de referencia es `referrer_host`, no la URL completa:

```sql
SELECT
  referrer_host,
  COUNT(id) AS referral_visits
FROM telemetry_events
WHERE is_bot = 0
  AND referrer_host != ''
  AND referrer_host NOT LIKE '%arturonavax.dev%'
  AND datetime(created_at) >= datetime('now', '-7 days')
GROUP BY referrer_host
ORDER BY referral_visits DESC
LIMIT 20;
```

---

## 3. Resúmenes Diarios & Rollups de Alto Rendimiento

`analytics_rollups` conserva totales históricos por fecha y ruta; el cron conserva el detalle humano siete días y el detalle bot muestreado treinta días. No hay buffer de visitas ni resumen duplicado.

```sql
SELECT date, path, views, human_views, bot_views
FROM analytics_rollups
WHERE date >= date('now', '-14 days')
ORDER BY date DESC, views DESC;
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
  'telemetry_events (detalle retenido)' AS table_name,
  COUNT(id) AS writes_today
FROM telemetry_events
WHERE datetime(created_at) >= date('now', 'start of day')

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
SELECT 'telemetry_events' AS tabla, COUNT(*) AS filas FROM telemetry_events
UNION ALL
SELECT 'prefetch_analytics_events' AS tabla, COUNT(*) AS filas FROM prefetch_analytics_events
UNION ALL
SELECT 'circuit_breaker_incidents' AS tabla, COUNT(*) AS filas FROM circuit_breaker_incidents
UNION ALL
SELECT 'analytics_rollups' AS tabla, COUNT(*) AS filas FROM analytics_rollups
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

Tables: `telemetry_events` (unique dedupe, time and classification indexes: `idx_telemetry_dedupe_key`, `idx_telemetry_created_at`, `idx_telemetry_analytics`) and `analytics_rollups` (`PRIMARY KEY (date, path) WITHOUT ROWID`).

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
  country, device_type, region, os_type, browser, browser_language,
  referrer_host, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  bot_category, status_code, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

INSERT INTO analytics_rollups (date, path, views, uniques, bot_views, human_views)
SELECT ?, ?, 1, 1, ?, ? WHERE changes() > 0
ON CONFLICT(date, path) DO UPDATE SET
  views = views + 1,
  uniques = uniques + 1,
  bot_views = bot_views + excluded.bot_views,
  human_views = human_views + excluded.human_views;
```

---

## 7. Compacted Single-Baseline Schema & Deterministic Reset Workflow

La migración única `0001_initial_schema.sql`, el bootstrap `schema.sql` y el reset destructivo `reset.sql` incluyen las ocho columnas de dispositivo/SO y `bot_category`. Los archivos históricos `0002`–`0010` eran placeholders; las columnas antes agregadas por `0011`/`0012` ya están en la base inicial. Producción conserva el ledger viejo `0001`–`0011` hasta su reset autorizado: **no** ejecutes `migrations apply` ni busques aplicar las migraciones retiradas sobre esa D1. The adapter and WAL replay increment these counters in the existing upsert, with one rollup statement per accepted visit/group; older WAL OS is `other`. The scheduled handler zeros only device/OS counters older than 30 days, preserving historical views and existing retention for other tables. Human documents and committed collector events share the adapter; raw detail still excludes compact-tier writes and WAL objects awaiting replay. These counters cannot establish distinct devices or legal compliance. No remote D1 command is implied.

### 7.1. Key SQLite/D1 Compaction Optimizations

- **`WITHOUT ROWID` Composite B-Trees**: `analytics_rollups` and `quota_state_daily` use `WITHOUT ROWID` to eliminate duplicate rowid storage and double B-tree traversals (~50% lower write amplification on upserts).
- **Pruned Secondary Indexes**:
  - `telemetry_events`: 3 indexes (`idx_telemetry_dedupe_key`, `idx_telemetry_created_at`, `idx_telemetry_analytics`).
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
