-- Apply to the existing compact baseline before deploying code that writes these fields.
-- Existing rows retain explicit unknowns; no reset or backfill of inferred categories.
ALTER TABLE telemetry_events ADD COLUMN region TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE telemetry_events ADD COLUMN os_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE telemetry_events ADD COLUMN browser TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE telemetry_events ADD COLUMN browser_language TEXT NOT NULL DEFAULT 'unknown';
