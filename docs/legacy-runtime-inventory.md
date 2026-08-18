# Legacy Runtime Inventory

> Audited: 2026-07-20. “Legacy” does not mean safe to delete. Runtime access
> must stop, then be observed, backed up and removed in a separate migration.

## `serp_confidence_cache`

Status: runtime access removed locally; table retained.

- Repository-wide audit found no callers of `getSerpConfidence` or
  `setSerpConfidence`.
- The unused wrappers were removed from `lib/cache.ts`, so new application
  code cannot read or write the table accidentally.
- The D1 table is deliberately retained for a production no-access observation
  window and backup. A later, dedicated migration may remove it only after
  production query evidence confirms zero access.

## Sitemap discovery tables and routes

Status: UI step 1 started; tables and cron remain active.

The older sitemap/discovered-keyword domain is no longer the preferred source
for student recommendations. The four-step retirement is only allowed to
advance one step at a time:

1. **Remove new student-facing entry** — done. `/dashboard/discovery` is
   `noindex`, off student and admin nav, and labelled as a legacy page. Cron,
   sitemap APIs, and table writes stay up so current pipelines do not break.
2. **Observe access** — next. Confirm production still needs
   `/api/cron/discovery`, `scripts/discovery_scan.py`, and historical
   `discovered_keywords` readers.
3. **Backup** — not started.
4. **Independent deletion** — not authorized. Do not drop
   `sitemap_sources`, `sitemap_entries`, `discovered_keywords`, or the
   sitemap/discovery routes in this batch.

Current remaining accessors:

- `/dashboard/discovery` and `/api/sitemaps/*` still manage and scan sources
  if opened by URL.
- `/api/cron/discovery` performs scheduled discovery.
- `scripts/game_trend_scanner.py` and `scripts/discovery_scan.py` still query
  `sitemap_sources` and `discovered_keywords`.
- source-quality, semantic-dedupe, Compare selection and discovery-feed views
  still read the historical candidates.
