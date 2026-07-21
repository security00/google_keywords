# BYOK Provider 不确定结果对账 Runbook

BYOK Job 在外部请求发出前会从 `not_started` 原子切换为 `started`。一旦进入
`started`，系统不自动重领、不自动重试，避免因 Worker 中断或网络超时重复消耗用户额度。

## 识别

以下记录需要人工对账：

- `execution_mode='byok'`、`credential_source='user'`；
- `status='processing'`、`provider_request_state='started'`；
- `updated_at` 已超过正常 15 秒请求窗口；
- 没有 `completed`/`failed` 状态。

查询和导出只允许包含 job id、owner id、connection id/version、时间、状态和 Cost Event
聚合，不得包含 credential、prompt、Provider 正文或缓存结果。

## 对账顺序

1. 保持该 Job 不可重试，不修改 idempotency key。
2. 检查 `byok:{jobId}:openrouter:semantic-filter:v1` Cost Event 是否存在。
3. 检查该 owner 的 Private Cache 中是否存在 Job 的 result cache key；禁止读取 Shared Cache 代替。
4. 若 Private Cache 已有完整结果但 Job 未完成，可在受控修复工具中只修复 Job 引用和
   `completed` 状态，不再调用 Provider。
5. 若无结果或 Provider outcome 无法证明，终止为稳定的 `PROVIDER_OUTCOME_UNCERTAIN`；
   不猜测成功，不自动退款，也不自动再调用。
6. 用户确需重试时必须显式发起新操作，并产生新的受控请求边界；不得清除旧 checkpoint
   来复用原 Job。

## 立即停止条件

- 同一 Job 出现两个 Provider 请求或两个不同 event key；
- Cost Event 不是 `credential_source=user` / `execution_mode=byok`；
- 结果写入 Shared Cache，或其他 owner 能读取；
- 用户凭证失败后出现平台 OpenRouter 调用；
- 日志、错误、审计或 D1 出现凭证明文。
