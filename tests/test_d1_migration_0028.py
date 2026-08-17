import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class EmailEventsMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        migration = (ROOT / "migrations/d1/0028_email_events.sql").read_text(
            encoding="utf-8"
        )
        self.connection.executescript(migration)

    def test_rejects_duplicate_user_event_period(self) -> None:
        self.connection.execute(
            """INSERT INTO email_events (
                 user_id, event_type, period_key, email, sent_at
               ) VALUES (?, ?, ?, ?, ?)""",
            ("user-1", "trial_expiring_7d", "2026-08-25", "a@example.com", "2026-08-18T00:00:00Z"),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO email_events (
                     user_id, event_type, period_key, email, sent_at
                   ) VALUES (?, ?, ?, ?, ?)""",
                ("user-1", "trial_expiring_7d", "2026-08-25", "a@example.com", "2026-08-18T01:00:00Z"),
            )

    def test_rejects_unknown_event_type(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO email_events (
                     user_id, event_type, period_key, email, sent_at
                   ) VALUES (?, ?, ?, ?, ?)""",
                ("user-1", "promo", "signup", "a@example.com", "2026-08-18T00:00:00Z"),
            )


if __name__ == "__main__":
    unittest.main()
