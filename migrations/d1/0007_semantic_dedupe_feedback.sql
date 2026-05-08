CREATE TABLE IF NOT EXISTS semantic_dedupe_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  semantic_key TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('merge', 'separate')),
  representative_keyword TEXT NOT NULL,
  variants_json TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, semantic_key)
);

CREATE INDEX IF NOT EXISTS idx_semantic_dedupe_feedback_user_updated
  ON semantic_dedupe_feedback(user_id, updated_at DESC);
