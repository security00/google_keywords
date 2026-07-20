# Discover Keywords 当前架构

> 更新时间：2026-07-20
> 本文描述已经存在的实现，不把 BYOK 或未来 Queue 当作已上线能力。领域术语和强制不变量以 [CONTEXT.md](./CONTEXT.md) 为准。

## 1. 架构结论

项目当前是部署在 Cloudflare Worker 上的**模块化单体**：

- Next.js 16 App Router 同时承载页面和 Route Handler。
- OpenNext 将应用构建为 Cloudflare Worker。
- Cloudflare D1 是线上业务数据、认证数据、缓存和 Pipeline 账本的来源。
- Python Cron 脚本在 Worker 外执行预计算、游戏扫描和老词管线。
- DataForSEO 与 OpenRouter 是当前真实计费 Provider。

宏观边界清楚：学生消费共享缓存，管理员/Cron 执行平台计费，D1 连接前台与后台。微观上仍存在认证、异步 Job、缓存语义、Provider 传输和双运行时契约不统一的问题，统一记录在 [技术债台账](./docs/technical-debt-register.md)。

## 2. 系统拓扑

~~~mermaid
flowchart LR
    Student["Student 浏览器/API"] --> Worker["Next.js + OpenNext Worker"]
    Admin["Admin 浏览器/API"] --> Worker
    Cron["Python Cron / Watchdog"] --> Worker
    Cron --> D1Rest["D1 REST（外部脚本）"]

    Worker --> D1["D1 Binding"]
    Worker --> Assets["静态 Assets"]

    Cron --> DFS["DataForSEO"]
    Cron --> OR["OpenRouter"]
    Worker --> DFS
    Worker --> OR
    Sources["Steam / 游戏站 / HN / GitHub"] --> Cron

    DFS --> Webhook["DataForSEO Webhook"]
    Webhook --> Worker
~~~

当前 **lib/d1.ts** 只使用由 Wrangler 生成类型的 `DB` Binding。Worker 中 Binding 不可用时直接失败，不会读取 Cloudflare 控制面 Token，也不会回退到 REST API；外部 Python 脚本继续使用各自隔离的 REST 客户端。

## 3. 运行边界

### 3.1 Student：共享缓存

~~~mermaid
sequenceDiagram
    participant U as Student
    participant API as Research API
    participant C as Shared Cache
    participant P as Paid Provider

    U->>API: 研究请求
    API->>API: 认证、权益和输入校验
    API->>C: 查询共享结果
    alt 命中
        C-->>API: 预计算结果
        API-->>U: 返回结果
    else 未命中
        API-->>U: 未就绪或安全降级结果
    end
    Note over API,P: Student 路径不得调用平台付费 Provider
~~~

**scripts/check_student_paid_guards.py** 是该业务不变量的静态守卫。现有 Research Route 仍需逐步统一身份、权益和 Job 所有权，但任何收口都不能改变“学生点击不计费”。

### 3.2 Admin/Cron：平台执行

Admin 或 Cron 可以使用平台环境变量中的 Provider 凭证执行真实请求。典型流程：

1. 受权主体创建或推进 Research Job/Pipeline Task。
2. DataForSEO 接收异步任务，回调进入 **/api/research/webhook**。
3. 服务端解析结果，执行规则过滤、OpenRouter 语义过滤、SERP/Trends 处理。
4. 结果进入共享缓存或正式业务表。
5. Python Pipeline 将 Run、Task 和 Cost Event 以 best-effort 方式写入账本。

当前代码中部分状态 GET 同时承担“查询”和“推进”职责。ADR-0003 要求在兼容迁移后将 GET 变为只读，并由显式执行入口调用统一幂等执行器。

### 3.3 BYOK：尚未上线

BYOK 将在技术债稳定后作为旁路接入：

- 用户显式选择 BYOK Live Mode。
- 使用加密的用户 Provider Connection。
- 复用平台链路提取出的纯业务核心，不复制规则、解析和结果合并逻辑。
- 只写 Private Cache，默认 24 小时。
- 失败不回退平台凭证。

