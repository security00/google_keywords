# BYOK UI/API 一体化实施证据（2026-08-02）

## 结论边界

- 分支：`codex/byok-pipeline-integration`
- 基线：`origin/main@94834fab6686d22f37f108ed985f2cc83c55f872`
- 状态：代码、本地 migration 测试、回归、生产构建、staging migration、staging Worker 部署和 Bearer API 付费 E2E 通过；UI 付费 E2E 触发的一条 Provider outcome uncertain 已通过受控管理员入口终止并留下审计记录。
- staging Worker 版本：初始关闭版 `95135438-d376-44c1-be3d-6e45897e282c`；临时开启版 `ce63904e-d8a8-4a94-84b9-68b7001dfe07`；重新关闭版 `593f8a1a-3a20-40e3-84d6-f1492cb62a15`。
- 未执行：生产 migration/部署、生产 Secret 修改、allowlist 扩大、预算或并发调整、G3 多账号灰度。
- 因此本文件不是 G2/G3 上线批准。

## 已完成能力

- 账号级 `shared | byok` 研究偏好，默认 `shared`。
- `gk_live_*` API Key 的独立 `byok:execute` scope。
- Cookie UI 与 Bearer API 共用 Expand/Compare 报价、父 Job、Private Cache 和结果类型。
- 多词根 Expand、OpenRouter 语义过滤、最多 50 词 Compare 自动分批。
- owner、权益、Live Mode、allowlist、双 Provider 验证、预算和并发准入。
- Quote/Execute 双阶段确认，请求内容和 `Idempotency-Key` 绑定。
- 并发 execute 使用 D1 batch 原子绑定 Quote 与父 Job，避免 orphan parent。
- Partial Success 返回失败阶段；重试必须重新报价和确认。
- 重试 Quote 将成功阶段设为不可计费并引用 owner-scoped 私有 checkpoint；只为失败阶段创建新 Provider 请求与 Cost Event。
- Compare intent Partial Success 只重新购买 OpenRouter intent 阶段，不重复 DataForSEO。
- Expand 重试复用成功语义决策，只过滤尚无决策的候选词。

## 本地验证

```text
TypeScript/Vitest: 64 files, 371 tests passed
Python unittest: 108 tests passed
Migration structure: 25 migrations passed
Student paid guard: passed
BYOK isolation guard: 39 production files passed
ESLint: 0 errors（仅仓库既有 warnings）
Next.js production build (webpack): passed
OpenNext Cloudflare production build: passed
```

完整 Vitest 默认集合中的两个 `origin/main` 部署测试在当前 Windows 环境导入带 shebang 的 `.mjs` 时发生 suite load SyntaxError：

- `lib/deployment/retain-production-static-assets.test.ts`
- `lib/deployment/smoke-production.test.ts`

这两个 suite 未执行断言；其余 371 个测试通过。生产构建已覆盖相应 Next.js 路由生成。

## Staging 验证

- migration `0025_byok_pipeline_integration.sql` 已应用到独立 D1 `ai-trends-staging`，migration ledger checksum 为 `06f60b330e86702293125290078213d85531ad15ff817dbf3bdab8eef97bb5c2`。
- staging Worker 为 `google-keywords-staging`，绑定独立 D1 `530bee1f-a79b-4511-be98-d339c160df94`。
- `BYOK_LIVE_MODE_ENABLED=false`；allowlist 保持单维护者账号；日预算 `$1`、最大并发 `1` 未调整。
- DataForSEO 与 OpenRouter Provider Connection 均为 `valid`；核对仅使用 masked 元数据，未读取凭证明文或加密字段。
- 单维护者账号通过 Cookie-only 设置页创建了专用 API Key `gk_live_f7f3…0901`，scope 为 `cache:read` 与 `byok:execute`；完整 Key 未写入文件、命令行、日志或本文档。
- 无会话冒烟：`/`、`/login`、`/api/auth/session` 正常；`/api/me` 与 shared history 拒绝未授权请求；BYOK readiness 返回 `FEATURE_DISABLED`。
- shared 模式默认值、原 API 路由和请求适配由回归测试覆盖；本次 migration 未更新 Shared Cache 或已有 shared 研究记录。
- staging 账本核对：platform fallback、attribution mismatch、Shared Cache violation、orphan quote、missing event key、duplicate event key、missing Cost Event 均为 `0`。

### 单维护者 API E2E

- 临时开启 Live Mode 时仍仅允许 owner `2963cf41-05e6-4ac1-b2ee-d204bb73c030`，日预算 `$1`、并发 `1`。
- readiness 返回双 Provider 已验证、预算剩余 `$1`、并发可用。
- Expand 报价 `0ecb3d74-5a27-4759-90ba-2856e7d30743`：汇总上限 `$0.016`，DataForSEO `$0.011`、OpenRouter `$0.005`，内部批次 `6`。
- execute 父 Job `b5e4b3d2-ae14-4130-a46c-22a80ce3388c` 完成 `3/3` 阶段，输出 `28` 个候选词；history 的 `operation=expand`、`status=complete`、`executionSource=byok` 和父 Job 一致。
- 账本包含一条 DataForSEO Expand Cost Event（实记 `$0.011`）及两条 OpenRouter Semantic Filter Cost Event（实记 `$0.0002519`、`$0.0001205`）；全部为 owner-scoped、`credential_source=user`、`execution_mode=byok` 和 Private Cache。

