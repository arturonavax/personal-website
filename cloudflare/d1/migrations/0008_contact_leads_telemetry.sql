-- Migration 0008: Add legal forensic, network & geo telemetry to contact_leads
ALTER TABLE contact_leads ADD COLUMN ip TEXT;
ALTER TABLE contact_leads ADD COLUMN country TEXT;
ALTER TABLE contact_leads ADD COLUMN city TEXT;
ALTER TABLE contact_leads ADD COLUMN region TEXT;
ALTER TABLE contact_leads ADD COLUMN timezone TEXT;
ALTER TABLE contact_leads ADD COLUMN asn INTEGER;
ALTER TABLE contact_leads ADD COLUMN as_organization TEXT;
ALTER TABLE contact_leads ADD COLUMN user_agent TEXT;
ALTER TABLE contact_leads ADD COLUMN referer TEXT;
ALTER TABLE contact_leads ADD COLUMN turnstile_verified INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_contact_leads_ip ON contact_leads(ip);
CREATE INDEX IF NOT EXISTS idx_contact_leads_country ON contact_leads(country);
CREATE INDEX IF NOT EXISTS idx_contact_leads_asn ON contact_leads(asn);
