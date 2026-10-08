-- Migration: 0005_circuit_breaker_incidents.sql
-- Tracking for telemetry circuit breaker trips to warn analytical consumers of partial/incomplete daily data.

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

-- Analytical view warning of partial data completeness
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
