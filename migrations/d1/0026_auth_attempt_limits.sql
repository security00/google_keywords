-- 0026_auth_attempt_limits.sql
-- Persist sign-in / sign-up / password-reset throttles across Worker isolates.
-- Keys are hashed; this table must not store raw IPs or emails.

CREATE TABLE IF NOT EXISTS auth_attempt_limits (
  scope TEXT NOT NULL,
  dimension TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, dimension, key_hash),
  CHECK (scope IN ('sign_in', 'sign_up', 'forgot_password', 'reset_password')),
  CHECK (dimension IN ('ip', 'email')),
  CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_auth_attempt_limits_updated
  ON auth_attempt_limits(updated_at);
