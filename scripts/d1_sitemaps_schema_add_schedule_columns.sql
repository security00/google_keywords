ALTER TABLE sitemap_sources ADD COLUMN check_interval_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE sitemap_sources ADD COLUMN next_check_at TEXT;
CREATE INDEX IF NOT EXISTS idx_sitemap_sources_next_check ON sitemap_sources (user_id, enabled, next_check_at);
