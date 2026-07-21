-- Credential-free audit trail for controlled BYOK stale-job reconciliation.

CREATE TABLE IF NOT EXISTS byok_reconciliation_audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  research_job_id TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('complete_from_private_cache', 'mark_uncertain')),
  previous_updated_at TEXT NOT NULL,
  resulting_status TEXT NOT NULL
    CHECK (resulting_status IN ('complete', 'failed')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_byok_reconciliation_audit_job_created
  ON byok_reconciliation_audit_events(research_job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_byok_reconciliation_audit_actor_created
  ON byok_reconciliation_audit_events(actor_id, created_at DESC);
