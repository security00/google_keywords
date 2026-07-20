# 新会话交接：技术债收口、生产发布与 BYOK 前置状态

> 交接日期：2026-07-20（Asia/Shanghai）
>
> 项目：Discover Keywords
>
> 生产站点：<https://www.discoverkeywords.co>
>
> 生产基线：`main@1c1634f199abedb1839b04384049709b06a9285a`

## 1. 新会话如何开始

新会话先按以下顺序阅读，不要根据历史 `todo` 文档推断当前状态：

1. 本文。
2. [`../CONTEXT.md`](../CONTEXT.md)：领域术语和强制不变量。
3. [`adr/`](adr/)：已经确认的架构决策，尤其是 ADR-0001 至 ADR-0007。
4. [`../ARCHITECTURE.md`](../ARCHITECTURE.md)：当前实现快照。
5. [`execution-roadmap.md`](execution-roadmap.md) 和
   [`technical-debt-register.md`](technical-debt-register.md)：交付顺序、技术债状态和关闭条件。
6. [`deployment-runbook.md`](deployment-runbook.md)：PR、D1、部署、冒烟和回滚流程。

接手后的第一条建议指令：

> 阅读 `docs/session-handoff-2026-07-20.md`、`CONTEXT.md` 和相关 ADR，核对当前分支与生产状态，然后从“稳定观察与 BYOK 准入门”继续。不要立即编写 BYOK 代码。

## 2. 当前结论

- 技术债 D1-D6 的代码收口、迁移和生产发布已经完成。
- 学生端仍为 Shared Cache Mode，不会因页面点击触发平台付费 Provider。
- Admin/Cron 的 Platform Execution 保持可用；DataForSEO、OpenRouter、SERP、Trends、Expand 和 Compare 的现有平台路径没有被 BYOK 改写。
- Provider Transport 与纯业务核心已经分离，可为未来用户 Credential Source 复用；没有复制第二套业务流程。
- BYOK 尚未上线：没有用户 Provider Connection 表、密钥保存 API、BYOK Live Mode 路由或 UI。
- 生产 D1 迁移 `0016` 至 `0019` 均已应用。
- 当前 Worker 版本
  `3adcfc18-8ab2-454e-9b90-91af4925b099` 承载 100% 流量。
- 最新生产工作流和独立冒烟复验均通过：9 个路由、13 个首页引用静态资源。
- 当前线上观察正常，没有触发自动回滚。

## 3. 仓库、PR 与生产证据

### Git 基线

- 远程与本地生产基线：
  `main@1c1634f199abedb1839b04384049709b06a9285a`。
- PR #1：<https://github.com/security00/google_keywords/pull/1>
  - 合并提交：`47fcbe19873df8b9111e3d351a1da9ca5e382397`。
  - 内容：技术债收口、迁移 0016-0019、Provider 边界、Pipeline 契约、文档和 CI/CD。
- PR #2：<https://github.com/security00/google_keywords/pull/2>
  - 合并提交：`1c1634f199abedb1839b04384049709b06a9285a`。
  - 内容：精确兼容生产 `0019` 的历史 checksum，不修改生产 schema 或业务数据。
- 成功的生产工作流：
  <https://github.com/security00/google_keywords/actions/runs/29728979985>。

### Cloudflare 基线

- Worker：`google-keywords`。
- 当前部署 ID：`163d0ef3-c653-42f8-83d4-8b8f31cf44d5`。
- 当前版本：`3adcfc18-8ab2-454e-9b90-91af4925b099`，100% 流量。
- 合并前健康版本：`54604d83-bbc6-4a35-8878-55f3f9cf24e4`，可作为近期 Worker 回滚目标。
- 更早版本：`2991c277-d33c-4e0a-94f8-4b785658fda7`。
- GitHub Actions 所需 Secret 名称已经存在：`CF_API_TOKEN`、
  `CLOUDFLARE_ACCOUNT_ID`。值不可从 GitHub 回读，也不得写入文档或日志。
- 之前在会话中暴露过的 Cloudflare Token 已由用户轮换；不要恢复、引用或测试旧值。

### D1 基线

数据库名称：`ai-trends`。

| 迁移 | 名称 | 生产应用时间（UTC） |
| --- | --- | --- |
| `0016` | `api_key_security` | 2026-07-20 03:08:13 |
| `0017` | `research_job_execution` | 2026-07-20 03:08:14 |
| `0018` | `cache_namespaces` | 2026-07-20 03:08:15 |
| `0019` | `pipeline_cost_attribution` | 2026-07-20 03:08:15 |

