# BYOK 本地实现完成证据

> 审计日期：2026-07-21
>
> 审计范围：`codex/byok-b1-provider-connections` 相对 `origin/main` 的隔离实现。
>
> 结论边界：B1-B3 功能和 B4 代码侧灰度工具已完成本地实现；生产 migration、Secret、部署、
> 开旗和连续观察不在本结论内，仍需单独授权并执行灰度 runbook。

## 1. 需求到证据

| 计划要求 | 实现证据 | 验证证据 | 结论 |
| --- | --- | --- | --- |
| B1 信封加密、AAD、HMAC fingerprint、fail closed | `lib/provider-connections/credential-crypto.ts`、ADR-0008 | `credential-crypto.test.ts` | 完成 |
| B1 owner-scoped Store、轮换、硬删除与无凭证审计 | `store.ts`、migration 0020 | `store.test.ts`、`test_d1_migration_0020.py` | 完成 |
| B1 Cookie-only API、same-origin、8KB、严格 schema、404 IDOR | Provider Connection routes 与 `api.ts` | `provider-connections/route.test.ts`、`provider-connections/api.test.ts` | 完成 |
| B1 allowlist、限流、官方免费验证、KEK rewrap | `verification.ts`、`verification-rate-limit.ts`、`keyring.ts` | 对应 3 组单元测试及 key/delete runbook | 完成 |
| B2 固定 OpenRouter 模型、最多 20 词、user/byok Job | `lib/byok/semantic-filter.ts` | `semantic-filter.test.ts` | 完成 |
| B2 started checkpoint、Private Cache、稳定 Cost Event、零平台回退 | `research-jobs.ts`、migration 0022 | semantic/filter、research-jobs、migration 0022 测试 | 完成 |
| B3 DataForSEO 加密连接与免费验证 | Provider Connection service/verification | service、verification、route 测试 | 完成 |
| B3 owner 预算、并发、短期报价、精确 CONFIRM | `spend-controls.ts`、migration 0023 | `spend-controls.test.ts`、`test_d1_migration_0023.py` | 完成 |
| B3 Trends 固定配置、报价确认、Private Cache、Cost Event | `lib/byok/trends.ts` | `trends.test.ts` 与 route test | 完成 |
| B3 SERP 固定 US/en/desktop/depth 10 | `lib/byok/serp.ts` | `serp.test.ts` 与 route test | 完成 |
| B3 单种子 Related Queries Expand | `lib/byok/expand.ts` | `expand.test.ts` 与 route test | 完成 |
| B3 Compare、Partial Success、intent-only retry | `lib/byok/compare.ts` | `compare.test.ts` 与 route test | 完成 |
| B3 重复提交不重复计费 | quote owner/idempotency 唯一约束、Job claim、Cost event key | spend、Job、各能力测试 | 完成 |
| B4 隔离静态守卫 | `scripts/check_byok_isolation.py`、deploy workflow | 本地/CI `check:byok-isolation` | 完成 |
| B4 健康、对账、stale job 受控恢复 | `lib/byok/operations.ts`、admin API/page、migration 0024 | operations、route、migration 0024 测试 | 完成 |
| B4 灰度顺序、7 日观察、停止与回滚 | `runbooks/byok-gray-rollout.md` | 只能在获批生产灰度后形成运行证据 | 待上线阶段执行 |

DataForSEO 首批能力全部使用官方 Live endpoint，因此不存在异步 Provider task 轮询或回调；
本实现用 owner-scoped Research Job、不可重领 checkpoint、quote reservation 和 Cost Event 作为
统一幂等边界。未来若改用 Standard task/postback，必须另行增加 owner-scoped Provider task 与
callback 幂等设计，不能复用当前 Live endpoint 假设。

## 2. 强制不变量审计

- Shared Student 路由未改为实时付费；`check:student-paid-guards` 继续通过。
- BYOK API 要求 Cookie Effective User、allowlist、显式 `executionMode=byok`；mutation 要求同源。
- 用户 Provider credential 失效时直接失败；生产 BYOK 模块静态禁止平台 getter 和平台 Secret。
- 所有 BYOK 结果使用 owner-private `byok-*` namespace，`allowLegacyRead=false`。
- Cost Event 均关联 Research Job、owner、稳定 event key，并标记 `user/byok`。
- Provider Connection、Job read/write、Private Cache 和恢复动作均以服务端 owner 为条件。
- Provider 地址与模型由服务端固定；API schema 不接受 Base URL。
- 所有携带用户凭证的付费调用禁用自动重试，并拒绝 HTTP 重定向。
- credential、Provider 正文与缓存正文不进入 audit/health/recovery 响应。

## 3. 本地完成门

交付前必须在当前 HEAD 重新通过：

```text
npm test
npm run test:python
npm run typecheck
npm run lint
npm run check:migrations
npm run check:student-paid-guards
npm run check:byok-isolation
npm run check:cf-types
npm run check:audit
npm run build
```

允许保留的唯一 lint 输出是仓库既有 warning；BYOK 新增文件不得产生 error 或 warning。

2026-07-21 当前 HEAD 的执行结果：

- TypeScript：61 个文件、340 项测试通过；
- Python：105 项测试通过；
- Typecheck 与生产构建通过；
- D1：24 个迁移结构检查通过；
- Student 付费边界、BYOK 隔离守卫、Cloudflare 类型检查通过；
- `npm audit --audit-level=high`：0 vulnerabilities；
- ESLint：0 error，16 个仓库既有 warning，BYOK 新增文件无 warning。

## 4. 不属于“本地开发完成”的事项

- 向生产配置 KEK/HMAC Secret；
- 执行远程 migrations 0020-0024；
- 合并、推送或部署该分支；
- 开启 Connection Management 或 Live Mode；
- 产生真实用户 Provider 费用；
- 宣称 B4 连续 7 日灰度已经通过。

以上事项必须等待现有生产稳定周期完成，并获得新的上线授权。
