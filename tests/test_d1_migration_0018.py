import re
import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class CacheNamespaceMigrationTest(unittest.TestCase):
    def test_applies_to_production_query_cache_shape(self) -> None:
        baseline = (
            ROOT / "migrations/baseline/0000_current_production_schema.sql"
        ).read_text(encoding="utf-8")
        migration = (ROOT / "migrations/d1/0018_cache_namespaces.sql").read_text(
            encoding="utf-8"
        )
        query_cache_sql = re.search(
            r"CREATE TABLE query_cache \(.*?\);", baseline, re.DOTALL
        )
        self.assertIsNotNone(query_cache_sql)

        connection = sqlite3.connect(":memory:")
        self.addCleanup(connection.close)
        connection.execute(query_cache_sql.group(0))
        connection.executescript(migration)

        connection.execute(
            """INSERT INTO query_cache
               (id, cache_key, response_data, created_at)
               VALUES (?, ?, ?, ?)""",
            ("legacy-1", "legacy-key", "{}", "2026-07-20T00:00:00Z"),
        )
        legacy = connection.execute(
            """SELECT namespace, cache_version, cache_scope, owner_id,
                      content_type
               FROM query_cache WHERE id = ?""",
            ("legacy-1",),
        ).fetchone()
        self.assertEqual(legacy, ("legacy", 1, "shared", "", "result"))

        connection.execute(
            """INSERT INTO research_job_requests
               (request_key, user_id, job_type, job_id, created_at, expires_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                "request-hash",
                "user-1",
                "expand",
                "job-1",
                "2026-07-20T00:00:00Z",
                "2026-07-21T00:00:00Z",
            ),
        )
        mapped = connection.execute(
            "SELECT job_id FROM research_job_requests WHERE request_key = ?",
            ("request-hash",),
        ).fetchone()[0]
        self.assertEqual(mapped, "job-1")


if __name__ == "__main__":
    unittest.main()
