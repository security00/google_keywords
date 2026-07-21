-- 0020_provider_connections.sql
-- Add encrypted, owner-scoped BYOK Provider Connections. This migration does
-- not enable credential management or Provider execution.

CREATE TABLE IF NOT EXISTS provider_connections (
  connection_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  credential_ciphertext TEXT NOT NULL,
  credential_iv TEXT NOT NULL,
  wrapped_dek TEXT NOT NULL,
  kek_version TEXT NOT NULL,
  encryption_version INTEGER NOT NULL,
  fingerprint_hmac TEXT NOT NULL,
  fingerprint_version INTEGER NOT NULL,
  fingerprint_key_version TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1,
  masked_hint TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  verified_at TEXT,
  last_verification_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (provider IN ('openrouter', 'dataforseo', 'openai', 'deepseek', 'gemini')),
  CHECK (length(label) <= 120),
  CHECK (length(masked_hint) BETWEEN 1 AND 120),
  CHECK (length(kek_version) BETWEEN 1 AND 64),
  CHECK (length(fingerprint_key_version) BETWEEN 1 AND 64),
  CHECK (encryption_version >= 1),
  CHECK (fingerprint_version >= 1),
  CHECK (credential_version >= 1),
  CHECK (verification_status IN ('unverified', 'valid', 'invalid', 'error')),
  CHECK (last_verification_code IS NULL OR length(last_verification_code) <= 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_connections_owner_provider
  ON provider_connections(owner_id, provider);

CREATE INDEX IF NOT EXISTS idx_provider_connections_owner_updated
  ON provider_connections(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS provider_connection_audit_events (
  event_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL,
  CHECK (provider IN ('openrouter', 'dataforseo', 'openai', 'deepseek', 'gemini')),
  CHECK (action IN (
    'created',
    'credential_rotated',
    'kek_rewrapped',
    'deleted',
    'verification_succeeded',
    'verification_failed'
  )),
  CHECK (outcome IN ('success', 'failure')),
  CHECK (error_code IS NULL OR length(error_code) <= 64)
);

CREATE INDEX IF NOT EXISTS idx_provider_connection_audit_owner_created
  ON provider_connection_audit_events(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_connection_audit_connection_created
  ON provider_connection_audit_events(connection_id, created_at DESC);
