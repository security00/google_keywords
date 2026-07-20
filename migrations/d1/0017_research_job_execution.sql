-- 0017_research_job_execution.sql
-- Add explicit execution metadata and an atomic lease for idempotent workers.

ALTER TABLE research_jobs
ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'platform';

ALTER TABLE research_jobs
ADD COLUMN credential_source TEXT NOT NULL DEFAULT 'platform';

ALTER TABLE research_jobs
ADD COLUMN idempotency_key TEXT;

ALTER TABLE research_jobs
ADD COLUMN claim_token TEXT;

ALTER TABLE research_jobs
ADD COLUMN lease_expires_at TEXT;

ALTER TABLE research_jobs
ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_jobs_idempotency
  ON research_jobs(user_id, job_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_research_jobs_claimable
  ON research_jobs(status, lease_expires_at, updated_at);
