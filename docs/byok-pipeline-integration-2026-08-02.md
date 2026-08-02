# BYOK UI/API 一体化本地实施证据（2026-08-02）

## 结论边界

- 分支：`codex/byok-pipeline-integration`
- 基线：`origin/main@94834fab6686d22f37f108ed985f2cc83c55f872`
- 状态：代码、本地 migration 测试、回归和生产构建通过。
- 未执行：远程 migration、Worker 上传/部署、生产 Secret 修改、allowlist 扩大、预算或并发调整、付费 Provider E2E。
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
```

完整 Vitest 默认集合中的两个 `origin/main` 部署测试在当前 Windows 环境导入带 shebang 的 `.mjs` 时发生 suite load SyntaxError：

- `lib/deployment/retain-production-static-assets.test.ts`
- `lib/deployment/smoke-production.test.ts`

这两个 suite 未执行断言；其余 371 个测试通过。生产构建已覆盖相应 Next.js 路由生成。

## 下一门禁

1. 在非生产 D1 应用 migration 0025，并再次运行 schema/migration ledger 校验。
2. 保持单维护者 allowlist、预算和并发不变，验证 shared UI 请求未改变。
3. 使用专用低预算账号验证 UI 与 API 的 quote → execute → poll → result → history。
4. 注入一次可控 Partial Success，验证 retry quote 只包含失败阶段费用，并核对成功 DataForSEO Event Key 未增加。
5. 核对 platform fallback、attribution mismatch、Shared Cache violation、orphan quote、missing/duplicate event key、missing Cost Event 全部为 0，之后才可正式收口 G2。
