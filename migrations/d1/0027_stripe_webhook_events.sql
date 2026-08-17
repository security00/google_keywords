-- 0027_stripe_webhook_events.sql
-- Persist Stripe event.id claims so webhook replays cannot apply twice.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  CHECK (status IN ('processing', 'processed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status_received
  ON stripe_webhook_events(status, received_at);
