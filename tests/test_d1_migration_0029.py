import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ByokAllowlistMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        spend_controls = (ROOT / "migrations/d1/0023_byok_spend_controls.sql").read_text(
            encoding="utf-8"
        )
        allowlist = (ROOT / "migrations/d1/0029_byok_allowlist.sql").read_text(
            encoding="utf-8"
        )
        self.connection.executescript(spend_controls)
        self.connection.executescript(allowlist)

    def test_rejects_duplicate_owner(self) -> None:
        self.connection.execute(
            """INSERT INTO byok_allowlist (owner_id, email, created_by, created_at)
               VALUES (?, ?, ?, ?)""",
            ("owner-1", "a@example.com", "admin-1", "2026-08-23T00:00:00Z"),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO byok_allowlist (owner_id, email, created_by, created_at)
                   VALUES (?, ?, ?, ?)""",
                ("owner-1", "b@example.com", "admin-1", "2026-08-23T00:00:01Z"),
            )

    def test_grant_sql_is_additive_and_does_not_overwrite_spend_controls(self) -> None:
        self.connection.execute(
            """INSERT INTO byok_spend_controls (
                 owner_id, daily_budget_micro_usd, max_concurrent_jobs, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?)""",
            ("owner-1", 1_000_000, 2, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z"),
        )
        self.connection.execute(
            """INSERT INTO byok_allowlist (owner_id, email, created_by, created_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(owner_id) DO UPDATE SET email = excluded.email""",
            ("owner-1", "a@example.com", "admin-1", "2026-08-23T00:00:00Z"),
        )
        self.connection.execute(
            """INSERT INTO byok_spend_controls (
                 owner_id, daily_budget_micro_usd, max_concurrent_jobs, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(owner_id) DO NOTHING""",
            ("owner-1", 50_000, 1, "2026-08-23T00:00:00Z", "2026-08-23T00:00:00Z"),
        )
        row = self.connection.execute(
            "SELECT daily_budget_micro_usd, max_concurrent_jobs FROM byok_spend_controls WHERE owner_id = ?",
            ("owner-1",),
        ).fetchone()
        self.assertEqual(row, (1_000_000, 2))

    def test_rejects_unknown_audit_action(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """INSERT INTO byok_allowlist_audit_events (
                     id, actor_id, owner_id, action, email, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    "evt-1",
                    "admin-1",
                    "owner-1",
                    "promote",
                    "a@example.com",
                    "2026-08-23T00:00:00Z",
                ),
            )


if __name__ == "__main__":
    unittest.main()
