-- Allow account-activation notices in email_events.
-- SQLite cannot add a value to an existing CHECK, so rebuild the table.

CREATE TABLE email_events_0031 (
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  email TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, event_type, period_key),
  CHECK (
    event_type IN (
      'welcome',
      'trial_activated',
      'trial_expiring_7d',
      'trial_expiring_1d',
      'trial_expired',
      'payment_succeeded'
    )
  )
);

INSERT INTO email_events_0031 (user_id, event_type, period_key, email, sent_at)
SELECT user_id, event_type, period_key, email, sent_at
FROM email_events;

DROP TABLE email_events;

ALTER TABLE email_events_0031 RENAME TO email_events;

CREATE INDEX IF NOT EXISTS idx_email_events_type_sent
  ON email_events(event_type, sent_at);
