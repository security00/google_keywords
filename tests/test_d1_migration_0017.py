import re
import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ResearchJobExecutionMigrationTest(unittest.TestCase):
    def test_applies_to_production_research_jobs_shape(self) -> None:
        baseline = (
            ROOT / "migrations/baseline/0000_current_production_schema.sql"
        ).read_text(encoding="utf-8")
        migration = (
            ROOT / "migrations/d1/0017_research_job_execution.sql"
        ).read_text(encoding="utf-8")
        research_jobs_sql = re.search(
            r"CREATE TABLE research_jobs \(.*?\);", baseline, re.DOTALL
        )
        self.assertIsNotNone(research_jobs_sql)

        connection = sqlite3.connect(":memory:")
        self.addCleanup(connection.close)
        connection.execute(research_jobs_sql.group(0))
        connection.executescript(migration)

        connection.execute(
            """INSERT INTO research_jobs
               (id, user_id, job_type, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                "job-1",
                "user-1",
                "expand",
                "pending",
                "2026-07-20T00:00:00Z",
                "2026-07-20T00:00:00Z",
            ),
        )
        row = connection.execute(
            """SELECT execution_mode, credential_source, attempt_count
               FROM research_jobs WHERE id = ?""",
            ("job-1",),
        ).fetchone()
        self.assertEqual(row, ("platform", "platform", 0))

        connection.execute(
            "UPDATE research_jobs SET idempotency_key = ? WHERE id = ?",
            ("same-request", "job-1"),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            connection.execute(
                """INSERT INTO research_jobs
                   (id, user_id, job_type, status, idempotency_key, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    "job-2",
                    "user-1",
                    "expand",
                    "pending",
                    "same-request",
                    "2026-07-20T00:00:00Z",
                    "2026-07-20T00:00:00Z",
                ),
            )


if __name__ == "__main__":
    unittest.main()
