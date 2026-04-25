-- 0002_api_key_display_columns.sql
-- Add display-only API key metadata so UI no longer depends on plaintext api_keys.key.

ALTER TABLE api_keys ADD COLUMN key_prefix TEXT;
ALTER TABLE api_keys ADD COLUMN key_last4 TEXT;

UPDATE api_keys
SET
  key_prefix = substr(key, 1, 12),
  key_last4 = substr(key, length(key) - 3, 4)
WHERE key IS NOT NULL AND (key_prefix IS NULL OR key_last4 IS NULL);
