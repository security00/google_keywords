CREATE TABLE IF NOT EXISTS game_opportunity_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('worth_doing', 'not_worth_doing')),
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_game_opportunity_feedback_user_updated
  ON game_opportunity_feedback(user_id, updated_at DESC);
