-- Coarse, non-identifying counters on the existing (date,path) rollup row.
-- No backfill from retained raw events: historical counts remain unknown, not inferred.
ALTER TABLE analytics_rollups ADD COLUMN device_desktop INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_rollups ADD COLUMN device_mobile INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_rollups ADD COLUMN os_windows INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_rollups ADD COLUMN os_macos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_rollups ADD COLUMN os_ios INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_rollups ADD COLUMN os_android INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_rollups ADD COLUMN os_linux INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analytics_rollups ADD COLUMN os_other INTEGER NOT NULL DEFAULT 0;
