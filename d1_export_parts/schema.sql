create table if not exists research_sessions (
  id TEXT,
  user_id TEXT,
  title TEXT,
  keywords TEXT,
  date_from TEXT,
  date_to TEXT,
  benchmark TEXT,
  include_top INTEGER,
  use_filter INTEGER,
  filter_terms TEXT,
  filter_prompt TEXT,
  filter_summary TEXT,
  created_at TEXT
);
create table if not exists candidates (
  id TEXT,
  session_id TEXT,
  user_id TEXT,
  keyword TEXT,
  value INTEGER,
  type TEXT,
  source TEXT,
  filtered INTEGER,
  created_at TEXT
);
create table if not exists comparisons (
  id TEXT,
  session_id TEXT,
  user_id TEXT,
  benchmark TEXT,
  date_from TEXT,
  date_to TEXT,
  summary TEXT,
  recent_points INTEGER,
  metrics_version TEXT,
  created_at TEXT
);
create table if not exists comparison_results (
  id TEXT,
  comparison_id TEXT,
  user_id TEXT,
  keyword TEXT,
  avg_value REAL,
  benchmark_value REAL,
  ratio REAL,
  ratio_mean REAL,
  ratio_recent REAL,
  ratio_coverage REAL,
  ratio_peak REAL,
  slope_diff REAL,
  volatility REAL,
  crossings INTEGER,
  verdict TEXT,
  trend_series TEXT,
  explanation TEXT,
  intent TEXT,
  created_at TEXT
);
