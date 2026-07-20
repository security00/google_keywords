# ADR-0007：保留 Python Driver，暂缓 Queue/Workflow

- 状态：Accepted
- 日期：2026-07-20

## 决策

近期继续由现有 Python Cron 驱动共享扩展、老词和游戏管线；先统一 Pipeline Run、Task、Cost Event、幂等键和失败隔离。Cloudflare Queues/Workflows 暂不部署。

TypeScript 与 Python 通过共享数据契约和固定样本保持一致，不以整体改写为前提。

## 影响

- D1 账本失败不得中断业务管线，但必须产生可见的可观测性降级状态。
- 未来 Queue Consumer 必须复用既有 Task 模型并保留 Cron 回滚路径。
- CrazyGames curl 依赖作为隔离且受监控的外部约束处理。
