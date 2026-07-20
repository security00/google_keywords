# Pipeline Task Boundary

This project is currently Cloudflare-first but keeps pipeline core logic portable.
The near-term migration path is to record explicit task boundaries while keeping
the existing Python cron scripts as the driver. A later Queue consumer should
reuse the same stages and idempotency keys instead of inventing a second model.

## Current Driver

- `scripts/old_word_pipeline.py` still runs sequentially under cron.
- `scripts/game_trend_scanner.py` still runs sequentially under cron.
- `scripts/precompute_shared_expand.py` still runs sequentially under cron and
  records all four shared-expansion task stages below.
- `scripts/pipeline_runtime.py` owns best-effort writes to:
  - `pipeline_runs`
  - `pipeline_tasks`
  - `pipeline_cost_events`
- D1 write failures must not break the business pipeline.

## Old Word Stages

| Stage | Unit | Idempotency key | Paid events |
| --- | --- | --- | --- |
| `old-word.seed` | one seed suggestion request | `keyword-suggestions:{query}:{limit}` | `dataforseo / keyword_suggestions` |
| `old-word.trends` | one 12-month trend request | `trends-quick-12m:{keyword}` | `dataforseo / trends_quick_12m` |
| `old-word.finalize` | one D1 save step | `save:{date}` | none |

## Game Trend Stages

| Stage | Unit | Idempotency key | Paid events |
| --- | --- | --- | --- |
| `game.trends-14d` | one 14-day trends batch | `trends-14d:{keyword_csv}` | `dataforseo / trends_14d` |
| `game.history-90d` | one 90-day historical baseline batch | `history-90d:{keyword_csv}` | `dataforseo / trends_history_90d` |
| `game.serp` | one SERP batch | `serp:{keyword_csv}` | `dataforseo / serp_organic` |
| `game.classify` | one final classification pass | `classify:{keyword_csv}` | none |

## Shared Expand Stages

| Stage | Unit | Idempotency key | Paid events |
| --- | --- | --- | --- |
| `shared-expand.expand-trends` | one shared expansion submission | `expand-trends:{keyword_csv}` | `dataforseo / expand_trends` |
| `shared-expand.llm-filter` | one LLM candidate batch | `llm-filter:{batch_index}` | `openrouter / chat_completions_llm_filter` |
| `shared-expand.compare-trends` | one shared comparison submission | `compare-trends:{benchmark}:{keyword_csv}` | `dataforseo / compare_trends` |
| `shared-expand.compare-intent` | one shared intent submission | `compare-intent:{benchmark}:{keyword_csv}` | `dataforseo / compare_intent_serp` |

Cost events should include `task_id` whenever a paid call happens inside a task.
This makes run-level cost reporting, task-level debugging, and future retry
logic line up on the same ledger.

`contracts/pipeline-contract-v1.json` is the runtime-neutral contract for the
TypeScript and Python implementations. It fixes the current status/stage
vocabulary and golden Run/Task/Cost keys. Migration 0019 also requires each
new cost event to state `credential_source` and `execution_mode`; current Cron
events default to `platform` and `platform`.

## Future Queue Message

```json
{
  "runId": "old-word-pipeline-...",
  "pipeline": "old-word-pipeline",
  "stage": "old-word.seed",
  "idempotencyKey": "keyword-suggestions:ai writer:20",
  "payload": {
    "seed": "writer",
    "query": "ai writer",
    "limit": 20
  },
  "attempt": 1,
  "maxAttempts": 3
}
```

## Invariants

- Student/API-key user paths stay cache-first and must not create paid provider tasks.
- Paid provider calls are recorded in `pipeline_cost_events` with a stable `event_key`.
- Cost totals sum each event as `actual_cost_usd ?? estimated_cost_usd`; a run
  with mixed actual and estimated events must not drop either part.
- Re-running a whole pipeline creates a new `run_id`; task idempotency is scoped to the run.
- A failed seed/trend task may be recorded as failed while the current cron driver continues.
- Queue consumers should claim/update `pipeline_tasks` before performing paid work.
