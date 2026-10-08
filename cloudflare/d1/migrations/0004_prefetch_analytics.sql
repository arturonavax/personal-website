-- Migration: 0004_prefetch_analytics.sql
-- Isolated telemetry table for speculative browser & framework prefetches
-- Protected by PrefetchQuotaCircuitBreaker to shield D1 daily write limits (100k/day).

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
