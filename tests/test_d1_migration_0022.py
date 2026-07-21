import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ByokJobCheckpointMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        self.connection.executescript(
            """CREATE TABLE research_jobs (
                 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, job_type TEXT NOT NULL,
                 status TEXT NOT NULL, execution_mode TEXT NOT NULL DEFAULT 'platform',
                 updated_at TEXT NOT NULL
               );"""
        )
        migration = (
            ROOT / "migrations/d1/0022_byok_job_checkpoints.sql"
        ).read_text(encoding="utf-8")
        self.connection.executescript(migration)

    def test_adds_paid_request_checkpoint_columns_and_index(self) -> None:
        columns = {
            row[1] for row in self.connection.execute("PRAGMA table_info(research_jobs)")
        }
        self.assertTrue(
            {
                "provider_connection_id",
                "provider_connection_version",
                "provider_request_state",
                "result_cache_key",
            }.issubset(columns)
        )
        indexes = {
            row[1] for row in self.connection.execute("PRAGMA index_list(research_jobs)")
        }
        self.assertIn("idx_research_jobs_byok_checkpoint", indexes)

    def test_rejects_invalid_checkpoint_state_and_connection_version(self) -> None:
        self.connection.execute(
            """INSERT INTO research_jobs
               (id, user_id, job_type, status, execution_mode, updated_at)
               VALUES ('job-1', 'owner-1', 'semantic_filter', 'pending', 'byok', 'now')"""
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "UPDATE research_jobs SET provider_request_state = 'retryable' WHERE id = 'job-1'"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "UPDATE research_jobs SET provider_connection_version = 0 WHERE id = 'job-1'"
            )


if __name__ == "__main__":
    unittest.main()
