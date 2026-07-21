# Execution Roadmap

> Current-state baseline: 2026-07-20. This document is the delivery-facing
> roadmap. Historical `*-todo.md` files remain useful design records, but do
> not by themselves indicate that a capability is unimplemented.
>
> Domain terms and invariants are defined in `CONTEXT.md`. Architecture
> decisions live in `docs/adr/`; engineering debt and closure evidence live
> in `docs/technical-debt-register.md`.

## Product Boundary

Discover Keywords finds productizable SEO opportunities through three primary
pipelines: shared keyword expansion, old-keyword research, and game discovery.
Students consume cached results only. Paid provider work is restricted to
administrator or cron-controlled backend paths.

Supporting admin-only layers provide source quality, opportunity enrichment and
feedback, semantic-dedupe review, Game Radar, and community-signal review.
They must not directly alter student recommendations or create paid calls from
the browser.

## Current Delivery Status

| Area | Status | Evidence / next boundary |
| --- | --- | --- |
| Shared expansion | Operational; debt closure deployed | Shared cache and background precompute exist; Pipeline v1 run/task/cost instrumentation and migrations are in production; the stabilization observation window remains. |
| Old-keyword pipeline | Operational | Explicit run/task/cost stages are recorded by the Python runtime. |
| Game discovery pipeline | Operational | Trends, history, SERP, and classification stages are recorded. |
| Game Radar | Implemented; needs quality operations | Scanner, admin review, trends, SERP, promotion, and auto-review scripts exist. Expand sources only after quality review. |
| Multi-signal discovery | Implemented; needs operational metrics | Collection, standardization, review, and signal bridge exist. New platforms remain deferred. |
| Source/opportunity dashboards | Implemented, read-only by design | Quality, score, suggestions, enrichment, feedback, report, and semantic-dedupe surfaces are available. |
| SaaS operations | Production healthy; BYOK isolated development active | BYOK B1 and B2 are locally implemented. B3 now includes local dual-provider connection management and free DataForSEO credential verification; paid DataForSEO execution is not enabled. Management and Live Mode remain feature-off, with no production KEK, remote migration, or deployment. |

## Ordered Work

## Execution Log

- 2026-07-21, BYOK B3 connection slice: added owner-scoped encrypted
  DataForSEO `{login,password}` management beside OpenRouter. Verification is
  fixed to the official free `/v3/appendix/user_data` endpoint and returns only
  sanitized status. No research execution, paid provider call, production
  secret, remote migration, or deployment is part of this slice.

- 2026-07-21, BYOK B3 spend-control gate: added local owner daily budgets,
  operator ceilings, concurrency reservations, and expiring server cost quotes.
  Only an exact request-hash and estimated-cost `CONFIRM` can reserve capacity;
  this remains infrastructure only and does not expose a paid Provider call.

- 2026-07-21, BYOK B3 Trends slice: added a local quote-then-confirm Trends
  path using only the selected owner DataForSEO connection. It binds the
  normalized request, connection version, current $0.011 Live-task estimate,
  private cache, irreversible Provider checkpoint, and user/byok Cost Event.
  Platform credential fallback is test-forbidden; the route remains feature-off
  and undeployed.

- 2026-07-21, BYOK B3 SERP slice: added a local quote-then-confirm Google
  Organic Live path fixed to one US desktop request at depth 10 and the
  current $0.002 estimate. Quote creation does not decrypt credentials or call
  the Provider; confirmed execution uses only the selected owner connection,
  an irreversible job checkpoint, private `byok-serp` cache, and a stable
  user/byok Cost Event. Platform credential fallback is test-forbidden; the
  route remains feature-off and undeployed.

- 2026-07-21, BYOK B3 Expand slice: added local single-seed Google Trends
  Related Queries expansion with fixed US/en/web parameters and the current
  $0.011 Live-task estimate. It returns only sanitized Top/Rising candidates,
  writes only owner-private `byok-expand` cache, and forbids platform credential
  fallback. The route remains feature-off and undeployed.

- 2026-07-21, BYOK isolated development: created
  `codex/byok-b1-provider-connections` from `origin/main`. B1.1 accepted
  ADR-0008 and added credential envelope crypto with no D1 or environment
  access. B1.2 adds only an additive Provider Connection schema and
  owner-scoped Store while feature exposure and production deployment remain
  closed.

- 2026-07-20, production rollout: reconciled the remote migration ledger,
  captured a D1 Time Travel rollback bookmark, and applied migrations 0016-0019
  in order before changing Worker traffic. Built the application in Linux after
  detecting an incomplete Windows OpenNext bundle, then validated the isolated
  preview, the production custom domain, authorization boundaries, and every
  static asset referenced by the landing page. Worker version
  `54604d83-bbc6-4a35-8878-55f3f9cf24e4` now serves 100% of traffic; the prior
  version `2991c277-d33c-4e0a-94f8-4b785658fda7` remains the immediate
  application rollback target. No BYOK route or credential storage was added.
