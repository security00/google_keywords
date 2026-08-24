import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class EmailEventsTrialActivatedMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        for name in (
            "0028_email_events.sql",
            "0031_email_events_trial_activated.sql",
        ):
            sql = (ROOT / "migrations/d1" / name).read_text(encoding="utf-8")
            self.connection.executescript(sql)

    def test_keeps_existing_welcome_rows(self):
        self.connection.execute(
            """INSERT INTO email_events (user_id, event_type, period_key, email, sent_at)
               VALUES (?, ?, ?, ?, ?)""",
            ("user-1", "welcome", "signup", "a@example.com", "2026-08-01T00:00:00Z"),
        )
        row = self.connection.execute(
            "SELECT event_type FROM email_events WHERE user_id = ?",
            ("user-1",),
        ).fetchone()
        self.assertEqual(row[0], "welcome")

    def test_accepts_trial_activated_events(self):
        self.connection.execute(
            """INSERT INTO email_events (user_id, event_type, period_key, email, sent_at)
               VALUES (?, ?, ?, ?, ?)""",
            ("user-2", "trial_activated", "activation", "b@example.com", "2026-08-24T00:00:00Z"),
        )
        count = self.connection.execute(
            "SELECT COUNT(*) FROM email_events WHERE event_type = 'trial_activated'"
        ).fetchone()[0]
        self.assertEqual(count, 1)
