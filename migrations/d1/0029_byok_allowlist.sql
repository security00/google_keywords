-- Admin-managed BYOK tester allowlist. Environment allowlist remains a
-- bootstrap pin and is unioned at read time.

CREATE TABLE IF NOT EXISTS byok_allowlist (
  owner_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_byok_allowlist_email
  ON byok_allowlist(email);

CREATE TABLE IF NOT EXISTS byok_allowlist_audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  email TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_byok_allowlist_audit_owner_created
  ON byok_allowlist_audit_events(owner_id, created_at DESC);
