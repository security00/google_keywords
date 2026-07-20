-- 0018_cache_namespaces.sql
-- Add versioned cache identities and split Research Job request mappings.

ALTER TABLE query_cache
ADD COLUMN namespace TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE query_cache
ADD COLUMN cache_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE query_cache
ADD COLUMN cache_scope TEXT NOT NULL DEFAULT 'shared';

ALTER TABLE query_cache
ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';

ALTER TABLE query_cache
ADD COLUMN key_hash TEXT;

ALTER TABLE query_cache
ADD COLUMN content_type TEXT NOT NULL DEFAULT 'result';

ALTER TABLE query_cache
ADD COLUMN expires_at TEXT;

ALTER TABLE query_cache
ADD COLUMN updated_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_query_cache_identity_v2
  ON query_cache(namespace, cache_version, cache_scope, owner_id, key_hash)
  WHERE key_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_query_cache_expiry_v2
  ON query_cache(cache_scope, namespace, expires_at);

CREATE TABLE IF NOT EXISTS research_job_requests (
  request_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  job_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_job_requests_owner
  ON research_job_requests(user_id, job_type, expires_at);
