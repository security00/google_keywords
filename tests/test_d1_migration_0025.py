import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ByokPipelineIntegrationMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        migration = (
            ROOT / "migrations/d1/0025_byok_pipeline_integration.sql"
        ).read_text(encoding="utf-8")
        self.connection.executescript(migration)

    def test_creates_owner_scoped_pipeline_tables_and_indexes(self) -> None:
        tables = {
            row[0]
            for row in self.connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        self.assertTrue(
            {
                "research_preferences",
                "byok_pipeline_quotes",
                "byok_pipeline_runs",
                "byok_pipeline_steps",
            }.issubset(tables)
        )
        indexes = {
            row[1]
            for row in self.connection.execute(
                "SELECT name, name FROM sqlite_master WHERE type = 'index'"
            )
        }
        self.assertIn("idx_byok_pipeline_quotes_owner_created", indexes)
        self.assertIn("idx_byok_pipeline_runs_owner_created", indexes)
        self.assertIn("idx_byok_pipeline_steps_parent_status", indexes)

    def test_schema_contains_no_provider_secret_or_encryption_columns(self) -> None:
        forbidden = {
            "secret", "api_key", "password", "ciphertext", "wrapped_dek", "fingerprint"
        }
        for table in (
            "research_preferences",
            "byok_pipeline_quotes",
            "byok_pipeline_runs",
            "byok_pipeline_steps",
        ):
            columns = {
                row[1].lower()
                for row in self.connection.execute(f"PRAGMA table_info({table})")
            }
            self.assertTrue(columns.isdisjoint(forbidden), (table, columns & forbidden))

    def test_enforces_mode_status_and_owner_idempotency_constraints(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO research_preferences VALUES ('owner-1', 'live', 'now', 'now')"
            )
        quote = (
            "quote-1", "owner-1", "expand", "hash-1", "idem-1", "{}", "[]",
            1000, "quoted", "later", None, None, "now", "now",
        )
        self.connection.execute(
            "INSERT INTO byok_pipeline_quotes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            quote,
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO byok_pipeline_quotes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("quote-2", *quote[1:4], "idem-1", *quote[5:]),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO byok_pipeline_runs
                   VALUES ('job-1', 'owner-1', 'compare', 'quote-1', 'hash',
                           'execute-1', 'execute-hash', 'unknown', 1, 0,
                           NULL, NULL, 'now', 'now')"""
            )


if __name__ == "__main__":
    unittest.main()
