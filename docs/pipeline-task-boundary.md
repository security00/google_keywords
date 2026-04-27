# Pipeline Task Boundary

This project is currently Cloudflare-first but keeps pipeline core logic portable.
The near-term migration path is to record explicit task boundaries while keeping
the existing Python cron scripts as the driver. A later Queue consumer should
reuse the same stages and idempotency keys instead of inventing a second model.

## Current Driver

- `scripts/old_word_pipeline.py` still runs sequentially under cron.
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

Cost events should include `task_id` whenever a paid call happens inside a task.
This makes run-level cost reporting, task-level debugging, and future retry
logic line up on the same ledger.

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
- Re-running a whole pipeline creates a new `run_id`; task idempotency is scoped to the run.
- A failed seed/trend task may be recorded as failed while the current cron driver continues.
- Queue consumers should claim/update `pipeline_tasks` before performing paid work.
