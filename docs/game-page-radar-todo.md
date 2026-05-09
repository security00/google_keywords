# Game Page Radar TODO

## Goal

Build a clean replacement for the old noisy sitemap discovery chain:

精选游戏站 → sitemap/new page diff → game page keyword extraction → admin-only preview → later Trends/SERP validation → final `game_keyword_pipeline` recommendations.

This is not a restoration of the deprecated `sitemap_sources` / `discovered_keywords` production path. Those old tables remain historical samples only.

## Safety boundaries

- Admin/cron only. Student pages never trigger sitemap fetches, Trends, SERP, or LLM calls.
- First slice is read/write only to new radar tables; it does not write `game_keyword_pipeline`.
- No paid API calls in v1. Trends/SERP are later phases after source quality is visible.
- Use only curated game-site sources, not broad/untrusted sitemap ingestion.
- Every recommendation must eventually pass SERP game relevance before student exposure.

## Phase 1 — schema and curated source inventory

Create new tables:

```sql
game_radar_sources
- id TEXT PRIMARY KEY
- name TEXT NOT NULL
- base_url TEXT NOT NULL
- sitemap_url TEXT NOT NULL
- enabled INTEGER NOT NULL DEFAULT 1
- quality_tier INTEGER NOT NULL DEFAULT 1
- url_include_patterns TEXT
- url_exclude_patterns TEXT
- keyword_extract_rule TEXT
- last_checked_at TEXT
- created_at TEXT NOT NULL DEFAULT datetime('now')
- updated_at TEXT NOT NULL DEFAULT datetime('now')

game_radar_pages
- id TEXT PRIMARY KEY
- source_id TEXT NOT NULL
- url TEXT NOT NULL
- url_hash TEXT NOT NULL UNIQUE
- first_seen_at TEXT NOT NULL DEFAULT datetime('now')
- last_seen_at TEXT NOT NULL DEFAULT datetime('now')
- title TEXT
- h1 TEXT
- slug_keyword TEXT
- extracted_keyword TEXT
- page_type TEXT
- status TEXT NOT NULL DEFAULT 'new'
- reject_reason TEXT
- created_at TEXT NOT NULL DEFAULT datetime('now')
- updated_at TEXT NOT NULL DEFAULT datetime('now')

game_radar_candidates
- id TEXT PRIMARY KEY
- page_id TEXT NOT NULL
- source_id TEXT NOT NULL
- keyword TEXT NOT NULL
- keyword_normalized TEXT NOT NULL
- url TEXT NOT NULL
- title TEXT
- h1 TEXT
- extraction_method TEXT NOT NULL
- status TEXT NOT NULL DEFAULT 'new'
- reject_reason TEXT
- created_at TEXT NOT NULL DEFAULT datetime('now')
- updated_at TEXT NOT NULL DEFAULT datetime('now')

game_radar_feedback
- id TEXT PRIMARY KEY
- candidate_id TEXT NOT NULL
- verdict TEXT NOT NULL -- worth | not_worth | wrong_keyword | not_game | duplicate
- note TEXT
- created_at TEXT NOT NULL DEFAULT datetime('now')
```

Initial curated sources should start small, e.g. Poki, CrazyGames, Addicting Games. Add more only after preview quality is acceptable.

## Phase 2 — v1 scanner, no paid API

`scripts/game_page_radar.py`:

1. Load enabled `game_radar_sources`.
2. Fetch sitemap XML, including sitemap indexes up to limited depth.
3. Filter URLs using source include/exclude regexes.
4. Insert unseen URLs into `game_radar_pages`.
5. Extract keyword from URL slug initially; page fetch/title/H1 extraction can be Phase 2b.
6. Clean keyword: remove play/free/online/game/unblocked/site names, normalize spacing.
7. Insert new `game_radar_candidates`.
8. Record counts in `pipeline_runs` / stdout.

Validation:

- Re-running the same source is idempotent.
- Non-game/category/search/privacy URLs are rejected.
- `https://poki.com/en/g/wheel-master` extracts `Wheel Master`.
- `Play Wheel Master Online for Free` cleans to `Wheel Master`.

## Phase 3 — admin-only preview

Add `/api/admin/game-radar` and `/dashboard/admin/game-radar`.

Show:

- source inventory and last checked time
- latest pages
- candidate keyword, source, URL, status, reject reason
- simple counts by source/status

No student exposure yet.

## Phase 4 — Trends/SERP integration

Only after source quality is acceptable:

1. Take `game_radar_candidates.status='new'`.
2. Exclude already checked `game_keyword_pipeline` keywords.
3. Run 14d Trends + 90d baseline.
4. Run SERP for ratio >= 0.1.
5. Require SERP game relevance.
6. Write final rows to `game_keyword_pipeline` with `source_site='radar:<source>'`.

## Phase 5 — feedback loop

Add admin feedback on candidates/pages:

- worth
- not_worth
- wrong_keyword
- not_game
- duplicate

Use this to adjust source quality and extraction rules before increasing source count.

## First implementation slice

- Add schema migration.
- Add pure extraction/filter tests.
- Add `scripts/game_page_radar.py --dry-run --max-sources 3 --max-pages-per-source 50`.
- Add admin API/page preview only after data quality is visible.

