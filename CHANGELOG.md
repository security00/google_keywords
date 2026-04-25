# CHANGELOG

> Human-readable change log for major system changes.  
> This file records why a change was made, what changed, how it was verified, and rollback notes when relevant.

## 2026-04-25 — SaaS Foundation Hardening

### 1. Paid API permission boundary centralized

**Why**

Students must never trigger paid DataForSEO/OpenRouter/SERP work. Before this change, some routes still accepted API keys with loose `gk_live_` prefix checks or scattered inline authorization logic.

**Changed**

- Added unified authorization helper: `lib/authz.ts`.
- Centralized principal handling for:
  - cookie session
  - API key
  - cron secret
  - admin/student roles
- Protected paid/admin routes with explicit helpers:
  - `requireAdminRequest`
  - `requireCronOrAdmin`
  - `requirePaidApiPermission`
- Updated high-risk routes:
  - `/api/research/keyword-suggestions`
  - `/api/research/trends-quick`
  - `/api/research/trends`
  - `/api/research/serp`
  - `/api/admin/old-keywords`
  - `/api/admin/game-keywords`

**Verification**

- `npx tsc --noEmit` passed.
- GitHub Actions deploy passed.
- Online checks confirmed:
  - student can read `/api/old-keywords` and `/api/game-keywords`
  - student cannot access admin old-keywords
  - student cannot call keyword suggestions or trends-quick paid routes
  - student SERP cache miss returns `409 cache_miss` instead of creating a paid task
  - admin key can access admin routes

**Commit**

- `e1d405e security: centralize paid API authz boundaries`

---

### 2. Deployment config single source of truth

**Why**

Both `wrangler.toml` and `wrangler.jsonc` existed and had different bindings/settings. Wrangler default deploy used `wrangler.jsonc`, while `wrangler.toml` contained the D1 binding. This made deployments ambiguous.

**Changed**

- Made `wrangler.jsonc` the canonical Cloudflare Worker config.
- Added D1 binding `DB` / `ai-trends` to `wrangler.jsonc`.
- CI deploy now explicitly runs:
  - `npx wrangler@4.83.0 deploy --config wrangler.jsonc`
- Archived old config:
  - `docs/archive/wrangler.toml.legacy`
- Updated `ARCHITECTURE.md` to reflect canonical deploy config.

**Verification**

- `wrangler deploy --dry-run --config wrangler.jsonc` confirmed:
  - D1 binding exists
  - assets binding exists
  - worker self-reference exists
  - vars are present
- CI deploy passed.
- Online smoke passed.

**Commit**

- `df7b421 chore: consolidate deploy config and business-rule sources`

---

### 3. Business rules single source of truth

**Why**

Business thresholds existed in TypeScript and Python/JSON copies. The export script had duplicated hardcoded values, which drifted from `config/business-rules.ts`.

**Changed**

- `config/business-rules.ts` is now the source of truth.
- `config/business-rules.json` is generated from TS.
- Rewrote `scripts/export-business-rules.mjs` to export from TS instead of duplicating values.
- Added `scripts/check-business-rules.mjs`.
- CI now checks business-rule JSON drift before build/deploy.

**Verification**

- `node scripts/check-business-rules.mjs` passed.
- CI passed.

**Commits**

- `df7b421 chore: consolidate deploy config and business-rule sources`
- `daba474 refactor: precompute_shared_expand.py reads config/business-rules.json`
- `dce017d refactor: discovery-feed route split + Python config sync`

---

### 4. D1 schema baseline and migration ledger

**Why**

Schema files were scattered and stale. Production D1 needed a visible baseline and migration ledger before future schema changes, especially before API key storage changes.

**Changed**

- Added production schema baseline:
  - `migrations/baseline/0000_current_production_schema.sql`
- Added migration runner:
  - `scripts/schema/apply-d1-migrations.mjs`
- Added schema drift checker:
  - `scripts/schema/check-d1-schema-baseline.mjs`
- Added first migration:
  - `migrations/d1/0001_schema_migrations_baseline.sql`
- Created `schema_migrations` table in production D1.
- Archived stale API key SQL:
  - `docs/archive/sql/d1_api_keys.legacy.sql`
- Added schema notes:
  - `scripts/schema_notes.md`

**Verification**

- Migration dry-run and apply completed.
- Re-running migrations reports already-applied.
- Remote D1 schema baseline check passed.
- Online smoke passed.

**Commits**

- `41f3101 chore: add D1 production schema baseline check`
- `5b70dac chore: add minimal D1 migration runner`

---

### 5. API key validation moved to SHA256 hash lookup

**Why**

API keys should not be validated by plaintext DB lookup. Hash-based validation is required before moving toward SaaS-grade key storage.

**Changed**

- Added `key_hash` column to `api_keys`.
- Migrated active API keys to SHA256 hashes.
- `validateApiKey()` now queries `api_keys.key_hash`.
- API key creation writes `key_hash`.

**Verification**

- Migrated 43/43 active keys.
- Student/admin key validation worked online.
- Invalid key correctly rejected.
- CI and smoke passed.

**Commit**

- `8cda1e6 security: API key validation now uses SHA256 hash lookup`

---

### 6. API key display metadata added; UI no longer reads plaintext key

**Why**

Even after hash validation, UI/admin paths still read plaintext `api_keys.key` to show masked values. The next step toward no-plaintext storage is to display keys using prefix/last4 metadata.

**Changed**

- Added migration:
  - `migrations/d1/0002_api_key_display_columns.sql`
- Added columns:
  - `key_prefix`
  - `key_last4`
- Backfilled active keys.
- `listApiKeys()` now reads `key_prefix/key_last4` instead of plaintext key.
- Admin user detail now reads `key_prefix/key_last4` instead of plaintext key.
- `replay_expand_job.py` updated to write hash/prefix/last4 for temporary replay keys.

**Verification**

- Migration applied.
- Active key missing `key_hash/key_prefix/key_last4`: `0`.
- `npx tsc --noEmit` passed.
- D1 schema baseline passed.
- Online smoke passed.
- CI deploy passed.

**Commit**

- `0070ecd security: stop UI paths from reading plaintext API keys`

**Remaining follow-up**

Plaintext `api_keys.key` still exists as a transition/rollback column. Future work should stop writing full plaintext keys and eventually clear/drop the legacy column after a safer migration plan.

---

### 7. Production smoke check added

**Why**

Every architecture/security change needs a fast production-level sanity check.

**Changed**

- Added `scripts/smoke_check.py`.
- Checks:
  - `/api/me`
  - `/api/old-keywords`
  - `/api/game-keywords`
  - `/api/research/expand` empty request behavior

**Verification**

- Smoke passed repeatedly after deploys.

**Commit**

- `1c72f49 test: add production smoke check script`

---

## Operating Principle Going Forward

For SaaS-hardening work:

1. Make one small change at a time.
2. Keep existing product behavior unchanged unless explicitly intended.
3. Run typecheck / CI / smoke checks.
4. Prefer additive migrations before destructive schema changes.
5. Keep admin/student/cron/paid-API boundaries explicit.
6. Leave a clear rollback point through git commits and migration ledger.
