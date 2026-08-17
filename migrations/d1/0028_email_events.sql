-- 0028_email_events.sql
-- Dedupe lifecycle mail so the same reminder is not sent twice.

CREATE TABLE IF NOT EXISTS email_events (
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  email TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, event_type, period_key),
  CHECK (
    event_type IN (
      'welcome',
      'trial_expiring_7d',
      'trial_expiring_1d',
      'trial_expired',
      'payment_succeeded'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_email_events_type_sent
  ON email_events(event_type, sent_at);
