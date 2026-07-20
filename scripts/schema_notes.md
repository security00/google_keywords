# D1 Schema Notes

This project uses the remote Cloudflare D1 database `ai-trends` as the production source of truth.

Current status:

- Versioned migrations live in `migrations/d1/` and are recorded in
  `schema_migrations`.
- Production migrations 0001-0019 are recorded as applied. Migrations 0016-0019
  were applied in order on 2026-07-20 before the matching Worker version was
  promoted to production; a D1 Time Travel bookmark was captured first.
- `scripts/schema/apply-d1-migrations.mjs` is the controlled migration runner.
  It defaults to dry-run and requires `--apply` for production changes.
- Historical one-off SQL files in `scripts/d1_*.sql` are operational
  references, not part of the migration chain.
- `scripts/d1_api_keys.sql` was archived because it described the legacy plaintext-key schema (`api_keys.key`, integer `user_id`) and no longer matches production behavior.
- API key validation uses `api_keys.key_hash`; the legacy NOT NULL `key`
  column receives a non-secret `hash:<hash>` placeholder and is not used for
  validation or display.
- Migration `0016_api_key_security.sql` adds cache-only scopes and persistent
  failed-auth throttling. It must be applied before deploying code that reads
  `api_keys.scopes` or `api_key_auth_failures`; deploy the migration first,
  verify it, and only then roll out the application code.
- Migration `0017_research_job_execution.sql` adds Job execution metadata,
  stable-idempotency storage and atomic leases. It must be applied after 0016
  and before deploying the POST status executors that claim jobs.
- Migration `0018_cache_namespaces.sql` adds versioned cache identity, scope,
  owner, full key hashes and explicit expiry, plus the separate
  `research_job_requests` mapping table. It must be applied after 0017 and
  before deploying code that reads these columns or stops writing Job IDs to
  `query_cache`. New private cache entries never use legacy fallback.
- Migration `0019_pipeline_cost_attribution.sql` adds explicit credential
  source, execution mode and optional owner attribution to Pipeline cost
  events. It must be applied after 0018 and before deploying admin queries or
  writers that reference those columns. Existing rows default to
  `platform`/`platform` and are not rewritten or deleted.

Current baseline:

- `migrations/baseline/0000_current_production_schema.sql` is a read-only snapshot of the current production D1 schema.
- `scripts/schema/check-d1-schema-baseline.mjs` compares the remote production schema against that snapshot.
- The baseline check is intentionally manual, not part of default CI, because it needs Cloudflare production credentials.

Schema changes must follow this process:

1. Compare schema-sensitive code with the baseline and existing migrations.
2. Add the next immutable, versioned migration under `migrations/d1/`.
3. Run the migration runner in dry-run mode and verify checksums.
4. Test against a production-shaped local snapshot.
5. Apply through a controlled production operation and refresh the baseline.

After the 0016 observation window, a later API key migration should create a hash/prefix/last4-only canonical
table, migrate rows, switch reads and writes, and only remove the legacy table
after backup and a no-access observation period.

Do not run archived SQL against production.