### 单维护者 UI E2E

- UI 保留原“我的 Key 实时结果”入口、原按钮和原进度组件，仅出现一次汇总费用确认；输入单词根 `aitool` 后，后台汇总报价为 `$0.016`。
- 父 Job `af60b842-9fde-49e9-8127-6865c31501cc` 创建成功；DataForSEO Expand 子 Job `645ccdb3-313a-404b-afd9-c8c858ef40d9` 在 `provider_request_state=started` 后 Worker 中断。
- 子 Job 无 Private Cache、无 Cost Event；系统没有自动重领或重试，最近 7 天对账正确分类为 `provider_outcome_uncertain`，估算 `$0.011`、实记 `$0`。
- 该调用未被猜测为成功、未自动退款、未再次调用 Provider。管理员通过 `mark_uncertain` 将子 Job 稳定终止为 `failed/PROVIDER_OUTCOME_UNCERTAIN`；审计事件的 actor、owner、原 `updated_at` 和结果状态均匹配。
- 对账后 stale、platform fallback、attribution mismatch、Shared Cache violation、orphan quote、missing event key、duplicate event key、missing Cost Event 全部为 `0`。另保留 `1` 条 uncertain-without-cost-event 分类，这是本次无法证明 Provider 结果的预期状态，不得伪造 Cost Event。
- 验证结束后 staging Live Mode 已关闭，匿名 readiness 返回 `404 FEATURE_DISABLED`。

### 父 Job 级联对账与 UI 成功补测

- 初次 uncertain 子 Job 的父步骤曾遗留为 `processing` 且缺少 `child_job_id`。管理员入口现可通过直接子 Job 关联或聚合 Quote 的 `child_quotes_json` 关联发现该父管线，并在同一个 D1 batch 中终止子 Job、父步骤、父 Job 与聚合 Quote；不调用 Provider、不清除 checkpoint。
- 受控对账后，父步骤 `expand:0`、父 Job `af60b842-9fde-49e9-8127-6865c31501cc` 和聚合 Quote `d0882c4a-0894-474b-be8e-589b7249e7a9` 均为 `failed/PROVIDER_OUTCOME_UNCERTAIN`，第二条审计事件保留原 `updated_at`，活动并发计数恢复为 `0`。
- 管理员对账确认改为站内可访问对话框，仍需两次显式点击；确认文案明确说明不会重放 Provider。
- 经用户明确授权后，在 staging 单 owner、日预算 `$1`、并发 `1` 下临时开启 Live Mode，使用全新单词根 `aidesign` 完成 UI Expand。父 Job `eedb6cd6-73a8-462d-8ca4-edc57e60d0b5` 与 DataForSEO 子 Job `6f242c96-7ea5-4891-a30a-93f8455fd78b` 均为 `complete`。
- 页面沿用原入口、原“获取候选词”按钮、原进度和原“第二步：人工筛选”页面；除一次汇总费用确认外没有新增后续操作。本次 Provider 返回 `0` 个候选词，因此 Compare 按原规则禁用，而不是产生新的 BYOK 专属步骤。
- 本次实际 Cost Event 为 DataForSEO `$0.011`，`credential_source=user`、`execution_mode=byok`、owner 与 Job 一致；父结果写入 `byok-pipeline-expand` owner-scoped Private Cache。
- 补测后 platform fallback、attribution mismatch、Shared Cache violation、orphan quote、missing event key、duplicate event key、missing Cost Event、active Job 全部为 `0`。
- staging 已重新部署 Live Mode off 版本 `3d14c934-bf26-4235-a45f-9e56d756a278`（100%）；匿名 readiness 再次返回 `404`。

### 可控 Partial Success 回归

- 在 Live Mode 关闭状态下运行 `lib/byok/pipeline.test.ts` 与 `lib/byok/compare.test.ts`，共 `9` 个测试通过，未调用真实 Provider。
- 可控故障覆盖两个 Compare 批次中一个成功、一个失败：retry quote 只重新报价失败批次，成功批次保持原 quote、`chargeable=false` 并引用原 `checkpointJobId`。
- DataForSEO Compare 已成功但 OpenRouter intent 失败时，retry quote 仅包含 OpenRouter `$0.001`；DataForSEO 费用为 `$0`，且不会创建新的 DataForSEO Provider 调用。

## 下一门禁

1. 当前分支的 UI/API 共用管线、父 Job 对账补偿与单维护者 staging 成功证据已闭环；代码完成不构成生产 G2/G3 上线批准。
2. 下一步先完成分支审阅、合并与既定生产 G2 门禁复核；不得因 staging 通过而修改生产 Worker、Secret、allowlist、预算或并发。
3. G3 仍需另行授权并准备 3–5 个内部账号，连续 7 个自然日同时覆盖 UI 与 API；在该批准前保持现有生产范围，不进入 G4 或全量开放。
