-- Migration: 0006_deployment_releases.sql
-- Registry table to audit and track system deployments, worker versions, and database synchronization.

CREATE TABLE IF NOT EXISTS system_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  release_version TEXT NOT NULL,
  worker_name TEXT NOT NULL DEFAULT 'personal-website',
  git_commit TEXT,
  deployed_at TEXT NOT NULL DEFAULT (datetime('now')),
  environment TEXT NOT NULL DEFAULT 'production',
  status TEXT NOT NULL DEFAULT 'active',
  compatibility_date TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_deployments_version ON system_deployments(release_version);
CREATE INDEX IF NOT EXISTS idx_deployments_deployed ON system_deployments(deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON system_deployments(status);

-- Mark current release deployment to signify that data from this moment forward integrates the new worker and database
INSERT INTO system_deployments (
  release_version,
  worker_name,
  git_commit,
  environment,
  status,
  compatibility_date,
  metadata
) VALUES (
  '1.0.0-spec-unified',
  'personal-website',
  '1a7843d',
  'production',
  'active',
  '2026-09-26',
  '{"subsystems":{"d1_migrations":["0001","0002","0003","0004","0005","0006"],"vectorize_index":"knowledge-embeddings","prefetch_circuit_breaker":true,"edge_ssg":true}}'
);