`0019` 在第一次自动部署时出现历史 checksum 与仓库 canonical checksum
不一致。部署在 Worker 发布前安全停止，生产流量未改变。已经核对远程表的三个字段和两个索引与仓库迁移一致，随后通过严格的 checksum alias 修复：只有已知历史 hash 映射到当前精确 canonical hash 时才接受，其他差异仍 fail closed。不要直接修改生产 `schema_migrations` 账本。

## 4. 当前架构与不可破坏边界

项目是部署在 Cloudflare Worker 上的模块化单体：Next.js 16 App Router +
OpenNext + D1，外部 Python Cron 驱动三条正式 Pipeline。

必须保持：

1. Student 的 Shared Cache Mode 不得触发任何平台付费 Provider。
2. Platform Execution 只允许 Admin 或 Cron。
3. BYOK 必须由用户显式选择，使用 `user` Credential Source。
4. BYOK 结果只写 owner-scoped Private Cache；不得读取或污染 Shared Cache。
5. BYOK 失败不得回退到平台 DataForSEO/OpenRouter 凭证。
6. Research Job、Private Cache、Provider Connection 和 Cost Event 必须按用户隔离和归属。
7. 重试、轮询和重复回调不得重复计费。
8. 日志、错误响应、管理页面和遥测不得暴露用户或平台凭证明文。
9. 首批 LLM Provider 只允许 OpenRouter、OpenAI、DeepSeek、Gemini 官方地址，不允许任意 Base URL。
10. 当前 Python Cron 继续作为正式 Driver；不要在 BYOK 批次顺带引入 Queue/Workflow。

## 5. 本轮已经完成的工程工作

### CI 与运行时

- GitHub PR 只执行无生产 Secret 的完整校验和 Linux OpenNext 构建。
- `main` push 才进入 `production` 环境，按顺序执行：
  D1 bookmark → 迁移 dry-run → apply → 账本复核 → 100% Worker 发布 → 无费用冒烟。
- 冒烟失败且 Worker 已发布时自动执行 `wrangler rollback` 并复验。
- D1 Time Travel 恢复保持人工操作，因为它会覆盖数据库并取消在途查询。
- 静态资源采用 100% 原子式部署，避免未配置 version affinity 时的版本错配。

### Principal、Entitlement 与 API Key

- `authz.ts` 统一 Principal 与 Cron 验证，旧 `auth_middleware.ts` 已删除。
- `entitlements.ts` 汇总管理员、试用、订阅和课程授权。
- API Key 使用 hash、prefix/last4 掩码、Scope 和持久化失败限流。
- 普通 API Key 默认只有 `cache:read`，不能触发平台付费调用。

### Research Job、缓存与 D1

- Research Job 强制 owner + type，增加 execution mode、credential source、幂等键和原子 lease。
- 仓库内客户端已改用显式 POST 推进；带副作用 GET 仍处于兼容观察期。
- Shared/Private Cache 使用 namespace、version、scope、owner、完整 SHA-256 身份和显式 expiry。
- Private Cache 永不回退到旧 shared 格式。
- Expand/Compare 的 request-to-job 映射进入独立 `research_job_requests`。
- Worker 内 D1 只使用 Binding，Binding 缺失时 fail closed；REST 只留给外部脚本和运维。

### Provider 与 Pipeline

- DataForSEO 的官方端点、显式凭证、超时/重试和 JSON Transport 已进入适配器。
- Expand、Compare、SERP、Trends、关键词建议支持注入客户端，同时保留平台默认行为。
- OpenRouter 过滤和意图识别依赖通用 `ChatCompletionClient`；显式 `null` 只降级，不回退平台 LLM。
- TypeScript/Python 共用 `contracts/pipeline-contract-v1.json`。
- Pipeline Run/Task/Cost Event 已统一归属、Credential Source、Execution Mode 和幂等事件键。
- 管理健康页可见 stale run、orphan cost、缺失 event key 和逐事件成本汇总。

## 6. 仍未完成的 P0 稳定门

这些事项优先于 BYOK 实现：

1. 观察一个稳定窗口：Research Job lease、POST 执行、缓存命中/legacy fallback、Pipeline 成本事件完整率、stale run 和付费 Provider 错误。
2. 以 pending/expired Student 账户完成 Game 与 Old Keyword 页面/API 的端到端访问验证，确认仍为 cache-first。
3. 观察通过后关闭 `RESEARCH_STATUS_GET_EXECUTION_COMPAT`，确认 GET 完全只读。
4. 观察通过后关闭 legacy shared-cache 读取，再按“停止访问 → 观察 → 备份 → 独立迁移”清理旧数据。
5. 为 `main` 开启分支保护：必须通过 PR 和 `Quality gates and Linux build`；当前单人维护可先不要求审批。
6. `production` GitHub Environment 当前没有 reviewer/protection rule。若需要全自动部署可保持；若需要人工放行，应单独确认再配置。
7. 稳定门通过后，明确批准 BYOK implementation gate。