- 2026-07-20, D6 staged locally: added a shared TypeScript/Python Pipeline v1
  contract and golden idempotency fixtures, explicit credential/execution
  attribution for cost events, mixed actual/estimated accounting, and admin
  anomaly visibility for stale runs, orphaned cost events and missing event
  keys. Removed unused `serp_confidence_cache` wrappers but retained the table;
  documented that sitemap discovery is still actively consumed and therefore
  cannot be deleted in this batch. Migration 0019 was subsequently applied in
  the production rollout recorded above.
- 2026-07-20, D5 staged locally: isolated DataForSEO credentials, official
  endpoints, timeout/retry transport and OpenRouter configuration behind
  provider adapters. Expand, Compare, SERP, Trends, keyword suggestions,
  semantic filtering and intent classification now accept injected clients
  while preserving platform defaults. Response parsing is covered by pure
  feature tests; no BYOK route or credential storage was added.
- 2026-07-20, D4 staged locally: made Worker D1 access binding-only and
  fail-closed, introduced versioned shared/private cache identities with full
  SHA-256 keys and explicit expiry, and moved Expand/Compare request-to-job
  references into `research_job_requests`. Legacy reads are shared-only and
  time-bounded; private cache never falls back. Migration 0018 and the matching
  application code were subsequently deployed; legacy-read observation remains.
- 2026-07-20, D3 staged locally: removed ownerless Research Job fallbacks,
  required owner plus job type for user reads and writes, added atomic
  execution leases, and moved all repository clients to explicit POST status
  executors. Side-effecting GET remains behind a default-on compatibility flag
  for one observation window; migration 0017 was subsequently deployed while
  the compatibility flag intentionally remains enabled.
- 2026-07-20, D2 staged locally: centralized Cron verification, introduced a
  unified Principal and Effective Access path, made active Stripe and course
  access consistent across shared research routes, added cache-only API Key
  scopes and persistent failed-auth throttling, and preserved the existing
  cron-plus-API-key ownership flow. Migration 0016 and the matching application
  code were subsequently deployed migration-first.
- 2026-07-20, engineering baseline: established CONTEXT/ADR/debt authority,
  added cross-platform Python, type, migration, paid-provider, dependency and
  Cloudflare binding gates; upgraded the supported Next/OpenNext toolchain and
  removed the redundant middleware/proxy without changing route authorization.
- 2026-07-14, round 2: shared precompute now records task boundaries for
  expansion, LLM filtering, compare submission, and compare-intent submission.
  Paid cost events carry the matching task id. The remaining P0 work is shared
  cost aggregation, health diagnostics, and end-to-end access verification.
- 2026-07-14, round 3: the admin pipeline-runs surface now reads and displays
  the run-to-task-to-cost relationship. It is an admin-only D1 query and does
  not change cron execution or paid-provider behavior.
- 2026-07-14, round 4: the admin health surface now reads recent pipeline
  status, failed task/run counts, and 24-hour ledger costs. The health query is
  read-only and degrades to an unavailable state if the ledger cannot be read.

### P0 — Production reliability and observability

The code-side debt batches are complete locally. The remaining P0 work is an
operations gate, not additional BYOK implementation:

1. Completed 2026-07-20: migrations 0016-0019 were applied in order and the
   matching Linux-built Worker was deployed with documented rollback targets.
2. Verify pending and expired student access end to end for game and old-keyword
   surfaces; preserve cache-first behavior.
3. Observe Research Job leases, cache hit/fallback rates, Pipeline cost-event
   completeness, stale runs, and paid-provider errors for one stable window.
4. Disable side-effecting GET compatibility and legacy shared-cache reads only
   after the observation evidence is clean.
5. Approve the BYOK implementation gate; until then, no user credential storage
   or user-triggered paid-provider route is introduced.

### P1 — Quality operations

1. Record Game Radar per-source funnel metrics and use them to calibrate source
   rules before adding sources.
2. Add multi-signal review metrics: queue age, approve/reject rates, rejection
   reasons, and bridge conversion.
3. Maintain regression samples for false positives and false negatives in the
   rule engine, signal extractor, and game filters.

### P2 — Design only after P0

Design, but do not deploy, a Cloudflare Queue consumer. It must reuse current
pipeline task records, provide global idempotency, retries and dead-letter
handling, and retain a cron rollback path.

### Engineering sequence before BYOK

Close the independently deployable debt batches in this order: CI/runtime,
Principal and entitlement, Research Job ownership/idempotency, cache/D1
boundaries, Provider adapters, then Pipeline observability and legacy
retirement. BYOK development starts only after the current paid platform paths
and student cache-only invariant pass the stabilization gate.

## Explicitly Deferred

- Automatic source reweighting or recommendation changes.
- Model training or fine-tuning from feedback.
- Restoring the deprecated sitemap-discovery path as a production game source.
- Frontend paths that use platform credentials to trigger DataForSEO,
  OpenRouter, Trends, or SERP work.
- Cloudflare Queue/Workflow deployment until the existing task boundary and
  idempotency model are stable.

## Delivery Gates

Every code change must pass `npm test`, `npm run check:student-paid-guards`,
and `npm run build`. Pipeline changes also require dry-run, idempotent rerun,
and failure-without-business-interruption checks. Production changes require a
post-deploy smoke check.
