-- Migration 0009: Composite Performance Indexes for Zero-Scan Telemetry
-- Eliminates full-table scans by indexing created_at as leading column for range queries (24h, 7d, 30d)
CREATE INDEX IF NOT EXISTS idx_pageviews_created_at ON pageviews(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pageviews_perf_composite ON pageviews(created_at DESC, is_bot, country, path);
CREATE INDEX IF NOT EXISTS idx_pageviews_path_created ON pageviews(path, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pageviews_country_created ON pageviews(country, created_at DESC);
