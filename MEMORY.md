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

## Skill

- `skills/keyword-research-agent` is the current active skill.
- `gk_api.py` must keep Cloudflare-safe headers:
  - `Accept: application/json`
  - `User-Agent: curl/8.5.0`

## Admin Notes

- Admin health dashboard work is partially implemented but not fully closed.
- User management page should have visible pagination with page size `20`.

## More Detail

- Detailed session handoff:
  - [SESSION_HANDOFF_2026-04-18.md](./SESSION_HANDOFF_2026-04-18.md)
