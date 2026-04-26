# Discover Keywords

Discover Keywords is an internal keyword research and discovery platform for finding, scoring, and operating SEO opportunities. It combines student-facing research workflows, admin tooling, scheduled precompute jobs, and Cloudflare-native deployment.

Production site: <https://discoverkeywords.co>

## What it does

- **Keyword expansion** — expand seed terms into candidate keyword sets.
- **Candidate filtering** — apply business rules, SERP signals, trend checks, and optional LLM filtering.
- **Trend comparison** — compare candidates against a benchmark keyword and classify opportunity strength.
- **Game discovery** — scan Steam/community signals and surface new game keyword opportunities.
- **Old keyword mining** — identify older keywords worth revisiting.
- **Shared precompute cache** — keep expensive research work in scheduled background jobs instead of user clicks.
- **Student access control** — registration, pending activation, 90-day trials, API keys, quotas, and session auth.
- **Admin operations** — user activation, invite codes, health panels, pipeline runs, and cost visibility.
- **External APIs** — authenticated endpoints for research and discovery-feed consumers.

## Current architecture

- **Frontend / API:** Next.js 16 App Router + React 19 + TypeScript
- **Styling:** Tailwind CSS 4
- **Deployment:** Cloudflare Worker via OpenNext (`@opennextjs/cloudflare`)
- **Database:** Cloudflare D1 (`ai-trends`)
- **External data:** DataForSEO, OpenRouter, Steam/community sources
- **Analytics:** Google Analytics + Microsoft Clarity

Supabase is no longer used. Do not add Supabase credentials or migration files back into this repo.

## Main workflows

### Student workflow

1. Register / sign in.
2. Wait for admin activation if the account is pending.
3. Use dashboard modules:
   - `/dashboard/expand` — keyword expansion
   - `/dashboard/candidates` — candidate selection
   - `/dashboard/analysis` — trend comparison
   - `/dashboard/games` — new game discovery
   - `/dashboard/old-keywords` — old keyword recommendations
   - `/dashboard/settings` — API keys and account settings

Student-facing pages should use shared cache and background precompute results wherever possible. Avoid adding new user-click paths that call paid APIs directly unless explicitly required.

### Admin workflow

Admin pages live under `/dashboard/admin`:

- `/dashboard/admin/users` — users, pending accounts, activation
- `/dashboard/admin/codes` — invite codes
- `/dashboard/admin/health` — system/precompute health
- `/dashboard/admin/games` — game discovery operations
- `/dashboard/admin/old-keywords` — old keyword pipeline
- `/dashboard/admin/pipeline-runs` — pipeline run and cost visibility

### Scheduled jobs

Important scripts:

- `scripts/precompute_shared_expand.py` — shared keyword precompute pipeline
- `scripts/run_precompute.sh` — main precompute entrypoint
- `scripts/run_precompute_with_retry.sh` — retry wrapper
- `scripts/run_precompute_watchdog.sh` — watchdog/backfill wrapper
- `scripts/game_trend_scanner.py` — game discovery scanner
- `scripts/old_word_pipeline.py` — old keyword pipeline
- `scripts/check-business-rules.mjs` — CI guard for business-rule sync

Local state for precompute/watchdog health is written outside the repo under `/root/.local/state/google_keywords/`.

## Local development

### Requirements

- Node.js 22+
- npm
- Wrangler CLI / Cloudflare credentials for remote D1 and deployment work

### Install

```bash
npm ci
```

### Run locally

```bash
npm run dev
```

Open <http://localhost:3000>.

### Validate

```bash
npm run build
npm run lint
node scripts/check-business-rules.mjs
```

`npm run build` is the minimum required gate before merging or deploying code changes.

## Environment variables

Keep secrets in local env files, Cloudflare secrets, or GitHub Actions secrets. Do not commit real credentials.

Common variables:

| Area | Variables |
|---|---|
| Cloudflare / D1 | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `D1_DATABASE_NAME` |
| DataForSEO | DataForSEO login/password or configured API credentials used by the runtime |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL` |
| Auth / cron | session secrets, cron secrets, admin credentials as configured in deployment |
| Analytics | `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_CLARITY_PROJECT_ID` |

`wrangler.jsonc` contains non-secret defaults and the D1 binding. Secrets must stay outside the file.

## Database and migrations

D1 is the source of truth.

Current migration folders:

- `migrations/baseline/` — current production schema baseline
- `migrations/d1/` — incremental D1 migrations
- `scripts/d1_*.sql` — legacy/manual schema helpers kept for operational reference
- `scripts/schema/` — schema baseline checks and migration helpers

Before changing schema-sensitive code:

1. Inspect the current D1 schema or baseline.
2. Add/update a migration where needed.
3. Run build and relevant smoke checks.
4. Verify deployment through GitHub Actions.

## Deployment

Deployment is automatic on push to `main`.

GitHub Actions workflow: `.github/workflows/deploy.yml`

Pipeline:

1. `npm ci`
2. `node scripts/check-business-rules.mjs`
3. `npx opennextjs-cloudflare build`
4. `npx wrangler deploy --config wrangler.jsonc`

Useful commands:

```bash
npm run build
npx opennextjs-cloudflare build
npx wrangler deploy --config wrangler.jsonc
```

After pushing, check the latest workflow run and confirm the Cloudflare deploy succeeded.

## API documentation

- [`API.md`](./API.md) — main REST API documentation
- [`discovery-feed-api.md`](./discovery-feed-api.md) — discovery feed interface
- `/api-docs` — in-app API docs page

Important API groups:

- `/api/auth/*` — sign-in, sign-up, sessions, password reset, API keys
- `/api/research/*` — expansion, SERP, trends, compare, history, sessions
- `/api/sitemaps/*` — sitemap sources and keyword discovery
- `/api/admin/*` — admin-only operations
- `/api/integrations/discovery-feed` — external discovery feed

## Repository hygiene

The repo should not contain generated data or local runtime output.

Ignored/generated examples:

- `.next/`
- `.open-next/`
- `.wrangler/`
- `.data/`
- `d1_export.sql`
- `d1_export_parts/`
- `*.pyc`
- `*.tsbuildinfo`
- `next-env.d.ts`
- `.env*`

Do not commit:

- API keys or tokens
- database dumps
- local cache files
- build output
- generated Python bytecode

## Maintenance notes

- Keep paid API calls in background jobs or cached server flows whenever possible.
- Keep student-facing requests fast and cache-first.
- When adding/removing team or admin workflows, update admin pages, scripts, docs, and CI checks together.
- If Clarity/GA behavior needs verification, inspect built client chunks; analytics scripts are injected client-side.
- If the site appears stale after a push, check GitHub Actions and Cloudflare deployment before assuming CDN cache issues.

## Related docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — detailed system architecture
- [`CHANGELOG.md`](./CHANGELOG.md) — project change history
- [`FILTER_RULES.md`](./FILTER_RULES.md) — filtering/business rule notes
- [`SESSION_HANDOFF_2026-04-18.md`](./SESSION_HANDOFF_2026-04-18.md) — historical handoff context
