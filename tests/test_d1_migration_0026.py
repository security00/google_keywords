import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class AuthAttemptLimitMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        migration = (
            ROOT / "migrations/d1/0026_auth_attempt_limits.sql"
        ).read_text(encoding="utf-8")
        self.connection.executescript(migration)

    def test_creates_scope_dimension_primary_key_and_updated_index(self) -> None:
        self.connection.execute(
            """INSERT INTO auth_attempt_limits (
                 scope, dimension, key_hash, window_started_at, attempt_count, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?)""",
            ("sign_in", "ip", "hash-1", "2026-08-17T00:00:00Z", 1, "2026-08-17T00:00:00Z"),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO auth_attempt_limits (
                     scope, dimension, key_hash, window_started_at, attempt_count, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?)""",
                ("sign_in", "ip", "hash-1", "2026-08-17T00:00:00Z", 1, "2026-08-17T00:00:00Z"),
            )

        indexes = {
            row[1]
            for row in self.connection.execute(
                "PRAGMA index_list(auth_attempt_limits)"
            )
        }
        self.assertIn("idx_auth_attempt_limits_updated", indexes)

    def test_rejects_unknown_scope_dimension_and_negative_attempts(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO auth_attempt_limits (
                     scope, dimension, key_hash, window_started_at, attempt_count, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?)""",
                ("checkout", "ip", "hash-1", "2026-08-17T00:00:00Z", 1, "2026-08-17T00:00:00Z"),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO auth_attempt_limits (
                     scope, dimension, key_hash, window_started_at, attempt_count, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?)""",
                ("sign_in", "ua", "hash-1", "2026-08-17T00:00:00Z", 1, "2026-08-17T00:00:00Z"),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO auth_attempt_limits (
                     scope, dimension, key_hash, window_started_at, attempt_count, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?)""",
                ("sign_in", "ip", "hash-1", "2026-08-17T00:00:00Z", -1, "2026-08-17T00:00:00Z"),
            )

    def test_schema_does_not_store_raw_identity_columns(self) -> None:
        columns = {
            row[1].lower()
            for row in self.connection.execute("PRAGMA table_info(auth_attempt_limits)")
        }
        self.assertTrue(columns.isdisjoint({"ip", "email", "user_id"}))


if __name__ == "__main__":
    unittest.main()
