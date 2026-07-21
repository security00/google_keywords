# BYOK 灰度与完整观察周期 Runbook

> 当前状态：仅完成代码与本地验证。本 runbook 不授权生产 Secret、远程 migration、推送、部署或开旗。

## 1. 灰度前置条件

- 当前 `main` 已完成既有 Shared Expansion 稳定观察，且 Cron/runtime 与仓库版本一致；
- B1-B3 全量测试、构建、依赖审计、migration 检查、student paid-provider guard 与
  `check:byok-isolation` 全部通过；
- 先应用 additive migrations，再部署同版本 Worker；
- 生产 KEK、fingerprint HMAC key 按 keyring runbook 注入，禁止写入仓库或普通环境变量；
- `BYOK_PROVIDER_CONNECTIONS_ENABLED=false` 与 `BYOK_LIVE_MODE_ENABLED=false` 保持关闭，
  allowlist 初始为空；
- 部署前记录 D1 Time Travel bookmark、当前 Worker version 和回滚目标。

## 2. 分阶段开门

### G0：部署但不开功能

只验证旧 Shared Cache、student、admin、Cron 和静态资源无回归。BYOK 路由必须返回功能关闭，
健康页面可以只读访问。至少观察一个 Cron 完整周期。

### G1：单维护者连接管理

只把一个维护者账号加入 allowlist，仅开启 Connection Management。完成 OpenRouter 与
DataForSEO 的创建、免费验证、轮换、删除、重新创建以及跨 owner 拒绝。此阶段不打开 Live Mode，
不产生付费 Provider 调用。

### G2：单维护者低预算 Live Mode

将 owner 日预算设为最小可验证额度、并发设为 1，再单独开启 Live Mode。按顺序验证：

1. Semantic Filter；
2. Trends；
3. SERP；
4. Expand；
5. Compare 完整成功；
6. Compare Partial Success 与只重试 intent；
7. 预算不足、并发冲突、过期报价、错误确认文本、credential version 变化。

每次只允许一个未完成动作。每个动作都必须核对 Job、Private Cache、Cost Event、quote/reservation
和 Provider 账单；禁止为了补数据自动重试 started checkpoint。

### G3：内部 allowlist 完整观察周期

扩展到 3-5 个内部账号，仍保持低预算与并发 1。完整观察周期定义为连续 7 个自然日，并且至少
覆盖 3 个有实际 BYOK 执行的日期、全部五类能力、一次拒绝路径和一次受控对账演练。若样本不足，
观察周期顺延，不因日历到期自动通过。

### G4：小比例已付费用户

只有 G3 验收通过并获得单独上线批准后才进入。仍使用 allowlist，不做全量开放；扩大范围、预算或
并发属于新的变更，不与首次灰度同时进行。

## 3. 每日证据

每天从 `/dashboard/admin/byok-health` 和 Provider 账单保存不含敏感信息的验收记录：

- connection 总数、有效验证数；
- 24h complete、partial、failed、stale 数；
- committed estimate 与 accounted cost；
- attribution mismatch、Shared Cache violation、orphan quote、missing cost event、missing event key；
- 每个 stale job 的处置结论与审计 event id；
- Provider 侧消费与站内 ledger 的差异说明；
- 预算、并发、过期报价和跨 owner 拒绝证据。

禁止保存 credential、ciphertext、wrapped DEK、完整 fingerprint、prompt、Provider 正文或缓存正文。

## 4. G3 通过标准

- 连续 7 日无 P0/P1 安全或成本事故；
- credential 泄漏、平台 credential fallback、跨 owner、Shared Cache 污染均为 0；
- attribution mismatch、missing cost event、missing event key、重复 event key 均为 0；
- 所有 committed quote 都能关联 owner-scoped Job，孤立报价为 0；
- 所有 stale checkpoint 在 24 小时内按对账 runbook 关闭，且没有重放 Provider；
- Provider 账单与 ledger 可逐项解释，实际费用不超过用户确认的保守报价；
- budget/concurrency/quote-expiry/version-conflict/CSRF 边界均有成功拒绝样本；
- Compare Partial Success 保留已付费数据，intent retry 没有第二次 DataForSEO 调用；
- Shared Cache 与现有 Student/Cron 路径无行为、成本和性能回归。

任一硬指标不满足，G3 重新计时；不能用“总体看起来正常”替代证据。

## 5. 停止与回滚

出现凭证泄漏、跨 owner、平台 fallback、Shared Cache 污染、无法解释的重复扣费或账单偏差时：

1. 立即将 `BYOK_LIVE_MODE_ENABLED` 关闭；必要时同时关闭 Connection Management；
2. 清空 allowlist，不删除用户 connection，不旋转或覆盖现场证据；
3. started checkpoint 按不确定结果 runbook 处理，禁止自动重试；
4. 保留审计与安全元数据，记录 Worker version、D1 bookmark 和事件时间线；
5. 只有根因修复、回归通过并获得新的灰度批准后才能重新开始 G2/G3。

应用回滚与 schema 回滚分开处理。additive migration 默认保留；除非明确证明 migration 本身导致事故，
不得在事故处理中删除 credential 或账本数据。
