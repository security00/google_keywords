-- Owner-scoped research mode preference and durable batch BYOK orchestration.

CREATE TABLE IF NOT EXISTS research_preferences (
  owner_id TEXT PRIMARY KEY,
  execution_mode TEXT NOT NULL DEFAULT 'shared'
    CHECK (execution_mode IN ('shared', 'byok')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS byok_pipeline_quotes (
  quote_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('expand', 'compare')),
  request_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL,
  child_quotes_json TEXT NOT NULL,
  estimated_cost_micro_usd INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'quoted'
    CHECK (status IN ('quoted', 'executing', 'complete', 'partial', 'failed')),
  expires_at TEXT NOT NULL,
  parent_job_id TEXT,
  retry_of_job_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_byok_pipeline_quotes_owner_created
  ON byok_pipeline_quotes(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS byok_pipeline_runs (
  job_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('expand', 'compare')),
  quote_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  execute_idempotency_key TEXT NOT NULL,
  execute_request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'complete', 'partial', 'failed')),
  total_steps INTEGER NOT NULL,
  completed_steps INTEGER NOT NULL DEFAULT 0,
  result_cache_key TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, quote_id),
  UNIQUE (owner_id, operation, execute_idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_byok_pipeline_runs_owner_created
  ON byok_pipeline_runs(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS byok_pipeline_steps (
  parent_job_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  child_job_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (parent_job_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_byok_pipeline_steps_parent_status
  ON byok_pipeline_steps(parent_job_id, status, updated_at);
