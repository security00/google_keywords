-- Record per-source funnel snapshots for Game Radar automation.
-- This is observability only; it does not change student-facing recommendation gates.

CREATE TABLE IF NOT EXISTS game_radar_source_funnel_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  run_started_at TEXT NOT NULL,
  run_completed_at TEXT NOT NULL,
  status TEXT NOT NULL,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  trend_checked_count INTEGER NOT NULL DEFAULT 0,
  trend_pass_count INTEGER NOT NULL DEFAULT 0,
  trend_fail_count INTEGER NOT NULL DEFAULT 0,
  serp_checked_count INTEGER NOT NULL DEFAULT 0,
  serp_pass_count INTEGER NOT NULL DEFAULT 0,
  serp_fail_count INTEGER NOT NULL DEFAULT 0,
  promoted_count INTEGER NOT NULL DEFAULT 0,
  student_visible_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES game_radar_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_game_radar_source_funnel_source_started
  ON game_radar_source_funnel_runs(source_id, run_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_radar_source_funnel_started
  ON game_radar_source_funnel_runs(run_started_at DESC);
