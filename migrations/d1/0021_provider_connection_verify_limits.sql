-- 0021_provider_connection_verify_limits.sql
-- Persist owner/provider verification throttles across Worker isolates.

CREATE TABLE IF NOT EXISTS provider_connection_verify_limits (
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, provider),
  CHECK (provider IN ('openrouter', 'dataforseo', 'openai', 'deepseek', 'gemini')),
  CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_provider_connection_verify_limits_updated
  ON provider_connection_verify_limits(updated_at);
