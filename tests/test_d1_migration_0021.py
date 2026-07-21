import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ProviderConnectionVerifyLimitMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        migration = (
            ROOT / "migrations/d1/0021_provider_connection_verify_limits.sql"
        ).read_text(encoding="utf-8")
        self.connection.executescript(migration)

    def test_creates_owner_provider_primary_key_and_updated_index(self) -> None:
        self.connection.execute(
            """INSERT INTO provider_connection_verify_limits (
                 owner_id, provider, window_started_at, attempt_count, updated_at
               ) VALUES (?, ?, ?, ?, ?)""",
            ("owner-1", "openrouter", "2026-07-21T00:00:00Z", 1, "2026-07-21T00:00:00Z"),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO provider_connection_verify_limits (
                     owner_id, provider, window_started_at, attempt_count, updated_at
                   ) VALUES (?, ?, ?, ?, ?)""",
                ("owner-1", "openrouter", "2026-07-21T00:00:00Z", 1, "2026-07-21T00:00:00Z"),
            )

        indexes = {
            row[1]
            for row in self.connection.execute(
                "PRAGMA index_list(provider_connection_verify_limits)"
            )
        }
        self.assertIn("idx_provider_connection_verify_limits_updated", indexes)

    def test_rejects_unknown_providers_and_negative_attempts(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO provider_connection_verify_limits (
                     owner_id, provider, window_started_at, attempt_count, updated_at
                   ) VALUES (?, ?, ?, ?, ?)""",
                ("owner-1", "custom", "2026-07-21T00:00:00Z", 1, "2026-07-21T00:00:00Z"),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO provider_connection_verify_limits (
                     owner_id, provider, window_started_at, attempt_count, updated_at
                   ) VALUES (?, ?, ?, ?, ?)""",
                ("owner-1", "openrouter", "2026-07-21T00:00:00Z", -1, "2026-07-21T00:00:00Z"),
            )


if __name__ == "__main__":
    unittest.main()
