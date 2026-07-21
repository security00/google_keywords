import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ByokReconciliationAuditMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        migration = (
            ROOT / "migrations/d1/0024_byok_reconciliation_audit.sql"
        ).read_text(encoding="utf-8")
        self.connection.executescript(migration)

    def insert_event(self, event_id: str, action: str, status: str) -> None:
        self.connection.execute(
            """INSERT INTO byok_reconciliation_audit_events
               (id, actor_id, owner_id, research_job_id, action,
                previous_updated_at, resulting_status, created_at)
               VALUES (?, 'admin-1', 'owner-1', 'job-1', ?, 'before', ?, 'now')""",
            (event_id, action, status),
        )

    def test_creates_credential_free_columns_and_indexes(self) -> None:
        columns = {
            row[1]
            for row in self.connection.execute(
                "PRAGMA table_info(byok_reconciliation_audit_events)"
            )
        }
        self.assertEqual(
            columns,
            {
                "id", "actor_id", "owner_id", "research_job_id", "action",
                "previous_updated_at", "resulting_status", "created_at",
            },
        )
        indexes = {
            row[1]
            for row in self.connection.execute(
                "PRAGMA index_list(byok_reconciliation_audit_events)"
            )
        }
        self.assertIn("idx_byok_reconciliation_audit_job_created", indexes)
        self.assertIn("idx_byok_reconciliation_audit_actor_created", indexes)

    def test_accepts_only_supported_action_and_result_pairs(self) -> None:
        self.insert_event("event-1", "mark_uncertain", "failed")
        self.insert_event("event-2", "complete_from_private_cache", "complete")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_event("event-3", "retry_provider", "failed")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_event("event-4", "mark_uncertain", "processing")

    def test_changes_guard_writes_no_audit_after_stale_update_loses_race(self) -> None:
        self.connection.execute(
            "CREATE TABLE research_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL)"
        )
        self.connection.execute(
            "INSERT INTO research_jobs VALUES ('job-1', 'processing')"
        )
        update_sql = "UPDATE research_jobs SET status = 'failed' WHERE id = ? AND status = ?"
        audit_sql = """INSERT INTO byok_reconciliation_audit_events
                         (id, actor_id, owner_id, research_job_id, action,
                          previous_updated_at, resulting_status, created_at)
                       SELECT ?, 'admin-1', 'owner-1', 'job-1',
                              'mark_uncertain', 'before', 'failed', 'now'
                       WHERE changes() = 1"""
        self.connection.execute(update_sql, ("job-1", "processing"))
        self.connection.execute(audit_sql, ("event-success",))
        self.connection.execute(update_sql, ("job-1", "processing"))
        self.connection.execute(audit_sql, ("event-raced",))
        events = self.connection.execute(
            "SELECT id FROM byok_reconciliation_audit_events ORDER BY id"
        ).fetchall()
        self.assertEqual(events, [("event-success",)])


if __name__ == "__main__":
    unittest.main()
