CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  provider_email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_subject),
  FOREIGN KEY (user_id) REFERENCES auth_users_v2(id)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user
  ON auth_identities(user_id);

CREATE INDEX IF NOT EXISTS idx_auth_identities_provider_email
  ON auth_identities(provider, provider_email);
