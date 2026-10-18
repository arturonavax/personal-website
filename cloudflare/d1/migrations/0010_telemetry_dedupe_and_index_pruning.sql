-- 0010: Authoritative pageview deduplication + write-amplification reduction (SPEC-005 / ODD edge telemetry hardening)
--
-- 1) dedupe_key: deterministic key = sha256(visitor_hash | normalized_path | time_bucket) truncated.
--    A UNIQUE index lets the Worker use INSERT OR IGNORE so duplicates are rejected by D1 itself,
--    correctly across every isolate/POP (the in-memory cache is only a first-level optimization).
--    SQLite allows many NULLs in a UNIQUE index, so legacy rows stay valid.
ALTER TABLE pageviews ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pageviews_dedupe_key ON pageviews(dedupe_key);

-- 2) Prune redundant indexes. D1 bills one written row per index entry, so each pageview previously
--    cost ~10 written rows in `pageviews`. Remaining coverage:
--      idx_pageviews_created_at  (range filters, ORDER BY created_at DESC)
--      idx_pageviews_analytics   (is_bot, created_at, path)
--      idx_pageviews_visitor     (visitor_hash, created_at)
--      idx_pageviews_attribution (utm_*, created_at)
DROP INDEX IF EXISTS idx_pageviews_perf_composite;
DROP INDEX IF EXISTS idx_pageviews_path_created;
DROP INDEX IF EXISTS idx_pageviews_country_created;
DROP INDEX IF EXISTS idx_pageviews_content;
DROP INDEX IF EXISTS idx_pageviews_referrer;
