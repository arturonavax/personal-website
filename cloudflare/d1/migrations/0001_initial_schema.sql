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

CREATE INDEX IF NOT EXISTS idx_pageviews_analytics ON pageviews(is_bot, created_at, path);
CREATE INDEX IF NOT EXISTS idx_pageviews_visitor ON pageviews(visitor_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_attribution ON pageviews(utm_source, utm_medium, utm_campaign, created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_content ON pageviews(utm_content, created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_referrer ON pageviews(is_bot, referrer, created_at);

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
