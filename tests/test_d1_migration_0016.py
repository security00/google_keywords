import re
import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ApiKeySecurityMigrationTest(unittest.TestCase):
    def test_applies_to_production_api_keys_shape(self) -> None:
        baseline = (
            ROOT / "migrations/baseline/0000_current_production_schema.sql"
        ).read_text(encoding="utf-8")
        migration = (ROOT / "migrations/d1/0016_api_key_security.sql").read_text(
            encoding="utf-8"
        )
        api_keys_sql = re.search(
            r"CREATE TABLE api_keys \(.*?\);", baseline, re.DOTALL
        )
        self.assertIsNotNone(api_keys_sql)

        connection = sqlite3.connect(":memory:")
        self.addCleanup(connection.close)
        connection.execute(api_keys_sql.group(0))
        connection.executescript(migration)

        columns = {
            row[1]: row for row in connection.execute("PRAGMA table_info(api_keys)")
        }
        self.assertEqual(columns["scopes"][3], 1)

        connection.execute(
            "INSERT INTO api_keys (key, user_id) VALUES (?, ?)",
            ("legacy-key", "user-1"),
        )
        scopes = connection.execute(
            "SELECT scopes FROM api_keys WHERE user_id = ?", ("user-1",)
        ).fetchone()[0]
        self.assertEqual(scopes, '["cache:read"]')

        objects = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE name LIKE 'api_key_auth_failures%' "
                "OR name = 'idx_api_key_auth_failures_updated'"
            )
        }
        self.assertIn("api_key_auth_failures", objects)
        self.assertIn("idx_api_key_auth_failures_updated", objects)


if __name__ == "__main__":
    unittest.main()
