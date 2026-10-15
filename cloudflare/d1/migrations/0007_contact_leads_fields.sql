-- Migration 0007: Add name, phone, and locale to contact_leads
ALTER TABLE contact_leads ADD COLUMN name TEXT;
ALTER TABLE contact_leads ADD COLUMN phone TEXT;
ALTER TABLE contact_leads ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';

CREATE INDEX IF NOT EXISTS idx_contact_leads_locale ON contact_leads(locale);
