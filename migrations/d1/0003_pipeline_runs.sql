CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id TEXT PRIMARY KEY,
  pipeline TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_seconds REAL,
  checked_count INTEGER,
  saved_count INTEGER,
  estimated_cost_usd REAL,
  error TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline_started
  ON pipeline_runs(pipeline, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status_started
  ON pipeline_runs(status, started_at DESC);
