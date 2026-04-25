-- Production D1 baseline schema snapshot.
-- Generated from remote ai-trends. Do not edit by hand for migrations.

-- index: idx_api_keys_key
CREATE INDEX idx_api_keys_key ON api_keys(key);

-- index: idx_api_keys_user_id
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);

-- index: idx_auth_sessions_token
CREATE UNIQUE INDEX idx_auth_sessions_token on auth_sessions (token_hash);

-- index: idx_auth_sessions_user
CREATE INDEX idx_auth_sessions_user on auth_sessions (user_id);

-- index: idx_auth_users_email
CREATE UNIQUE INDEX idx_auth_users_email on auth_users (email);

-- index: idx_auth_users_v2_email
CREATE UNIQUE INDEX idx_auth_users_v2_email ON auth_users_v2 (email);

-- index: idx_cache_key
CREATE INDEX idx_cache_key ON query_cache(cache_key, created_at);

-- index: idx_candidates_session
CREATE INDEX idx_candidates_session on candidates (session_id);

-- index: idx_comparisons_session
CREATE INDEX idx_comparisons_session on comparisons (session_id);

-- index: idx_discovered_keywords_source
CREATE INDEX idx_discovered_keywords_source on discovered_keywords (user_id, source_id, extracted_at desc);

-- index: idx_discovered_keywords_status
CREATE INDEX idx_discovered_keywords_status on discovered_keywords (user_id, status, extracted_at desc);

-- index: idx_filter_cache_key
CREATE INDEX idx_filter_cache_key ON filter_cache(cache_key);

-- index: idx_gkp_status
CREATE INDEX idx_gkp_status ON game_keyword_pipeline(status);

-- index: idx_gkp_verdict
CREATE INDEX idx_gkp_verdict ON game_keyword_pipeline(trend_verdict);

-- index: idx_invite_codes_created_by
CREATE INDEX idx_invite_codes_created_by ON invite_codes (created_by);

-- index: idx_jobs_status
CREATE INDEX idx_jobs_status on research_jobs (status, created_at desc);

-- index: idx_jobs_user_created
CREATE INDEX idx_jobs_user_created on research_jobs (user_id, created_at desc);

-- index: idx_keyword_history_date
CREATE INDEX idx_keyword_history_date ON keyword_history(date);

-- index: idx_keyword_history_keyword_date
CREATE INDEX idx_keyword_history_keyword_date ON keyword_history(keyword_normalized, date);

-- index: idx_results_comparison
CREATE INDEX idx_results_comparison on comparison_results (comparison_id);

-- index: idx_sessions_user_created
CREATE INDEX idx_sessions_user_created on research_sessions (user_id, created_at desc);

-- index: idx_sitemap_entries_source_seen
CREATE INDEX idx_sitemap_entries_source_seen on sitemap_entries (source_id, last_seen_at desc);

-- index: idx_sitemap_sources_next_check
CREATE INDEX idx_sitemap_sources_next_check ON sitemap_sources (user_id, enabled, next_check_at);

-- index: idx_sitemap_sources_user_enabled
CREATE INDEX idx_sitemap_sources_user_enabled on sitemap_sources (user_id, enabled, created_at desc);

-- table: _cf_KV
CREATE TABLE _cf_KV (
        key TEXT PRIMARY KEY,
        value BLOB
      ) WITHOUT ROWID;

-- table: api_keys
CREATE TABLE api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, name TEXT DEFAULT 'default', created_at TEXT DEFAULT (datetime('now')), expires_at TEXT, active INTEGER DEFAULT 1, key_hash TEXT);

-- table: auth_sessions
CREATE TABLE auth_sessions (
  id TEXT primary key,
  user_id TEXT not null,
  token_hash TEXT not null,
  created_at TEXT not null,
  expires_at TEXT not null
);

-- table: auth_users
CREATE TABLE auth_users (
  id TEXT primary key,
  email TEXT not null,
  password_hash TEXT not null,
  created_at TEXT not null,
  updated_at TEXT not null
);

