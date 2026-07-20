import re
import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PipelineCostAttributionMigrationTest(unittest.TestCase):
    def test_applies_to_production_pipeline_cost_shape(self) -> None:
        baseline = (
            ROOT / "migrations/baseline/0000_current_production_schema.sql"
        ).read_text(encoding="utf-8")
        migration = (
            ROOT / "migrations/d1/0019_pipeline_cost_attribution.sql"
        ).read_text(encoding="utf-8")
        table_sql = re.search(
            r"CREATE TABLE pipeline_cost_events \(.*?\);", baseline, re.DOTALL
        )
        self.assertIsNotNone(table_sql)

        connection = sqlite3.connect(":memory:")
        self.addCleanup(connection.close)
        connection.execute(table_sql.group(0))
        connection.executescript(migration)

        connection.execute(
            """INSERT INTO pipeline_cost_events
               (run_id, pipeline, provider, endpoint, unit_type, unit_count)
               VALUES (?, ?, ?, ?, ?, ?)""",
            ("run-1", "test", "dataforseo", "trends", "task", 1),
        )
        row = connection.execute(
            """SELECT credential_source, execution_mode, owner_id
               FROM pipeline_cost_events"""
        ).fetchone()
        self.assertEqual(row, ("platform", "platform", None))


if __name__ == "__main__":
    unittest.main()
