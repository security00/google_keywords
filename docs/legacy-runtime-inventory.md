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

Status: active; not authorized for deletion.

The older sitemap/discovered-keyword domain is no longer the preferred source
for student recommendations, but it is still accessed by current code:

- `/dashboard/discovery` and `/api/sitemaps/*` manage and scan user sources.
- `/api/cron/discovery` performs scheduled discovery.
- `scripts/game_trend_scanner.py` and `scripts/discovery_scan.py` still query
  `sitemap_sources` and `discovered_keywords`.
- source-quality, semantic-dedupe, Compare selection and discovery-feed views
  still read the historical candidates.

Therefore `sitemap_sources`, `sitemap_entries` and `discovered_keywords` are
not dead tables. Retiring them requires a separate product migration: disable
new writes and scheduled scans, replace the discovery UI/feed consumers,
observe reads, export a backup, then remove routes and tables independently.
This debt batch does not change those live behaviors.
