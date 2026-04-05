create table if not exists sitemap_sources (
  id TEXT primary key,
  user_id TEXT not null,
  name TEXT,
  sitemap_url TEXT not null,
  enabled INTEGER not null,
  rules_json TEXT,
  etag TEXT,
  last_modified TEXT,
  last_checked_at TEXT,
  check_interval_minutes INTEGER NOT NULL DEFAULT 60,
  next_check_at TEXT,
  created_at TEXT not null,
  updated_at TEXT not null,
  unique(user_id, sitemap_url)
);

create index if not exists idx_sitemap_sources_user_enabled on sitemap_sources (user_id, enabled, created_at desc);
create index if not exists idx_sitemap_sources_next_check on sitemap_sources (user_id, enabled, next_check_at);

create table if not exists sitemap_entries (
  id TEXT primary key,
  user_id TEXT not null,
  source_id TEXT not null,
  url TEXT not null,
  lastmod TEXT,
  first_seen_at TEXT not null,
  last_seen_at TEXT not null,
  unique(user_id, source_id, url)
);

create index if not exists idx_sitemap_entries_source_seen on sitemap_entries (source_id, last_seen_at desc);

create table if not exists discovered_keywords (
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

create index if not exists idx_discovered_keywords_status on discovered_keywords (user_id, status, extracted_at desc);
create index if not exists idx_discovered_keywords_source on discovered_keywords (user_id, source_id, extracted_at desc);

PRAGMA optimize;
