-- One complete, cron-owned shared publication per business day.
CREATE TABLE shared_keyword_publications (
  batch_date TEXT PRIMARY KEY,
  data_date TEXT NOT NULL,
  run_id TEXT NOT NULL,
  benchmark TEXT NOT NULL,
  items_json TEXT NOT NULL CHECK(json_valid(items_json)),
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE old_keyword_opportunities ADD COLUMN monthly_searches_json TEXT;
