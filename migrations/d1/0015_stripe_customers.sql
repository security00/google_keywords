CREATE TABLE IF NOT EXISTS stripe_customers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES auth_users_v2(id)
);

CREATE INDEX IF NOT EXISTS idx_stripe_customers_customer
  ON stripe_customers(stripe_customer_id);