完整顺序见 ADR-0006；在 BYOK 上线前，Credential Source 为 user 的请求不应出现在真实 Provider 调用中。

## 4. 三条业务 Pipeline

| Pipeline | Driver | 主要输入 | 主要输出 |
| --- | --- | --- | --- |
| Shared Expansion | **scripts/precompute_shared_expand.py** | 种子词、DataForSEO 扩展、LLM/SERP/Trends | 学生共享候选结果 |
| Old Keyword | **scripts/old_word_pipeline.py** | 成熟词池、趋势、搜索量、竞争度、社区信号 | 老词机会 |
| Game Discovery | **scripts/game_trend_scanner.py** 等 | Steam、CrazyGames、Poki、itch.io、趋势和 SERP | 游戏词机会 |

Python Cron 目前仍是正式 Driver。**pipeline_runs**、**pipeline_tasks** 和 **pipeline_cost_events** 是统一运维边界；Queue/Workflow 仅是未来可能的 Driver，不得另建任务模型。

## 5. Next.js 模块边界

### 页面

- **app/dashboard/**：学生研究、候选、游戏、老词和设置。
- **app/dashboard/admin/**：用户、健康、Pipeline、来源质量和机会运营。

### API

- **app/api/auth/**：Cookie Session、Google OAuth、API Key 和访问状态。
- **app/api/research/**：Expand、Compare、Intent、SERP、Trends、Session、Webhook。
- **app/api/admin/**：管理员运营、健康检查和 Pipeline 可见性。
- **app/api/billing/**：Stripe 订阅和 Webhook。

### 领域与基础设施

| 模块 | 当前职责 | 已知过渡边界 |
| --- | --- | --- |
| **lib/auth.ts**、**authz.ts**、**entitlements.ts** | Session、API Key、Principal、集中式 Cron 授权和 Effective Access | 观察并退役显式开启的 Query Key 兼容选项 |
| **lib/research-jobs.ts** | owner/type 强制查询、执行模式、凭证来源、幂等键和原子执行租约 | 迁移上线后关闭带副作用 GET 兼容开关；提交阶段使用稳定幂等键 |
| **lib/cache.ts** | 版本化 shared/private 结果缓存 | 0018 上线观察后关闭 legacy shared 读取 |
| **lib/d1.ts** | D1 查询 | Worker binding-only；外部 REST 分离 |
| **lib/providers/dataforseo.ts**、**json-http.ts** | DataForSEO 官方端点、显式凭证与有界重试/超时 Transport | 平台默认与未来用户 Credential Source 由调用方显式选择 |
| **lib/expand/**、**compare/**、**serp.ts** | 可注入 DataForSEO Client 的请求流程与纯响应解析 | 保留现有平台默认；BYOK 旁路复用同一核心 |
| **lib/providers/llm.ts**、**openrouter.ts**、**ai-intent.ts** | 通用 Chat Completion 接口、OpenRouter 平台适配器、过滤和意图纯解析 | 后续增加 OpenAI/DeepSeek/Gemini 官方适配器，不接受任意 BYOK Base URL |
| **lib/pipelines/**、**scripts/pipeline_runtime.py** | TypeScript/Python Run/Task/Cost 账本、归属和幂等键 | 共用 `contracts/pipeline-contract-v1.json`；0019 上线后观察异常指标 |

## 6. 认证、权益与计费授权

当前认证入口：

- Cookie Session：浏览器。
- Authorization Bearer gk_live Key：API 客户端。
- x-cron-secret 或受控 Bearer Secret：Cron。
- URL Query API Key：遗留兼容能力，文档已停止推荐，按 ADR-0002 退役。

当前 **authz.ts** 是 Principal 与 Cron 的唯一实现；旧的 **auth_middleware.ts** 已删除。共享研究入口通过 **requireEffectiveUser()** 和 **checkEffectiveAccess()** 汇总管理员、课程试用、Stripe 订阅和每日配额。Query Key 默认关闭，仅在尚处于兼容观察期的旧接口显式开启。统一调用顺序为：

~~~text
Request
  -> authenticate -> Principal
  -> resolve entitlement -> Effective Entitlement
  -> authorize capability/scope
  -> execute cache or provider path
~~~

API Key 现在使用 SHA-256 **key_hash** 验证，列表只返回 prefix/last4 掩码，新 Key 默认只有 **cache:read** Scope。迁移 0016 增加持久化失败限流；必须先迁移再发布依赖新列的代码。旧表的 NOT NULL **key** 列仍写入 **hash:<hash>** 占位值，属于待迁移 schema 债务，不等于系统仍用明文验证。

## 7. Research Job 与回调

**research_jobs** 当前覆盖 expand、compare、intent 和 trends，状态包括 pending、processing、complete、failed。用户路径必须同时匹配 owner 和 job type；只有 Cron finalize 使用显式内部读取。迁移 0017 为 Job 增加 execution mode、credential source、idempotency key、claim token、lease 和 attempt。

前端与仓库内脚本已经使用 POST 推进任务，重复 POST 通过原子租约避免并发执行。为避免直接破坏旧集成，带副作用 GET 暂时由 **RESEARCH_STATUS_GET_EXECUTION_COMPAT=true** 保留并记录结构化遥测；关闭该开关后 GET 只返回 D1 状态快照。迁移 0018 使用独立的 **research_job_requests** 保存 owner/type 范围内的请求到 Job 映射，结果缓存不再写入 Job ID；旧共享 Job 缓存只作为限时兼容读取。提交 Provider 任务前的并发预留仍待后续批次接入。

DataForSEO Webhook 当前使用来源 IP 校验并保存原始回调。后续还需增加任务级回调令牌、请求体上限和重复回调幂等；Provider 原始回调不能被当作用户可直接读取的缓存。

## 8. D1 数据域

| 数据域 | 代表表 |
| --- | --- |
| 身份与访问 | **auth_users_v2**、**auth_sessions**、**api_keys**、**invite_codes** |
| SaaS | **stripe_customers**、**saas_subscriptions**、**saas_entitlements**、**saas_usage_counters** |
| Research | **research_jobs**、**research_job_requests**、**research_sessions**、**candidates**、**comparison_results** |
| 缓存/回调 | **query_cache**、**filter_cache**、**postback_results**；**serp_confidence_cache** 已停止代码访问、待观察备份 |
| Pipeline 账本 | **pipeline_runs**、**pipeline_tasks**、**pipeline_cost_events** |
| 老词/游戏/信号 | **old_keyword_opportunities**、**game_keyword_pipeline**、来源质量和反馈表 |
| 迁移 | **schema_migrations** |

数据库变更使用 **migrations/d1/** 的版本化迁移和 **scripts/schema/apply-d1-migrations.mjs**。**migrations/baseline/** 是生产结构快照，不是可重复执行的增量迁移。

未使用表采用“停止运行时访问 → 观察 → 备份 → 独立迁移删除”，不在普通重构中顺手删除。

## 9. Provider 边界

### DataForSEO

用于关键词扩展、SERP、Trends、关键词建议和对比。**lib/providers/dataforseo.ts** 固定官方 API 地址并接收显式凭证，**json-http.ts** 统一有界重试和超时；只有 **getPlatformDataForSeoClient()** 读取平台环境变量。Expand、Compare 和 SERP 客户端接收可注入实例，未传入时保持现有平台默认。响应解析已从 Live Trends、关键词建议、Expand 与 SERP 的传输逻辑中提取为纯函数。

### OpenRouter

用于候选语义过滤和意图识别。业务层只依赖 **ChatCompletionClient**；**getPlatformOpenRouterClient()** 保留当前平台 API Key、模型、超时和站点元数据。显式传入客户端时不会重新读取平台凭证，显式传入 `null` 时返回规则/意图降级结果。面向未来 BYOK 的 **createOpenRouterClient()** 固定 OpenRouter 官方地址；平台兼容适配器才允许沿用现有环境 Base URL。

### 免费/公开来源

Steam、CrazyGames、Poki、itch.io、HN Algolia 和 GitHub 等由 Python 管线采集。CrazyGames 当前需要 curl subprocess，这是已隔离、需健康监控的外部约束。

Provider Transport 与纯业务核心的 D5 收口已经完成本地实现和特征测试。它只建立复用边界，没有新增用户凭证表、保存接口或 Live Mode 路由；现有平台调用仍是唯一可执行路径。下一步先完成 Pipeline 契约与可观测性，再单独增加 BYOK Credential Source 和 Private Cache 旁路。

## 10. 缓存

迁移 0018 后，**query_cache** 的新写入使用以下结构：

~~~text
CacheRecord
  namespace
  version
  scope: shared | private
  ownerId: null | userId
  canonicalKeyHash
  payload
  expiresAt
~~~

逻辑键仍保持当前日期、查询类型、关键词和附加参数的规范化方式，以维持现有共享命中；存储身份由 namespace、version、scope、owner 和逻辑键共同计算完整 SHA-256。结果默认 TTL 为 24 小时，预计算健康记录为 14 天。迁移期间读取按新格式优先，只有 shared scope 可以限时回退到 `legacy` 行；private scope 永不读取旧共享格式。Job 引用由 **research_job_requests** 单独保存，不再进入结果缓存。

## 11. 部署、测试与可观测性

main push 触发 **.github/workflows/deploy.yml**：

1. Node 22 + npm ci。
2. Vitest 与 Python unittest。
3. student-paid guard、lint/typecheck、迁移、Binding 类型与依赖审计。
4. 业务规则同步检查。
5. OpenNext Cloudflare 构建。
6. Wrangler 部署。

生产 Worker 已启用 observability 和 10% head sampling；业务日志字段仍需在 D6 收口。

Pipeline 的 TypeScript 与 Python 运行时共同读取 **contracts/pipeline-contract-v1.json** 的 golden contract，固定状态枚举、Credential Source、Execution Mode 以及 Run/Task/Cost 幂等键。迁移 0019 为成本事件增加 `credential_source`、`execution_mode` 和可选 `owner_id`；现有事件默认 `platform/platform`。管理健康页和运行页按每条事件的 `actual_cost_usd ?? estimated_cost_usd` 计入总成本，避免“部分事件有真实值时丢掉其他估算值”，并展示陈旧运行、孤立 Task 成本和缺失事件键。

遗留访问以 [legacy runtime inventory](./docs/legacy-runtime-inventory.md) 为准。`serp_confidence_cache` 的未调用封装已移除但表未删除；sitemap/discovered-keyword 域仍有页面、路由、Cron、脚本与报表消费者，必须通过独立产品迁移退役，不能在本次收口中直接删除。

Cloudflare 相关工程原则：

- Worker 内访问 Cloudflare 服务优先使用 Binding。
- 运行时 Binding 类型由 wrangler types 生成。
- 兼容日期定期、独立升级并经过构建和线上观察。
- 不在模块级可变对象中保存请求状态。
- 大型或未知响应必须有大小边界，避免无界读取。

## 12. 当前技术债顺序

执行顺序固定为：

1. 文档与可重复基线。
2. CI/运行时。
3. Principal、Entitlement 和 API Key。
4. Research Job。
5. Cache 与 D1 边界。
6. Provider 纯核心和兼容适配器。
7. Pipeline 可观测性与遗留退役。
8. 稳定观察。
9. BYOK 灰度。

每项的证据、状态和关闭条件见 [docs/technical-debt-register.md](./docs/technical-debt-register.md)，交付状态见 [docs/execution-roadmap.md](./docs/execution-roadmap.md)。

## 13. 安全约束

- 仓库、日志、错误响应和 D1 业务列不得保存可恢复的 API Key 明文。
- Provider Secret 使用 Cloudflare Secret；未来用户 Secret 使用版本化加密密文。
- 管理接口必须同时验证认证与管理员角色。
- Private Cache、Research Job 和 Provider Connection 必须按 owner 查询。
- 任何未来带计费能力的 API Key 都必须使用 Bearer Header 和明确 Scope。
- 计费执行必须记录 Credential Source 和稳定幂等事件键。
