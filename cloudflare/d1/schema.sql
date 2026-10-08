CREATE TABLE IF NOT EXISTS pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  referrer TEXT,
  country TEXT,
  utm_source TEXT DEFAULT 'direct',
  utm_medium TEXT DEFAULT 'none',
  utm_campaign TEXT DEFAULT '',
  utm_content TEXT DEFAULT '',
  utm_term TEXT DEFAULT '',
  is_bot INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Visitas únicas, páginas más vistas y rendimiento filtrado por bots y fechas
CREATE INDEX IF NOT EXISTS idx_pageviews_analytics ON pageviews(is_bot, created_at, path);
CREATE INDEX IF NOT EXISTS idx_pageviews_visitor ON pageviews(visitor_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_attribution ON pageviews(utm_source, utm_medium, utm_campaign, created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_content ON pageviews(utm_content, created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_referrer ON pageviews(is_bot, referrer, created_at);

-- Edge Telemetry Table for Zero-Tracking Analytics (SPEC-001)
CREATE TABLE IF NOT EXISTS edge_telemetry_events (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  path TEXT NOT NULL,
  locale TEXT NOT NULL,
  country TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  referrer TEXT
);

CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON edge_telemetry_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_path ON edge_telemetry_events(path);
CREATE INDEX IF NOT EXISTS idx_telemetry_hash ON edge_telemetry_events(visitor_hash);

-- Raw pageviews buffer (SPEC-003)
CREATE TABLE IF NOT EXISTS pageview_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  locale TEXT NOT NULL,
  country TEXT NOT NULL,
  referrer TEXT,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pageview_timestamp ON pageview_events(timestamp);

-- Aggregated Daily Summary Table (Zero Full Scans on queries, SPEC-003)
CREATE TABLE IF NOT EXISTS pageviews_daily_summary (
  summary_date TEXT NOT NULL,
  path TEXT NOT NULL,
  locale TEXT NOT NULL,
  country TEXT NOT NULL,
  total_views INTEGER NOT NULL,
  PRIMARY KEY (summary_date, path, locale, country)
);

CREATE INDEX IF NOT EXISTS idx_summary_date ON pageviews_daily_summary(summary_date);

-- Contact Leads for Serverless Corporate Email Ingestion (SPEC-003)
CREATE TABLE IF NOT EXISTS contact_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_leads_created ON contact_leads(created_at DESC);

-- Isolated Prefetch Telemetry (SPEC-010, Migration 0004)
CREATE TABLE IF NOT EXISTS prefetch_analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  referrer TEXT,
  country TEXT,
  purpose TEXT NOT NULL DEFAULT 'prefetch',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prefetch_path ON prefetch_analytics_events(path, created_at);
CREATE INDEX IF NOT EXISTS idx_prefetch_created ON prefetch_analytics_events(created_at);

-- Telemetry Circuit Breaker Incidents & Traceability (SPEC-010, Migration 0005)
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
