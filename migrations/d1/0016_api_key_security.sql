-- 0016_api_key_security.sql
-- Add explicit API key capabilities and persistent authentication throttling.

ALTER TABLE api_keys
ADD COLUMN scopes TEXT NOT NULL DEFAULT '["cache:read"]';

CREATE TABLE IF NOT EXISTS api_key_auth_failures (
  fingerprint_hash TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_key_auth_failures_updated
  ON api_key_auth_failures(updated_at);
