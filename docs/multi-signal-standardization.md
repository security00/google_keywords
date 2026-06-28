# Multi-Signal Standardization

## Goal

Standardize Google-adjacent signals from Reddit, Hacker News, RSS, GitHub Trending, and future X/Facebook adapters into one review-first opportunity evidence shape.

This layer must not change student-facing recommendations directly.

## Current Boundary

- Raw sources still flow through `signal_collector/`.
- Extracted candidates still write to `signal_candidates`.
- `signal_bridge.py` remains the paid-expand gate.
- Standardized signals default to:
  - `review_required: true`
  - `paid_expand_allowed: false`

## Standard Shape

`signal_collector.standardizer.standardized_signal_opportunity()` projects a `KeywordCandidate` into:

- `keyword`
- `keyword_normalized`
- `signal_layer`
- `source_count`
- `signal_score`
- `avg_hotness`
- `first_seen_at`
- `last_seen_at`
- `evidence[]`
- `review_required`
- `paid_expand_allowed`

Each evidence item contains:

- `provider`
- `source_label`
- `title`
- `url`
- `published_at`
- `hotness`
- `metadata`

## Product Layers

- `community_signal`: Reddit, Hacker News, RSS, and mixed discussion signals.
- `vertical_source`: GitHub Trending and future platform-specific vertical sources.
- `search_demand`: reserved for Google/DataForSEO validation, not currently emitted by signal discovery.

## Safety Rules

1. Signal evidence is admin/review input, not a student-facing recommendation.
2. A signal candidate must pass `signal_bridge.py` classification before paid expand.
3. X/Facebook adapters should emit the same evidence shape before any production wiring.
4. No source adapter should directly write into student recommendation tables.
5. Search validation remains downstream of review/gating.

## Next Implementation Slice

Improve extraction quality before adding new platforms:

- Add source-specific extractors for Reddit, GitHub Trending, RSS, and HN.
- Track rejected reasons in an admin-only view.
- Add a Signal Review Queue before candidates reach paid expand.
- Treat X and Facebook as adapter design work first, not production ingestion.

