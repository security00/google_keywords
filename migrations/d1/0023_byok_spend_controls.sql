-- Owner-configurable BYOK guardrails and explicit cost quotes.
-- Monetary values use integer micro-USD to avoid floating-point comparisons.

CREATE TABLE IF NOT EXISTS byok_spend_controls (
  owner_id TEXT PRIMARY KEY,
  daily_budget_micro_usd INTEGER NOT NULL
    CHECK (daily_budget_micro_usd BETWEEN 1 AND 100000000),
  max_concurrent_jobs INTEGER NOT NULL
    CHECK (max_concurrent_jobs BETWEEN 1 AND 10),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS byok_cost_quotes (
  quote_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  capability TEXT NOT NULL
    CHECK (capability IN ('trends', 'serp', 'expand', 'compare')),
  request_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  estimated_cost_micro_usd INTEGER NOT NULL
    CHECK (estimated_cost_micro_usd > 0),
  status TEXT NOT NULL DEFAULT 'quoted'
    CHECK (status IN ('quoted', 'reserved', 'committed', 'released')),
  expires_at TEXT NOT NULL,
  reservation_expires_at TEXT,
  research_job_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_byok_cost_quotes_owner_status
  ON byok_cost_quotes(owner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_byok_cost_quotes_reservation_expiry
  ON byok_cost_quotes(status, reservation_expires_at);
