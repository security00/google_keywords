# Session Handoff 2026-04-18

## Current Stable State

- Frontend keyword workflow is now cache-first for students and normal web usage.
- Daily precompute runs at Beijing time `00:05`.
- Watchdog runs every `10` minutes and resumes incomplete precompute work.
- If today's shared cache is incomplete, frontend silently falls back to the latest successful shared cache.
- Frontend does **not** trigger new paid DataForSEO requests for student/web interactions.

## Precompute Chain

Current intended flow:

1. Nightly cron triggers real paid expand/compare work once.
2. Heavy logic runs in backend precompute, not in the user-click path:
   - LLM candidate re-filtering
   - compare trends
   - SERP/LLM intent classification
3. Shared cache is written for:
   - expand
   - compare
   - intent
4. Web users read shared cache only.
5. If today's shared cache is not ready, system silently uses the latest successful cache.

### Important Implementation Notes

- The original `expand/status` tail was too heavy and caused timeouts.
- This was fixed by splitting out a cron-only finalize path for shared precompute.
- Main user-facing flow was kept unchanged.

## Health / Monitoring

- Local health file exists:
  - `/root/.local/state/google_keywords/precompute_health_YYYY-MM-DD.json`
- Daily state file exists:
  - `/root/.local/state/google_keywords/precompute_state_YYYY-MM-DD.json`
- Watchdog currently checks state freshness and resumes if needed.

### Still Not Fully Finished

Admin health dashboard is **not fully finished**.

What is done:

- Admin-only health page UI exists.
- Health data structures exist.
- Script can write local health files.

What is still blocked:

- Syncing health status back into live admin API/D1 is still not closed.
- The last blocker is auth for the `sync_precompute_health` path.

This health dashboard work should continue later, but it does **not** affect the live keyword workflow.

## Student / API Behavior

- Student-side expand:
  - always returns shared cache or fallback shared cache
  - never creates a paid task from frontend usage
- Student-side compare:
  - always returns shared compare cache or fallback shared compare cache
  - never creates a paid task from frontend usage
- Skill `keyword-research-agent` was fixed to avoid Cloudflare 403/1010 by sending:
  - `Accept: application/json`
  - `User-Agent: curl/8.5.0`

## Registration / Activation

- Unified registration link is enabled.
- Users registering from that link do not need invite codes.
- New student accounts register first, then admin batch-activates `90` day trial.
- Pending students should not be able to generate usable API keys before activation.

## Recent Batch Student Activations

### Batch 1

- Activated: `39`
- Unmatched:
  - `445007682@qq.com`

### Batch 2

- Activated: `16`
- Unmatched:
  - `summer.19931120@gmail.com`

## Recent Important Deployments

These version IDs are useful when tracing behavior:

- Compare fallback fix:
  - `4d9cb480-fd86-4fb4-8fb2-623e5c20e983`
- Strict cache-first expand behavior:
  - `988fa17e-32d9-432c-9a0b-d689d731f88e`
- Student cache fallback for custom expand/compare:
  - `679664c9-f62a-4b13-af52-408957f38a06`
- Compare fallback fix after live 409 issue:
  - `4d9cb480-fd86-4fb4-8fb2-623e5c20e983`
- Admin users pagination first live version:
  - `9353d6bf-3657-4925-b6cd-24f5b6c0e776`
- Admin users stronger pagination verification version:
  - `ad9d8325-1ce9-4807-ac0e-a2071d008353`

## User Management Pagination

Current intended state for `/dashboard/admin/users`:

- Page title should visibly show:
  - `用户管理（分页）`
- A visible pagination card should show:
  - `分页导航`
- Page size:
  - `20`
- Should display:
  - current page / total pages
  - current visible range
  - previous / next buttons

If user still reports "no pagination", verify:

1. The page really shows `用户管理（分页）`
2. The blue `分页导航` block is visible
3. The page is the admin users route:
   - `/dashboard/admin/users`
4. Live user count is over `20`:
   - current known total was `91`

## Security / Ops Notes

- SSH brute-force attempts are common in auth logs; mostly random root/admin probes.
- This is unrelated to the app keyword workflow.
- Can later add:
  - top offending IP report
  - fail2ban/ufw helper list

## What To Do Next

Recommended next priorities:

1. Finish admin health dashboard sync path.
2. Add real failure alerting for nightly precompute.
3. Add cache cleanup / stale data cleanup.
4. Confirm admin pagination live behavior if still reported inconsistent.

## Operational Principle

Do **not** regress these guarantees:

- Web users must not trigger paid DataForSEO tasks.
- Students must only consume shared cache / fallback cache.
- Heavy logic stays in backend precompute.
- If today's cache is incomplete, user experience should remain silent and stable via old successful cache.
