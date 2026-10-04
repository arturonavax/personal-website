-- Raw pageviews buffer
CREATE TABLE IF NOT EXISTS pageview_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  locale TEXT NOT NULL,
  country TEXT NOT NULL,
  referrer TEXT,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pageview_timestamp ON pageview_events(timestamp);

-- Aggregated Daily Summary Table (Zero Full Scans on queries)
CREATE TABLE IF NOT EXISTS pageviews_daily_summary (
  summary_date TEXT NOT NULL,
  path TEXT NOT NULL,
  locale TEXT NOT NULL,
  country TEXT NOT NULL,
  total_views INTEGER NOT NULL,
  PRIMARY KEY (summary_date, path, locale, country)
);

CREATE INDEX IF NOT EXISTS idx_summary_date ON pageviews_daily_summary(summary_date);
