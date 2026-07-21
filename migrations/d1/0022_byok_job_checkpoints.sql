-- Add an irreversible paid-request checkpoint to BYOK research jobs.
-- A request that reached `started` is never automatically reclaimed.

ALTER TABLE research_jobs
ADD COLUMN provider_connection_id TEXT;

ALTER TABLE research_jobs
ADD COLUMN provider_connection_version INTEGER
  CHECK (provider_connection_version IS NULL OR provider_connection_version >= 1);

ALTER TABLE research_jobs
ADD COLUMN provider_request_state TEXT NOT NULL DEFAULT 'not_started'
  CHECK (provider_request_state IN ('not_started', 'started', 'completed', 'failed'));

ALTER TABLE research_jobs
ADD COLUMN result_cache_key TEXT;

CREATE INDEX IF NOT EXISTS idx_research_jobs_byok_checkpoint
  ON research_jobs(user_id, execution_mode, provider_request_state, updated_at DESC);
