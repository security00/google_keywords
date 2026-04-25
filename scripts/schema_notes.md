# D1 Schema Notes

This project uses the remote Cloudflare D1 database `ai-trends` as the production source of truth.

Current status:

- Historical one-off SQL files in `scripts/d1_*.sql` are not a complete migration system.
- `scripts/d1_api_keys.sql` was archived because it described the legacy plaintext-key schema (`api_keys.key`, integer `user_id`) and no longer matches production behavior.
- API key validation now uses `api_keys.key_hash`; plaintext `key` is retained only as migration/rollback debt and should not be used for validation.

Current baseline:

- `migrations/baseline/0000_current_production_schema.sql` is a read-only snapshot of the current production D1 schema.
- `scripts/schema/check-d1-schema-baseline.mjs` compares the remote production schema against that snapshot.
- The baseline check is intentionally manual, not part of default CI, because it needs Cloudflare production credentials.

Next schema work should be done as a dedicated migration pass:

1. Add a `schema_migrations` table if absent.
2. Create versioned migrations under a dedicated migrations directory.
3. Run migrations through a controlled script that records applied versions.
4. Migrate `api_keys` to prefix/last4/hash-only storage once UI and scripts no longer need plaintext key values.

Do not run archived SQL against production.
