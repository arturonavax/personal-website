CREATE TABLE IF NOT EXISTS pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  referrer TEXT,
  country TEXT,
  is_bot INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pageviews_path_date ON pageviews(path, created_at);
CREATE INDEX IF NOT EXISTS idx_pageviews_visitor_date ON pageviews(visitor_hash, created_at);
