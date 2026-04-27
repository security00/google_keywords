CREATE TABLE IF NOT EXISTS old_keyword_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  keyword_normalized TEXT NOT NULL,
  scan_date TEXT NOT NULL,
  evaluation_version TEXT NOT NULL,
  real_score REAL NOT NULL,
  base_score REAL NOT NULL,
  serp_score REAL NOT NULL,
  brand_safety_score REAL NOT NULL,
  intent_score REAL NOT NULL,
  content_feasibility_score REAL NOT NULL,
  serp_organic INTEGER DEFAULT 0,
  serp_auth INTEGER DEFAULT 0,
  serp_featured INTEGER DEFAULT 0,
  serp_ai_overview INTEGER DEFAULT 0,
  top_domains_json TEXT,
  signals_json TEXT,
  cost_json TEXT,
  evaluated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(keyword_normalized, scan_date, evaluation_version)
);

CREATE INDEX IF NOT EXISTS idx_old_keyword_evaluations_scan_score
  ON old_keyword_evaluations(scan_date, real_score DESC);

CREATE INDEX IF NOT EXISTS idx_old_keyword_evaluations_keyword
  ON old_keyword_evaluations(keyword_normalized, scan_date);
