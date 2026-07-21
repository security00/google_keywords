# BYOK B0-B4 实施计划

> 更新：2026-07-21
>
> 当前状态：隔离分支开发已获批准；B1、B2 已本地实现；B3 的 DataForSEO 连接管理正在实现。生产 KEK、远程
> migration、BYOK API 启用、Live Mode 和生产部署仍未批准。

## 1. 不可破坏边界

1. Student 默认继续使用 Shared Cache Mode，不因页面点击调用平台或用户 Provider。
2. BYOK 必须由用户显式选择，并始终使用 `credential_source=user`。
3. BYOK 结果只属于当前 owner，只写 Private Cache，不读取或污染 Shared Cache。
4. 用户 credential 缺失、失效、超时或额度不足时不得回退平台 credential。
5. Provider Connection、Research Job、Private Cache、Task 和 Cost Event 全部按 owner
   隔离。
6. 重试、轮询、回调和重复提交不得造成重复计费。
7. 凭证明文不得进入 D1、日志、异常、审计、遥测、页面或 API 响应。
8. Provider 地址固定为仓库允许的官方地址，不保存或接受任意 Base URL。
9. 当前 Python Cron 继续作为正式 Driver；BYOK 不顺带引入 Queue/Workflow。

## 2. 阶段安排

| 阶段 | 目标 | 当前状态 | 完成定义 |
| --- | --- | --- | --- |
| B0 | 生产稳定与准入证据 | 开发准入已批准；生产观察继续 | Cron、成本、权限和稳定窗口证据闭环 |
| B1 | Provider Connection 安全管理 | 隔离分支已实现并通过本地验证，待审查 | crypto/store/API/隔离/删除/轮换内部灰度通过 |
| B2 | OpenRouter 单能力 Live Mode | 隔离分支已实现并通过本地验证，待审查 | user/byok Job、Private Cache、Cost 和零平台回退闭环 |
| B3 | DataForSEO 与完整实时研究 | 进行中：双 Provider 连接管理与免费验证已实现 | 双 Provider、预算、幂等、Partial Success 与账单对账通过 |
| B4 | 产品化灰度与稳定观察 | 未开始 | 无 P0/P1 安全或成本问题，runbook 可执行并明确验收 |

Rising Sites 排在 BYOK B1-B4 完整验收之后；PDR 产品融合排在 Rising Sites 的公开
MVP 和稳定榜单周期之后。

## 3. B1 — Provider Connection

B1 只建立安全保存和 owner-scoped 管理能力，不允许执行研究任务。

### B1.1 ADR + Crypto — 已完成

- ADR-0008 Accepted。
- AES-256-GCM 加密、随机 per-connection DEK、AES-KW 包装。
- AAD 绑定 connection、owner、provider 和 encryption version。
- 独立、版本化、owner/provider-scoped HMAC fingerprint。
- 错误密钥、错误版本、篡改和跨上下文替换全部 fail closed。
- 不连接 D1，不读取环境，不调用 Provider。

### B1.2 Schema + Store — 隔离分支已完成

- additive `0020_provider_connections.sql`。
- 完整保存 encryption/fingerprint/key/credential version。
- 元数据列表不选择 ciphertext、IV、wrapped DEK 或 fingerprint。
- 所有单条读取、轮换和删除同时匹配 owner 与 connection id。
- 轮换使用 `credential_version` 乐观并发控制并重置验证状态。
- 创建、轮换和删除与无敏感信息 audit event 使用 D1 batch 原子提交。
- 删除硬删除 live ciphertext；audit 不保留 credential、mask 或 Provider 正文。
- Feature 通过“无路由、无 API、无调用者”保持关闭。

### B1.3 Cookie-only API — 隔离分支已完成

- `GET/POST /api/provider-connections`。
- `PUT/DELETE /api/provider-connections/{id}`。
- 只允许 Cookie Principal + Effective Entitlement。
- Same-origin、8KB 流式请求限制、未知字段拒绝、跨 owner 404 和错误脱敏。
- API 只返回 mask/status/version/timestamp，永不返回加密字段或完整 fingerprint。
- `wrangler.jsonc` 中管理 feature 默认 `false`；没有生产 Secret 时不可启用。

### B1.4 Internal Gray — 隔离分支已实现，待审查

- 维护者/internal allowlist，先 CRUD、后低频 OpenRouter verify。
- 增加 `POST /api/provider-connections/{id}/verify`、owner/provider 限流和 sanitized
  verification code。
- 配置版本化 KEK/HMAC Secret；不写入仓库或 `wrangler.jsonc`。
- 演练 credential rotation、KEK rewrap、delete 和 D1 restore reconciliation。
- 旧平台路径和无费用 smoke 无回归；仍不允许 BYOK 执行研究。

## 4. B2 — OpenRouter 单能力 Live Mode

只选择一个低成本语义能力。用户明确选择 Live Mode 后，从当前 owner 的 connection
构造 `createOpenRouterClient()`，显式写入 `execution_mode=byok`、
`credential_source=user`、owner、connection version 和稳定幂等键。结果只写
Private Cache。测试必须证明 platform client 调用数和 shared cache 写入增量均为 0。

首个能力固定为最多 20 个关键词的低成本语义过滤。请求必须显式携带
`executionMode=byok`、OpenRouter connection id 与 expected credential version。
模型固定为 `google/gemini-2.5-flash-lite`，不读取或继承平台 OpenRouter 模型配置。
Job 在 Provider 调用前写入不可自动重领的 `started` checkpoint；超时或 Worker 中断
进入人工对账，而不是自动重复付费。结果 namespace 为 `byok-semantic-filter`，仅允许
Private owner scope；Cost Event 使用稳定 event key 并标记 `user/byok`。管理与 Live
Mode 使用两个独立、默认关闭的 feature flag。

## 5. B3 — DataForSEO 与完整研究链路

在 B2 独立稳定后增加 DataForSEO `{login,password}`，再逐个开放 Trends、SERP、
Expand、Compare。执行前显示成本估算并要求确认，配置 per-owner 预算和并发上限。
Provider task、轮询、回调、重试和 Cost Event 使用统一幂等边界；付费数据成功但
LLM 失败时返回 Partial Success，不重跑已经成功的付费阶段。

当前切片：DataForSEO 凭证使用与 OpenRouter 相同的 owner-scoped 加密 Store 和管理
API；验证固定调用官方免费的 `/v3/appendix/user_data`，不返回或保存账户资料，并复用
持久化 owner/provider 限流。预算门使用整数 micro-USD、owner 日预算、operator 上限、
并发上限和短期费用报价；只有请求哈希与报价金额完全匹配的显式 `CONFIRM` 才能原子
预留额度。任何付费研究调用仍未开放。

## 6. B4 — 灰度与验收

灰度顺序：维护者单账户 → internal allowlist 多账户/低预算 → 小比例已付费用户。
Live Mode 始终默认关闭。观测 connection CRUD/verify、BYOK Job、Private Cache、
Cost Event、预算阻断、跨 owner 拒绝、crypto/KEK 和恢复后删除对账。

## 7. 立即停止条件

- 凭证明文出现在 D1、日志、错误、审计、遥测或响应。
- 跨 owner 读取/修改/执行，或 BYOK 结果进入 Shared Cache。
- 用户凭证失败后读取平台凭证。
- 付费调用缺少 Job/Task/Cost 归因，或重复请求造成重复成本。
- KEK、轮换、删除或恢复行为无法解释。
- Cron/runtime 再次与仓库版本漂移。
