CREATE TABLE IF NOT EXISTS pipeline_tasks (
  task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  queue_message_id TEXT,
  research_job_id TEXT,
  provider_task_ids_json TEXT,
  input_ref TEXT,
  output_ref TEXT,
  payload_json TEXT,
  result_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_owner TEXT,
  lease_expires_at TEXT,
  next_run_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_run_stage_status
  ON pipeline_tasks(run_id, stage, status);

CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_status_next_run
  ON pipeline_tasks(status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_research_job
  ON pipeline_tasks(research_job_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_lease
  ON pipeline_tasks(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS pipeline_artifacts (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT,
  pipeline TEXT NOT NULL,
  kind TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  bucket TEXT,
  object_key TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  checksum TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pipeline_artifacts_run_kind
  ON pipeline_artifacts(run_id, kind);

CREATE INDEX IF NOT EXISTS idx_pipeline_artifacts_task
  ON pipeline_artifacts(task_id, kind);

ALTER TABLE pipeline_runs ADD COLUMN run_key TEXT;
ALTER TABLE pipeline_runs ADD COLUMN budget_usd REAL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_run_key
  ON pipeline_runs(run_key)
  WHERE run_key IS NOT NULL;

ALTER TABLE pipeline_cost_events ADD COLUMN task_id TEXT;
ALTER TABLE pipeline_cost_events ADD COLUMN research_job_id TEXT;
ALTER TABLE pipeline_cost_events ADD COLUMN event_key TEXT;
ALTER TABLE pipeline_cost_events ADD COLUMN provider_request_id TEXT;
ALTER TABLE pipeline_cost_events ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_cost_events_event_key
  ON pipeline_cost_events(event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_cost_events_task
  ON pipeline_cost_events(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_cost_events_research_job
  ON pipeline_cost_events(research_job_id, created_at DESC);
