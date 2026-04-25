CREATE TABLE IF NOT EXISTS pipeline_cost_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  unit_count INTEGER NOT NULL DEFAULT 0,
  unit_price_usd REAL,
  estimated_cost_usd REAL,
  actual_cost_usd REAL,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pipeline_cost_events_run_id
  ON pipeline_cost_events(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_cost_events_pipeline_created
  ON pipeline_cost_events(pipeline, created_at DESC);
