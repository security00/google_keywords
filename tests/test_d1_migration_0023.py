import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ByokSpendControlsMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        migration = (
            ROOT / "migrations/d1/0023_byok_spend_controls.sql"
        ).read_text(encoding="utf-8")
        self.connection.executescript(migration)

    def test_creates_quote_tables_and_operational_indexes(self) -> None:
        tables = {
            row[0]
            for row in self.connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        self.assertTrue({"byok_spend_controls", "byok_cost_quotes"}.issubset(tables))
        indexes = {
            row[1] for row in self.connection.execute("PRAGMA index_list(byok_cost_quotes)")
        }
        self.assertIn("idx_byok_cost_quotes_owner_status", indexes)
        self.assertIn("idx_byok_cost_quotes_reservation_expiry", indexes)

    def test_rejects_invalid_budget_concurrency_capability_and_status(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO byok_spend_controls VALUES (?, ?, ?, ?, ?)",
                ("owner-1", 0, 1, "now", "now"),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO byok_spend_controls VALUES (?, ?, ?, ?, ?)",
                ("owner-1", 1000, 11, "now", "now"),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO byok_cost_quotes
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)""",
                ("q-1", "owner-1", "custom", "hash", "idem", 1, "quoted", "later", "now", "now"),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO byok_cost_quotes
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)""",
                ("q-2", "owner-1", "trends", "hash", "idem-2", 1, "running", "later", "now", "now"),
            )

    def test_enforces_owner_idempotency_uniqueness(self) -> None:
        values = ("q-1", "owner-1", "trends", "hash", "idem", 11000, "quoted", "later", "now", "now")
        self.connection.execute(
            """INSERT INTO byok_cost_quotes
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)""",
            values,
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO byok_cost_quotes
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)""",
                ("q-2", *values[1:]),
            )


if __name__ == "__main__":
    unittest.main()