## 7. BYOK 建议实施顺序

不要复制现有 DataForSEO/OpenRouter/Expand/Compare 业务流程。复用已经提取的纯业务核心，新增旁路能力：

### B1：安全模型与 Provider Connection

- 新增 Provider Connection 数据模型和 D1 迁移。
- 记录 owner、provider、加密密文、密钥版本、mask/fingerprint、验证状态和时间戳。
- 设计服务端 envelope encryption 与密钥轮换；明文只在单次请求内短暂存在。
- API 只允许创建、验证、列出掩码信息、轮换和删除，永不返回明文。
- 增加跨用户越权、日志脱敏、错误脱敏和删除后不可用测试。

在确定加密/轮换方案前，建议新增 ADR，不要先建表保存凭证。

### B2：显式 BYOK 执行与客户端工厂

- 增加明确的 BYOK Live Mode 入口和 `provider:execute` 能力检查。
- 从当前 Principal 取得 owner，只加载该 owner 的 Provider Connection。
- 根据 Provider 创建官方适配器，注入现有 Expand/Compare/SERP/Trends/LLM 核心。
- 调用链必须显式传递 `execution_mode=byok`、`credential_source=user`、
  `owner_id` 和稳定幂等键。
- 用户凭证缺失、失效或调用失败时直接失败或 Partial Success，绝不调用平台凭证。

### B3：Private Cache、Job 与成本归属

- BYOK Research Job 必须 owner-scoped，并与 Shared Job 完全分离。
- 结果只写 Private Cache，建议默认 TTL 24 小时。
- Cost Event 记录 provider、operation、owner、user credential source、实际/估算用量和幂等事件键。
- 重试只能重试未完成阶段；DataForSEO 成功、LLM 失败时允许仅重试语义阶段。

### B4：渐进发布

- 先做 OpenRouter 或 DataForSEO 单 Provider、内部 allowlist/feature flag 灰度。
- 验证无平台回退、无跨用户读取、无重复计费和日志无明文后，再扩展其他 Provider。
- BYOK 冒烟必须使用专门测试账户和明确额度；现有生产 smoke 永远保持无费用。

## 8. 已知工作区状态与注意事项

- 本交接文档应位于独立分支 `codex/session-handoff-2026-07-20`，避免仅为文档触发一次生产部署。
- 工作区存在本地 Miniflare/D1 状态变化：`.wrangler/state/v3/d1/...sqlite`、
  `.sqlite-shm`、`.sqlite-wal`。它们不是本轮产品改动，不要提交、删除或还原，除非用户明确授权。
- `main` 当前尚未配置 branch protection。
- 现有兼容开关和 legacy cache 读取不能在没有观察证据时直接关闭。
- `serp_confidence_cache` 运行时封装已移除，但表仍保留；必须观察、备份后独立删除。
- sitemap/discovered-keyword 仍有活跃页面、路由、Cron、脚本和报表消费者，不能当作死代码删除。
- CrazyGames 的 curl subprocess 是已接受的隔离约束，不要在 BYOK 工作中顺带替换。

## 9. 常用无费用核验命令

```powershell
git status --short --branch
git fetch origin main
git rev-parse main
git rev-parse origin/main

npm test
npm run test:python
npm run check:student-paid-guards
npm run lint
npm run typecheck
npm run check:migrations
npm run check:cf-types
npm run check:audit
npm run smoke:production

npx wrangler deployments list --json --config wrangler.jsonc
npx wrangler d1 time-travel info ai-trends --config wrangler.jsonc
```

生产 smoke 只检查公开页面、匿名 Session、受保护端点拒绝状态和静态资源；不得添加 Research Job、Cron、DataForSEO、OpenRouter、SERP、Trends、Expand 或 Compare 的真实调用。

## 10. 下一会话建议输出

下一会话先完成只读稳定性审核并更新证据，然后给出 BYOK B1 的实施计划，至少包括：

- 新 ADR：凭证加密、密钥轮换和删除语义。
- D1 schema 草案及迁移/回滚边界。
- Provider Connection API 契约。
- 权限矩阵和威胁模型。
- DataForSEO/OpenRouter 客户端注入点清单。
- Private Cache/Research Job/Cost Event 数据流。
- 特征测试、隔离测试、幂等测试、脱敏测试和灰度方案。

计划经审核后再实现，不要在读取本文后立即修改生产路径。
