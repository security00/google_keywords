import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ProviderConnectionsMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.addCleanup(self.connection.close)
        migration = (
            ROOT / "migrations/d1/0020_provider_connections.sql"
        ).read_text(encoding="utf-8")
        self.connection.executescript(migration)

    def insert_connection(
        self,
        connection_id: str = "connection-1",
        owner_id: str = "owner-1",
        provider: str = "openrouter",
    ) -> None:
        self.connection.execute(
            """INSERT INTO provider_connections (
                 connection_id, owner_id, provider, label,
                 credential_ciphertext, credential_iv, wrapped_dek,
                 kek_version, encryption_version, fingerprint_hmac,
                 fingerprint_version, fingerprint_key_version,
                 credential_version, masked_hint, verification_status,
                 created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                connection_id,
                owner_id,
                provider,
                "Primary",
                "ciphertext",
                "iv",
                "wrapped-dek",
                "kek-v1",
                1,
                "fingerprint",
                1,
                "fingerprint-v1",
                1,
                "sk-...1234",
                "unverified",
                "2026-07-21T00:00:00.000Z",
                "2026-07-21T00:00:00.000Z",
            ),
        )

    def test_creates_expected_tables_columns_and_indexes(self) -> None:
        columns = {
            row[1]
            for row in self.connection.execute(
                "PRAGMA table_info(provider_connections)"
            )
        }
        self.assertTrue(
            {
                "fingerprint_version",
                "fingerprint_key_version",
                "credential_version",
                "verification_status",
            }.issubset(columns)
        )

        indexes = {
            row[1]
            for row in self.connection.execute(
                "PRAGMA index_list(provider_connections)"
            )
        }
        self.assertIn("idx_provider_connections_owner_provider", indexes)
        self.assertIn("idx_provider_connections_owner_updated", indexes)

    def test_enforces_one_connection_per_owner_and_provider(self) -> None:
        self.insert_connection()
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_connection(connection_id="connection-2")

        self.insert_connection(connection_id="connection-3", owner_id="owner-2")
        count = self.connection.execute(
            "SELECT COUNT(*) FROM provider_connections"
        ).fetchone()[0]
        self.assertEqual(count, 2)

    def test_rejects_unknown_provider_and_invalid_versions(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert_connection(provider="custom-provider")

        self.insert_connection()
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                """UPDATE provider_connections
                   SET credential_version = 0
                   WHERE connection_id = 'connection-1'"""
            )

    def test_audit_event_survives_live_connection_deletion(self) -> None:
        self.insert_connection()
        self.connection.execute(
            """INSERT INTO provider_connection_audit_events (
                 event_id, connection_id, owner_id, provider,
                 action, outcome, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                "event-1",
                "connection-1",
                "owner-1",
                "openrouter",
                "deleted",
                "success",
                "2026-07-21T00:00:00.000Z",
            ),
        )
        self.connection.execute(
            "DELETE FROM provider_connections WHERE connection_id = ?",
            ("connection-1",),
        )

        event = self.connection.execute(
            """SELECT connection_id, owner_id, action
               FROM provider_connection_audit_events
               WHERE event_id = ?""",
            ("event-1",),
        ).fetchone()
        self.assertEqual(event, ("connection-1", "owner-1", "deleted"))

    def test_rotation_audit_is_written_only_after_version_guard_changes_row(self) -> None:
        self.insert_connection()
        update_sql = """UPDATE provider_connections
                        SET credential_version = ?, updated_at = ?
                        WHERE owner_id = ? AND connection_id = ?
                          AND credential_version = ?"""
        audit_sql = """INSERT INTO provider_connection_audit_events (
                         event_id, connection_id, owner_id, provider,
                         action, outcome, error_code, created_at
                       )
                       SELECT ?, ?, ?, ?, 'credential_rotated', 'success', NULL, ?
                       WHERE changes() = 1"""

        with self.connection:
            self.connection.execute(
                update_sql,
                (
                    2,
                    "2026-07-21T01:00:00.000Z",
                    "owner-1",
                    "connection-1",
                    1,
                ),
            )
            self.connection.execute(
                audit_sql,
                (
                    "event-success",
                    "connection-1",
                    "owner-1",
                    "openrouter",
                    "2026-07-21T01:00:00.000Z",
                ),
            )

        with self.connection:
            self.connection.execute(
                update_sql,
                (
                    2,
                    "2026-07-21T02:00:00.000Z",
                    "owner-1",
                    "connection-1",
                    1,
                ),
            )
            self.connection.execute(
                audit_sql,
                (
                    "event-stale",
                    "connection-1",
                    "owner-1",
                    "openrouter",
                    "2026-07-21T02:00:00.000Z",
                ),
            )

        events = self.connection.execute(
            "SELECT event_id FROM provider_connection_audit_events ORDER BY event_id"
        ).fetchall()
        self.assertEqual(events, [("event-success",)])


if __name__ == "__main__":
    unittest.main()
