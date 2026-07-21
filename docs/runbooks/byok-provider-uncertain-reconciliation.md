# BYOK Provider 不确定结果对账 Runbook

BYOK Job 在外部请求发出前会从 `not_started` 原子切换为 `started`。一旦进入
`started`，系统不自动重领、不自动重试，避免因 Worker 中断或网络超时重复消耗用户额度。

## 识别

以下记录需要人工对账：

- `execution_mode='byok'`、`credential_source='user'`；
- `status='processing'`、`provider_request_state='started'`；
- `updated_at` 已超过正常 15 秒请求窗口；
- 没有 `completed`/`failed` 状态。

`pending/not_started` 不代表 Provider outcome 不确定，执行重试可以继续原子 claim 同一 Job；这用于
恢复 Worker 在创建 Job 或提交报价后、写入 `started` checkpoint 前中断的安全窗口。只有
`processing/started` 才禁止自动重领并进入本 runbook 的人工对账。

查询和导出只允许包含 job id、owner id、connection id/version、时间、状态和 Cost Event
聚合，不得包含 credential、prompt、Provider 正文或缓存结果。

## 对账顺序

1. 保持该 Job 不可重试，不修改 idempotency key。
2. 按能力检查稳定 Cost Event key，且事件必须绑定相同 job、owner，并标记为
   `credential_source=user` / `execution_mode=byok`：
   - Semantic Filter：`byok:{jobId}:openrouter:semantic-filter:v1`；
   - Trends：`byok:{jobId}:dataforseo:trends:v1`；
   - SERP：`byok:{jobId}:dataforseo:serp:v1`；
   - Expand：`byok:{jobId}:dataforseo:expand:v1`；
   - Compare 数据阶段：`byok:{jobId}:dataforseo:compare:v1`；
   - Compare 意图阶段：`byok:{jobId}:openrouter:compare-intent:v1`；
   - Compare 意图单独重试：`byok:{jobId}:openrouter:compare-intent-retry:v1`。
3. 检查该 owner 的 Private Cache 中是否存在 Job 的 result cache key；禁止读取 Shared Cache 代替。
4. 若 Private Cache 已有完整结果但 Job 未完成，可在受控修复工具中只修复 Job 引用和
   `completed` 状态，不再调用 Provider。
5. 若无结果或 Provider outcome 无法证明，终止为稳定的 `PROVIDER_OUTCOME_UNCERTAIN`；
   不猜测成功，不自动退款，也不自动再调用。
6. 用户确需重试时必须显式发起新操作，并产生新的受控请求边界；不得清除旧 checkpoint
   来复用原 Job。

## 受控运维入口

管理员只读健康入口为 `GET /api/admin/byok-health`。它只返回连接、任务、成本汇总、
对账分类与安全元数据，不返回 credential、prompt、Provider 正文或缓存结果。

状态修复使用同源、管理员 Cookie 请求调用 `POST /api/admin/byok-health`，请求必须精确包含
`ownerId`、`jobId`、作为乐观并发前置条件的 `expectedUpdatedAt`，以及仅可取
`complete_from_private_cache` 或 `mark_uncertain` 的 `action`。

`complete_from_private_cache` 只有在任务仍处于超过 5 分钟的 `processing/started` 状态、
owner-private BYOK namespace 中存在未过期且结构符合对应能力的数据、相同 job/owner 存在该
能力精确稳定 event key 的 user/byok Cost Event 时才允许执行。`mark_uncertain` 只把任务终止为
`PROVIDER_OUTCOME_UNCERTAIN`。两种动作都不会调用 Provider，也不会清除 checkpoint；状态更新和
不含敏感信息的管理员审计事件使用 D1 batch 原子提交。

## 立即停止条件

- 同一 Job 出现两个 Provider 请求或两个不同 event key；
- Cost Event 不是 `credential_source=user` / `execution_mode=byok`；
- 结果写入 Shared Cache，或其他 owner 能读取；
- 用户凭证失败后出现平台 OpenRouter 调用；
- 日志、错误、审计或 D1 出现凭证明文。
