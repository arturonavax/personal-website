-- =============================================================================
-- Cloudflare D1 Unified Authoritative Schema (Compacted Baseline v1)
-- Low-Write-Amplification, WITHOUT ROWID Composite Rollups, & 30m Deduplication
-- =============================================================================

-- Low-Write-Amplification Telemetry Events
CREATE TABLE IF NOT EXISTS telemetry_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT,
  path TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'pageview',
  visitor_hash TEXT NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0,
  bot_name TEXT,
  country TEXT DEFAULT 'XX',
  device_type TEXT DEFAULT 'desktop',
  region TEXT NOT NULL DEFAULT 'unknown',
  os_type TEXT NOT NULL DEFAULT 'unknown',
  browser TEXT NOT NULL DEFAULT 'unknown',
  browser_language TEXT NOT NULL DEFAULT 'unknown',
  referrer_host TEXT DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT 'direct',
  utm_medium TEXT NOT NULL DEFAULT 'none',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  bot_category TEXT,
  status_code INTEGER NOT NULL DEFAULT 200,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_dedupe_key ON telemetry_events(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON telemetry_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_analytics ON telemetry_events(is_bot, created_at, path);

-- Compact Daily Rollups by (date, path) (WITHOUT ROWID)
CREATE TABLE IF NOT EXISTS analytics_rollups (
  date TEXT NOT NULL,
  path TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,
  bot_views INTEGER NOT NULL DEFAULT 0,
  human_views INTEGER NOT NULL DEFAULT 0,
  device_desktop INTEGER NOT NULL DEFAULT 0,
  device_mobile INTEGER NOT NULL DEFAULT 0,
  os_windows INTEGER NOT NULL DEFAULT 0,
  os_macos INTEGER NOT NULL DEFAULT 0,
  os_ios INTEGER NOT NULL DEFAULT 0,
  os_android INTEGER NOT NULL DEFAULT 0,
  os_linux INTEGER NOT NULL DEFAULT 0,
  os_other INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, path)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_analytics_rollups_path ON analytics_rollups(path);

-- Contact Leads for Serverless Corporate Email Ingestion
CREATE TABLE IF NOT EXISTS contact_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  from_email TEXT NOT NULL,
  phone TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  ip TEXT,
  country TEXT,
  city TEXT,
  region TEXT,
  timezone TEXT,
  asn INTEGER,
  as_organization TEXT,
  user_agent TEXT,
  referer TEXT,
  turnstile_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_leads_created ON contact_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_leads_locale ON contact_leads(locale);
CREATE INDEX IF NOT EXISTS idx_contact_leads_ip ON contact_leads(ip);
CREATE INDEX IF NOT EXISTS idx_contact_leads_country ON contact_leads(country);
CREATE INDEX IF NOT EXISTS idx_contact_leads_asn ON contact_leads(asn);

-- Isolated Prefetch Telemetry (pruned to idx_prefetch_created only)
CREATE TABLE IF NOT EXISTS prefetch_analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  referrer TEXT,
  country TEXT,
  purpose TEXT NOT NULL DEFAULT 'prefetch',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prefetch_created ON prefetch_analytics_events(created_at);

-- Cross-isolate Daily D1 Quota State (WITHOUT ROWID)
CREATE TABLE IF NOT EXISTS quota_state_daily (
  date_utc TEXT PRIMARY KEY,
  estimated_rows_written INTEGER NOT NULL DEFAULT 0,
  estimated_rows_read INTEGER NOT NULL DEFAULT 0,
  degradation_tier INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Telemetry Circuit Breaker Incidents & Traceability
CREATE TABLE IF NOT EXISTS circuit_breaker_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subsystem TEXT NOT NULL,
  date TEXT NOT NULL,
  tripped_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT NOT NULL,
  shed_count INTEGER NOT NULL DEFAULT 1,
  data_completeness TEXT NOT NULL DEFAULT 'partial',
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cb_subsystem_date ON circuit_breaker_incidents(subsystem, date);
CREATE INDEX IF NOT EXISTS idx_cb_date ON circuit_breaker_incidents(date);

-- Analytical View for Prefetch with Data Completeness Flag
CREATE VIEW IF NOT EXISTS v_prefetch_daily_summary AS
SELECT
  strftime('%Y-%m-%d', p.created_at) AS summary_date,
  p.path,
  COUNT(p.id) AS recorded_prefetches,
  COALESCE(c.data_completeness, 'complete') AS data_completeness,
  COALESCE(c.shed_count, 0) AS estimated_shed_count,
  c.reason AS circuit_breaker_reason
FROM prefetch_analytics_events p
LEFT JOIN circuit_breaker_incidents c
  ON c.subsystem = 'prefetch_telemetry'
  AND c.date = strftime('%Y-%m-%d', p.created_at)
GROUP BY summary_date, p.path;

-- System Deployments Registry
CREATE TABLE IF NOT EXISTS system_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_version TEXT NOT NULL,
  worker_name TEXT NOT NULL DEFAULT 'personal-website',
  git_commit TEXT,
  deployed_at TEXT NOT NULL DEFAULT (datetime('now')),
  environment TEXT NOT NULL DEFAULT 'production',
  status TEXT NOT NULL DEFAULT 'active',
  compatibility_date TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_deployments_version ON system_deployments(release_version);
CREATE INDEX IF NOT EXISTS idx_deployments_deployed ON system_deployments(deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON system_deployments(status);

INSERT OR IGNORE INTO system_deployments (
  id,
  release_version,
  worker_name,
  environment,
  status,
  compatibility_date,
  metadata
) VALUES (
  1,
  '1.0.0-spec-unified',
  'personal-website',
  'production',
  'active',
  '2026-03-17',
  '{"architecture":"hexagonal-edge-ssg","schema":"compacted-v1"}'
);

PRAGMA optimize;
