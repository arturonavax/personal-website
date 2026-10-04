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
