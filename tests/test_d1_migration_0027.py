import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StripeWebhookEventMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        migration = (
            ROOT / "migrations/d1/0027_stripe_webhook_events.sql"
        ).read_text(encoding="utf-8")
        self.connection.executescript(migration)

    def test_creates_event_id_primary_key_and_status_index(self) -> None:
        self.connection.execute(
            """INSERT INTO stripe_webhook_events (
                 event_id, event_type, status, received_at
               ) VALUES (?, ?, ?, ?)""",
            ("evt_1", "invoice.paid", "processed", "2026-08-17T00:00:00Z"),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO stripe_webhook_events (
                     event_id, event_type, status, received_at
                   ) VALUES (?, ?, ?, ?)""",
                ("evt_1", "invoice.paid", "processing", "2026-08-17T00:01:00Z"),
            )

        indexes = {
            row[1]
            for row in self.connection.execute(
                "PRAGMA index_list(stripe_webhook_events)"
            )
        }
        self.assertIn("idx_stripe_webhook_events_status_received", indexes)

    def test_rejects_unknown_status(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO stripe_webhook_events (
                     event_id, event_type, status, received_at
                   ) VALUES (?, ?, ?, ?)""",
                ("evt_2", "invoice.paid", "skipped", "2026-08-17T00:00:00Z"),
            )


if __name__ == "__main__":
    unittest.main()