-- table: auth_users_v2
CREATE TABLE auth_users_v2 (id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', trial_started_at TEXT, trial_expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

-- table: candidates
CREATE TABLE candidates (
  id TEXT,
  session_id TEXT,
  user_id TEXT,
  keyword TEXT,
  value INTEGER,
  type TEXT,
  source TEXT,
  filtered INTEGER,
  created_at TEXT
, score INTEGER DEFAULT 0, confidence INTEGER DEFAULT NULL);

-- table: community_signals
CREATE TABLE community_signals (
  id TEXT PRIMARY KEY,
  keyword_normalized TEXT NOT NULL UNIQUE,
  hn_points INTEGER DEFAULT 0,
  hn_comments INTEGER DEFAULT 0,
  hn_title TEXT,
  hn_url TEXT,
  hn_created_at TEXT,
  hn_object_id TEXT,
  github_stars INTEGER DEFAULT 0,
  github_repo_name TEXT,
  github_url TEXT,
  github_language TEXT,
  github_created_at TEXT,
  updated_at TEXT
);

-- table: comparison_results
CREATE TABLE comparison_results (
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

-- table: comparisons
CREATE TABLE comparisons (
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

-- table: daily_api_usage
CREATE TABLE daily_api_usage (user_id TEXT NOT NULL, date TEXT NOT NULL, api_calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, date));

-- table: discovered_keywords
CREATE TABLE discovered_keywords (
  id TEXT primary key,
  user_id TEXT not null,
  source_id TEXT not null,
  url TEXT not null,
  keyword TEXT not null,
  keyword_normalized TEXT not null,
  status TEXT not null,
  extracted_at TEXT not null,
  updated_at TEXT not null,
  unique(user_id, keyword_normalized)
);

-- table: filter_cache
CREATE TABLE filter_cache (id TEXT PRIMARY KEY, cache_key TEXT NOT NULL UNIQUE, blocked_keywords TEXT NOT NULL DEFAULT '[]', kept_keywords TEXT NOT NULL DEFAULT '[]', summary TEXT, model TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

-- table: game_keyword_pipeline
CREATE TABLE game_keyword_pipeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL UNIQUE,
  source_site TEXT,
  discovered_at TEXT DEFAULT (datetime('now')),
  trend_ratio REAL,
  trend_slope REAL,
  trend_verdict TEXT,
  trend_checked_at TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
, serp_organic INTEGER DEFAULT 0, serp_auth INTEGER DEFAULT 0, serp_featured INTEGER DEFAULT 0, recommendation TEXT DEFAULT NULL, reason TEXT DEFAULT NULL, trend_series TEXT);

-- table: invite_codes
CREATE TABLE invite_codes (code TEXT PRIMARY KEY, created_by TEXT NOT NULL, used_by TEXT, max_uses INTEGER NOT NULL DEFAULT 1, current_uses INTEGER NOT NULL DEFAULT 0, expires_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));

-- table: keyword_history
CREATE TABLE keyword_history (id TEXT PRIMARY KEY, keyword TEXT NOT NULL, keyword_normalized TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'top', source TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));

-- table: old_keyword_opportunities
CREATE TABLE old_keyword_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  source_seed TEXT NOT NULL,
  volume INTEGER DEFAULT 0,
  cpc REAL DEFAULT 0,
  kd INTEGER DEFAULT 0,
  competition TEXT DEFAULT '',
  intent TEXT DEFAULT '',
  toolable INTEGER DEFAULT 0,
  score REAL DEFAULT 0,
  scan_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')), trend_series TEXT DEFAULT NULL,
  UNIQUE(keyword, scan_date)
);

-- table: password_reset_tokens
CREATE TABLE password_reset_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));

-- table: postback_results
CREATE TABLE postback_results (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, api_type TEXT NOT NULL, cache_key TEXT, result_data TEXT NOT NULL, created_at TEXT NOT NULL);

-- table: query_cache
CREATE TABLE query_cache (id TEXT PRIMARY KEY, user_id TEXT, query_type TEXT, cache_key TEXT, response_data TEXT, created_at TEXT);

-- table: research_jobs
CREATE TABLE research_jobs (
  id TEXT primary key,
  user_id TEXT not null,
  job_type TEXT not null,
  status TEXT not null,
  task_ids TEXT,
  payload TEXT,
  session_id TEXT,
  error TEXT,
  created_at TEXT not null,
  updated_at TEXT not null
);

-- table: research_sessions
CREATE TABLE research_sessions (
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
, trends_summary TEXT);

-- table: schema_migrations
CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- table: serp_confidence_cache
CREATE TABLE serp_confidence_cache (keyword_normalized TEXT NOT NULL, cache_date TEXT NOT NULL, confidence INTEGER NOT NULL, organic_count INTEGER DEFAULT 0, has_featured INTEGER DEFAULT 0, ai_in_titles INTEGER DEFAULT 0, updated_at TEXT, PRIMARY KEY (keyword_normalized, cache_date));

-- table: sitemap_entries
CREATE TABLE sitemap_entries (
  id TEXT primary key,
  user_id TEXT not null,
  source_id TEXT not null,
  url TEXT not null,
  lastmod TEXT,
  first_seen_at TEXT not null,
  last_seen_at TEXT not null,
  unique(user_id, source_id, url)
);

-- table: sitemap_sources
CREATE TABLE sitemap_sources (
  id TEXT primary key,
  user_id TEXT not null,
  name TEXT,
  sitemap_url TEXT not null,
  enabled INTEGER not null,
  rules_json TEXT,
  etag TEXT,
  last_modified TEXT,
  last_checked_at TEXT,
  created_at TEXT not null,
  updated_at TEXT not null, check_interval_minutes INTEGER NOT NULL DEFAULT 60, next_check_at TEXT,
  unique(user_id, sitemap_url)
);
