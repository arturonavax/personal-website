-- One coarse category on already-recorded bot pageviews; no new identifier or index.
-- Historical bot rows remain NULL (unknown), never reclassified from old user agents.
ALTER TABLE pageviews ADD COLUMN bot_category TEXT;
