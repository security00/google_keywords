-- Game Page Radar: curated game-site new page tracking.
-- This is a clean replacement path for high-quality game page discovery.
-- It intentionally does not reuse deprecated sitemap_sources/discovered_keywords
-- as a production recommendation source.

CREATE TABLE IF NOT EXISTS game_radar_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  sitemap_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  quality_tier INTEGER NOT NULL DEFAULT 1,
  url_include_patterns TEXT,
  url_exclude_patterns TEXT,
  keyword_extract_rule TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_radar_pages (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL UNIQUE,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  title TEXT,
  h1 TEXT,
  slug_keyword TEXT,
  extracted_keyword TEXT,
  page_type TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES game_radar_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_game_radar_pages_source_seen
  ON game_radar_pages(source_id, first_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_radar_pages_status
  ON game_radar_pages(status, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS game_radar_candidates (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  keyword_normalized TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  h1 TEXT,
  extraction_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (page_id) REFERENCES game_radar_pages(id),
  FOREIGN KEY (source_id) REFERENCES game_radar_sources(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_radar_candidates_source_keyword
  ON game_radar_candidates(source_id, keyword_normalized);

CREATE INDEX IF NOT EXISTS idx_game_radar_candidates_status
  ON game_radar_candidates(status, created_at DESC);

CREATE TABLE IF NOT EXISTS game_radar_feedback (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('worth', 'not_worth', 'wrong_keyword', 'not_game', 'duplicate')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (candidate_id) REFERENCES game_radar_candidates(id)
);

CREATE INDEX IF NOT EXISTS idx_game_radar_feedback_candidate
  ON game_radar_feedback(candidate_id, created_at DESC);

INSERT OR IGNORE INTO game_radar_sources
  (id, name, base_url, sitemap_url, enabled, quality_tier, url_include_patterns, url_exclude_patterns, keyword_extract_rule)
VALUES
  (
    'poki',
    'Poki',
    'https://poki.com',
    'https://poki.com/sitemap.xml',
    1,
    1,
    '["/en/g/"]',
    '["/category/", "/tags/", "/privacy", "/terms", "/about"]',
    '{"type":"slug","stripPrefix":"/en/g/"}'
  ),
  (
    'crazygames',
    'CrazyGames',
    'https://www.crazygames.com',
    'https://www.crazygames.com/sitemap.xml',
    1,
    1,
    '["/game/"]',
    '["/tags/", "/c/", "/t/", "/privacy", "/terms"]',
    '{"type":"slug","stripPrefix":"/game/"}'
  ),
  (
    'addictinggames',
    'Addicting Games',
    'https://www.addictinggames.com',
    'https://www.addictinggames.com/sitemap.xml',
    1,
    2,
    '["/", "/game/"]',
    '["/category/", "/tag/", "/about", "/privacy", "/terms", "/contact"]',
    '{"type":"slug"}'
  );
