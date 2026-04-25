-- 0001_schema_migrations_baseline.sql
-- Establish migration tracking without changing existing business tables.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
