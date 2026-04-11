-- Keyword history for trend comparison
CREATE TABLE IF NOT EXISTS keyword_history (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  keyword_normalized TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'top',
  source TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_keyword_history_keyword_date 
  ON keyword_history(keyword_normalized, date);

CREATE INDEX IF NOT EXISTS idx_keyword_history_date 
  ON keyword_history(date);

-- AI filter cache (avoid re-running LLM for same keyword set)
CREATE TABLE IF NOT EXISTS filter_cache (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  blocked_keywords TEXT NOT NULL DEFAULT '[]',
  kept_keywords TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_filter_cache_key 
  ON filter_cache(cache_key);
