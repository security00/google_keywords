-- 0019_pipeline_cost_attribution.sql
-- Make credential ownership explicit on every Pipeline cost event.

ALTER TABLE pipeline_cost_events
ADD COLUMN credential_source TEXT NOT NULL DEFAULT 'platform';

ALTER TABLE pipeline_cost_events
ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'platform';

ALTER TABLE pipeline_cost_events
ADD COLUMN owner_id TEXT;

CREATE INDEX IF NOT EXISTS idx_pipeline_cost_events_attribution
  ON pipeline_cost_events(credential_source, execution_mode, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_cost_events_owner
  ON pipeline_cost_events(owner_id, created_at DESC)
  WHERE owner_id IS NOT NULL;
