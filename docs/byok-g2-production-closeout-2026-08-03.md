# BYOK G2 production closeout — 2026-08-03

## Decision

G2 production acceptance is complete. The deployed unified BYOK UI/API pipeline passed the maintainer UI check, the free Bearer API contract checks, external-provider billing reconciliation, and the Student cache-miss guard check.

This decision does **not** approve G3 expansion, G4, or general availability. Production remains limited to the existing single-owner allowlist with the existing USD 0.05 daily budget and concurrency limit of 1. No allowlist, budget, concurrency, Provider Connection, or Live Mode setting was expanded during this closeout.

## Production deployment identity

- Merge commit: `fe91b26bd339ef81ef63de231a7d57e1d96f8b87`
- Deployment workflow run: `30756801819`
- Production Worker version: `dca284cc-b745-43ba-893e-060c70d94723`
- Migration: `0025_byok_pipeline_integration`
- Migration checksum: `06f60b330e86702293125290078213d85531ad15ff817dbf3bdab8eef97bb5c2`
- Production owner: `3420d268-bce3-435e-89e7-8dee4b9dbc92`

D1 timestamps below are UTC. For example, `2026-08-02 17:25 UTC` is `2026-08-03 01:25` in Asia/Shanghai.

## External billing reconciliation

The operator confirmed the Provider bills before the new production test:

- DataForSEO actual: USD 0.048000
- OpenRouter successful requests: USD 0.000196
- OpenRouter failed request: USD 0
- External total: USD 0.048196

The total matched the site ledger exactly.

## Maintainer UI Expand

The operator authorized one production BYOK UI Expand with an aggregate quote cap of USD 0.02 and no Compare execution.

- Input root: `aidesign`
- Quote: `4960b1e3-3ac4-4e08-9671-8fa0d155a16e`
- Aggregate quote: USD 0.016000
- Parent Job: `b85cd3d8-836b-4e6b-8c28-6548e2e31c75`
- Child Expand Job: `ea5673b4-f16d-4de5-b41b-c845f953a439`
- Final state: `complete`, 1/1 step
- Actual DataForSEO cost: USD 0.011000
- OpenRouter calls: 0 because the expansion returned 0 candidates
- Result cache: owner-scoped Private Cache

The UI used the existing “获取候选词” action, showed one aggregate confirmation, and automatically entered the existing “第二步：人工筛选” page. The Compare button was disabled because there were no candidates; no Compare request was made.

After this call, cumulative BYOK actual cost was USD 0.059196. The production health page showed one completed BYOK Job in 24 hours, USD 0.0110 estimated, USD 0.0110 accounted, no stale task, and zero isolation/ledger violations.

## Free Bearer API checks

A temporary `gk_live_*` key with only `cache:read` and `byok:execute` was used in process memory. The complete key was not printed, logged, or written to a file, and the key was revoked after the checks.

- `GET /api/research/byok/readiness`: HTTP 200, `ready=true`
- DataForSEO verified: true
- OpenRouter verified: true
- Daily budget: USD 0.05
- Remaining budget after the UI run: USD 0.039
- Concurrency available: true
- `POST /api/research/byok/pipeline/expand/quote`: HTTP 200
- Free API quote: `0b1ae296-a3e0-4b03-87ee-06a096d616f9`
- Quote amount: USD 0.016000; DataForSEO USD 0.011, OpenRouter upper bound USD 0.005
- Internal batch count: 6
- Quote execution: not submitted
- `GET /api/research/byok/pipeline/jobs/b85cd3d8-836b-4e6b-8c28-6548e2e31c75`: HTTP 200, `complete`, 1/1
- `GET /api/research/byok/pipeline/history?limit=5`: HTTP 200 and contained the same parent Job

The free API checks added one unexecuted quote only. Parent runs stayed at 1, Research Jobs stayed at 1178, and Cost Events stayed at 1978. The temporary API validation keys are inactive; the owner has four active API keys after cleanup.

## Student production cache-miss guard

The operator separately authorized exactly one production cache-miss request, with no retry and an expected response of HTTP 409 plus `cache_miss`.

- Student account: `bote@123.com`
- Student owner ID: `ebbed63a-92be-4de4-a849-940a77f76c44`
- Role: `student`
- Test keyword: `g2-student-cache-miss-20260803-a81f6c2d`
- Endpoint: `POST /api/research/trends`
- Authentication: temporary Bearer key with `cache:read` only
- Request count: 1
- Response: HTTP 409, `status=cache_miss`
- Retry count: 0

Before the request, the exact shared Trends cache key had zero matches. Before/after evidence was identical:

| Evidence | Before | After |
| --- | ---: | ---: |
| Exact cache matches | 0 | 0 |
| Research Jobs | 1178 | 1178 |
| Research Job Requests | 27 | 27 |
| Cost Events | 1978 | 1978 |
| Pipeline Runs | 410 | 410 |
| BYOK Pipeline Quotes | 2 | 2 |
| BYOK Pipeline Runs | 1 | 1 |

The temporary Student key was revoked immediately (`active=0`). The unchanged Provider-adjacent records, together with the route ordering that checks Student paid permission before `submitComparisonTasksWithCost`, demonstrate that the rejection occurred before any Provider request or Job creation.

## G3 admission boundary

The next allowed activity is G3 preparation only:

1. nominate 3–5 internal accounts;
2. define per-account owner IDs, channels (UI/API), daily test actions, and unchanged low budgets;
3. obtain explicit approval before changing the production allowlist;
4. collect seven consecutive natural days of evidence with each call marked by channel;
5. keep G4 and general availability out of scope until G3 passes independently.

Code completion and G2 acceptance do not authorize a larger production rollout.
