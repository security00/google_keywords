# SaaS Foundation Progress - 2026-04-28

这份记录用于留存本轮从 Python cron 向 SaaS 底层基座演进的实际改造范围。

## 已完成

- `scripts/pipeline_runtime.py` 已成为 Python cron 的轻量运行时边界，负责 `pipeline_runs`、`pipeline_tasks`、`pipeline_cost_events` 的 best-effort 写入。
- `scripts/old_word_pipeline.py` 已拆出显式任务阶段：
  - `old-word.seed`
  - `old-word.trends`
  - `old-word.finalize`
- `scripts/game_trend_scanner.py` 已拆出显式任务阶段：
  - `game.trends-14d`
  - `game.history-90d`
  - `game.serp`
  - `game.classify`
- 付费调用的成本事件已尽量关联到 `task_id`，便于从 run 追到 task，再追到 provider cost event。
- `game_trend_scanner.py` 会从本次 `pipeline_cost_events` 汇总 `estimated_cost_usd`，并把实际成本摘要写进 `pipeline_runs.metadata_json.cost`。
- 修复了 `game_trend_scanner.py` 的 SERP 多批处理问题：后续 batch 不再覆盖前面 batch 已写入的 SERP 字段。

## 验证记录

- `old_word_pipeline.py` 小批量 smoke 已验证成功：
  - run: `old-word-pipeline-20260427T194026Z-9715b287`
  - 3 个 task 成功写入
  - 2 条 cost event 关联到 task
  - 实际成本约 `$0.021`
- `game_trend_scanner.py` 最小付费 dry-run 已验证成功：
  - run: `game-trend-scanner-20260428T022820Z-23b9aadd`
  - `game.trends-14d` 和 `game.classify` 成功写入
  - `trends_14d` cost event 已关联 `task_id`
  - 实际成本 `$0.00225`
- 本地语法检查通过：
  - `python3 -m py_compile scripts/game_trend_scanner.py scripts/pipeline_runtime.py`

## 当前边界

- 现在仍然是 Python cron 驱动，不是 Cloudflare Queue consumer。
- `pipeline_tasks.idempotency_key` 目前按 `run_id` 作用域记录，主要解决单次 run 内的任务边界、状态和成本追踪；跨 run 的业务幂等仍需要各 pipeline 在业务表或 provider job/cache 层保证。
- `pipeline_runs` 只有 `estimated_cost_usd` 汇总列，实际成本暂存在 `metadata_json.cost.actual_cost_usd` 和 `pipeline_cost_events.actual_cost_usd`。
- D1 写入是 best-effort：账本失败不应中断主业务 pipeline。

## 后续建议

- 给 `pipeline_runtime.py` 增加一个通用 cost summary helper，减少各脚本自己查 `pipeline_cost_events`。
- 继续把 `precompute_shared_expand.py` 接入同一套 run/task/cost 边界。
- 等三个 Python cron 都完成任务边界后，再设计 Cloudflare Queues 消费者；不要先重写业务逻辑。
- 为 Queue 版本增加跨 run 业务幂等键，例如按 `pipeline + stage + normalized keyword + window + provider params` 生成全局 key。
- 在后台页面展示 run -> task -> cost event 的钻取链路，便于排查付费调用和失败重试。
