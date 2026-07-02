CREATE TABLE IF NOT EXISTS saas_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  plan_key TEXT NOT NULL DEFAULT 'founding',
  status TEXT NOT NULL,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES auth_users_v2(id)
);

CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_user_status
  ON saas_subscriptions(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_customer
  ON saas_subscriptions(stripe_customer_id);

CREATE TABLE IF NOT EXISTS saas_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  status TEXT NOT NULL,
  starts_at TEXT,
  expires_at TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES auth_users_v2(id)
);

CREATE INDEX IF NOT EXISTS idx_saas_entitlements_user_status
  ON saas_entitlements(user_id, status, expires_at DESC);

CREATE TABLE IF NOT EXISTS saas_usage_counters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  counter_key TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  limit_value INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, counter_key, period_start),
  FOREIGN KEY (user_id) REFERENCES auth_users_v2(id)
);

CREATE INDEX IF NOT EXISTS idx_saas_usage_counters_user_period
  ON saas_usage_counters(user_id, period_end DESC);
