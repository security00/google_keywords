# Project Memory

## Keyword Workflow

- Students and normal web users must be **cache-first only**.
- Frontend must **not** trigger new paid DataForSEO requests.
- If today's shared cache is unavailable, silently fall back to the latest successful shared cache.
- Heavy logic stays in backend precompute:
  - LLM candidate re-filtering
  - compare trends
  - SERP/LLM intent classification

## Nightly Precompute

- Main precompute runs daily at Beijing time `00:05`.
- Watchdog runs every `10` minutes.
- Health files are written locally under:
  - `/root/.local/state/google_keywords/precompute_state_YYYY-MM-DD.json`
  - `/root/.local/state/google_keywords/precompute_health_YYYY-MM-DD.json`

## Registration / Activation

- Unified registration link is enabled.
- New student users register first, then admin batch-activates `90` day trial.
- Pending students should not have usable API capability before activation.
- As of `2026-04-28`, `/api/game-keywords` and `/api/old-keywords` both call `checkStudentAccess`.
  Pending or expired students must not receive recommendation data from these endpoints.

## Skill

- `skills/keyword-research-agent` is the current active skill.
- `gk_api.py` must keep Cloudflare-safe headers:
  - `Accept: application/json`
  - `User-Agent: curl/8.5.0`
- Student API Keys in the web UI are for the `keyword-research-agent` skill, not for teaching students manual HTTP API usage.
  Do not show `Authorization` header examples, `?api_key=` examples, cache behavior, or provider/cost internals in student-facing copy.

## Admin Notes

- Admin health dashboard work is partially implemented but not fully closed.
- User management page should have visible pagination with page size `20`.
- Student/admin game discovery copy should say "multi-source game candidates" or similar.
  Do not mention outdated `Steam + CrazyGames`, fixed UTC schedules, `GPTs`, or trend window internals in student-facing helper text.
- Admin game discovery page currently has lint warnings unrelated to the latest copy change:
  - unused `ReferenceLine`
  - `useEffect` missing `load` dependency
  - two `no-unused-expressions` warnings
  Clean these in a focused follow-up if touching the page again.

## SaaS Foundation

- Paused on `2026-04-27` to prioritize online production issues.
- Resume the SaaS foundation work after production is stable.
- Current completed slice:
  - D1 migration `0005_pipeline_idempotency.sql` applied to production.
  - `pipeline_tasks`, `pipeline_artifacts`, `pipeline_cost_events.event_key`, `pipeline_runs.run_key`, and `pipeline_runs.budget_usd` are live.
  - `migrations/baseline/0000_current_production_schema.sql` was refreshed and remote schema check passed.
  - TypeScript pipeline base exists under `lib/pipelines/`.
  - Python `pipeline_runtime.py` exists and records best-effort `pipeline_runs`, `pipeline_tasks`, and `pipeline_cost_events`.
  - `old_word_pipeline.py` is wired into task stages:
    - `old-word.seed`
    - `old-word.trends`
    - `old-word.finalize`
  - `game_trend_scanner.py` is wired into task stages:
    - `game.trends-14d`
    - `game.history-90d`
    - `game.serp`
    - `game.classify`
  - Cost events should include `task_id` whenever a paid call happens inside a task.
- Next resume slice:
  - Wire `precompute_shared_expand.py` into the same `pipeline_runs / pipeline_tasks / pipeline_cost_events` boundary.
  - Extract a shared cost summary helper so scripts do not each query `pipeline_cost_events` manually.
  - Only after that, design the Cloudflare Queues consumer adapter.

## Follow-Up TODO

- Run an end-to-end check with a deliberately pending student login:
  - `/dashboard/games` should show activation/access messaging, not data.
  - `/dashboard/old-keywords` should show activation/access messaging, not data.
- Sweep student-facing and admin-facing copy for stale implementation details:
  - outdated sources
  - provider names
  - cache/cost internals
  - fixed cron schedules that are not guaranteed
- Keep documentation updated:
  - [docs/saas-foundation-progress-2026-04-28.md](./docs/saas-foundation-progress-2026-04-28.md)
  - [docs/pipeline-task-boundary.md](./docs/pipeline-task-boundary.md)

## More Detail

- Detailed session handoff:
  - [SESSION_HANDOFF_2026-04-18.md](./SESSION_HANDOFF_2026-04-18.md)
