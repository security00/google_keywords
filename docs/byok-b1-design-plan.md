# BYOK B1 Provider Connection 设计计划

> 更新：2026-07-21
>
> 状态：B1.1-B1.4 已在隔离分支实现并通过本地完整验证；实际内部灰度仍待生产准入。
> 本文不构成任何生产部署授权。

## 1. 目标和非目标

B1 建立用户 Provider credential 的安全存储、owner-scoped 管理、轮换、删除、
验证状态和无敏感信息审计。首个内部灰度 Provider 为 OpenRouter。

B1 不包含 Student 实时研究入口、Private Cache 结果、BYOK Research Job、
`credential_source=user` Cost Event、DataForSEO 执行、多 LLM 适配器、任意 Base
URL、Queue/Workflow 或平台 Transport 替换。

## 2. 加密契约

权威决策见 [ADR-0008](adr/0008-provider-connection-envelope-encryption.md)：

```text
versioned Worker Secret KEK
  -> AES-KW unwrap per-connection DEK
    -> AES-256-GCM decrypt credential JSON
       AAD = encryption version + connection id + owner id + provider
```

Fingerprint 使用独立版本化 HMAC key，并绑定 owner/provider。明文 credential、DEK
和解密结果只存在于单次调用局部范围。

## 3. B1.2 Schema

迁移为 additive `migrations/d1/0020_provider_connections.sql`，创建：

- `provider_connections`：owner/provider、密文 envelope、KEK/fingerprint version、
  mask、credential version、验证状态和时间戳。
- `provider_connection_audit_events`：只保存 connection/owner/provider、受限 action、
  outcome、sanitized error code 和时间戳。
- `(owner_id, provider)` 唯一索引，以及 owner/update、audit owner/connection 索引。

Schema 不含 Base URL、明文 credential、Provider 请求/响应或软删除 ciphertext。
旧 Worker 忽略新表；Worker 回滚不删除 additive schema。如果将来存在真实 ciphertext，
应用回滚只关闭 feature 并 fail closed，不使用 `DROP TABLE`。

## 4. B1.2 Store 契约

- List 只选择 metadata 字段。
- Load 必须同时匹配 owner + connection id；按 Provider 查找必须匹配 owner + provider。
- Create 把 encrypted row 和 `created` audit 放入同一 D1 batch。
- Rotate 同时匹配 owner/id/provider/expected credential version，使用新 envelope，递增
  version，并清空旧验证结果。
- Delete 先从现存 owner-scoped row 生成无凭证 audit，再硬删除 live row；两个操作
  在同一 batch 中完成。
- Audit API 只接受枚举 action/outcome 和 `[A-Z0-9_]` sanitized error code。
- Store 错误只暴露稳定 code，不把 D1 原始错误传给未来 API。

## 5. B1.3 API 契约

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/provider-connections` | 当前 owner 的掩码元数据 |
| POST | `/api/provider-connections` | 创建连接，不回显 credential |
| PUT | `/api/provider-connections/{id}` | 轮换 credential/label，需要 expected version |
| DELETE | `/api/provider-connections/{id}` | 硬删除 live connection |

只允许 Cookie Principal + Effective Entitlement。所有 mutation 要求 same-origin、
8KB 流式大小限制和严格字段 schema；跨 owner 统一 404。普通 API Key 不因此获得
`provider:execute`。管理 feature 在 `wrangler.jsonc` 中默认关闭。低频 verify、限流
和内部 allowlist 属于 B1.4。

## 6. 权限与威胁控制

| 威胁 | 控制 |
| --- | --- |
| IDOR | owner 从服务端 Principal 取得；SQL owner + id 双条件 |
| D1 泄露 | per-row DEK；KEK/HMAC key 仅为 Worker Secret |
| 行交换 | AAD 绑定 owner/provider/connection/version |
| 日志泄露 | 稳定错误码；audit 不含 credential 或 Provider 正文 |
| 裸 fingerprint 关联 | owner/provider-scoped HMAC，不保存裸 hash |
| SSRF | schema/API 无 Base URL；Provider 工厂固定官方地址 |
| 并发覆盖 | `credential_version` 乐观并发控制 |
| 平台回退 | B2 用户客户端禁止 import/call platform getter |
| 删除后恢复 | live row 硬删除；restore 后运行删除对账 |

## 7. 测试和灰度

B1.2 必须覆盖 migration shape/constraint/index、D1 binding/batch、metadata 不选密文、
owner 条件、跨 owner miss、并发轮换、删除 audit、错误脱敏、TypeScript/Python 全量
测试、migration check、Student paid guard、Lint 和生产构建。

B1.3 已覆盖 API 身份、CSRF、body limit、严格 schema 和响应脱敏。B1.4 已覆盖
allowlist、持久化限流、固定 OpenRouter 官方端点 verify、KEK rewrap 和
restore/delete runbook；隔离分支已完成全量验证与完成审计。现有生产 smoke 永远不加入
真实 Provider 调用；生产准入仍须按灰度 runbook 单独执行。
