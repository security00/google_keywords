# Discover Keywords 领域上下文

> 本文件定义仓库内的统一业务语言。代码、Issue、ADR、测试和运维文档应优先使用这里的术语。

## 产品边界

Discover Keywords 是一个关键词机会发现与运营平台。当前由三个主要 Pipeline 产生结果：

- **Shared Expansion Pipeline（共享扩展管线）**：定时扩展种子词，执行规则、语义、SERP 与 Trends 分析，并产出学生可读取的共享结果。
- **Old Keyword Pipeline（老词管线）**：寻找仍具有商业价值的成熟关键词。
- **Game Discovery Pipeline（游戏发现管线）**：从游戏和社区来源发现新游戏关键词，再通过趋势、历史和 SERP 信号筛选。

管理端的来源质量、机会富集、人工反馈和语义去重属于运营辅助层。除非另有 ADR，它们不得直接改变学生推荐或从浏览器触发付费 Provider。

## 参与者

### Student（学生）

具有有效访问权益的普通用户。默认只消费 Shared Cache，不因页面点击触发平台付费 Provider。

### Admin（管理员）

可以使用管理工具，并在明确的后台操作中触发平台付费 Provider。

### Cron（定时任务主体）

由受控 Secret 认证的后台执行主体。负责预计算、扫描、补偿和健康状态同步。

### Principal（请求主体）

认证完成后的统一身份表达。至少包含认证来源、用户 ID（如适用）、角色和 API Key Scope。不要用“已登录用户”代替 Cron 或 API Key Principal。

### Effective Entitlement（有效权益）

将管理员身份、有效试用、有效订阅和其他正式授权合并后的最终访问结论。它与认证是两个不同概念：认证回答“是谁”，权益回答“是否可使用该能力”。

## 执行与计费

### Shared Cache Mode（共享缓存模式）

学生端默认模式。只读取平台预计算的共享结果；缓存未命中时返回可解释的未就绪或降级结果，不使用平台凭证补算。

### Platform Execution（平台执行）

由 Admin 或 Cron 使用平台持有的 DataForSEO/OpenRouter 凭证执行的付费工作。当前线上真实计费都属于该模式。

### BYOK Live Mode（自带密钥实时模式）

隔离分支已实现 OpenRouter 关键词语义过滤，以及 DataForSEO Trends、SERP、Expand 和
DataForSEO + OpenRouter Compare；生产仍关闭。用户明确选择并确认费用后，使用用户自己的
Provider Connection 执行实时付费请求。结果只属于该用户，且不得回退到平台凭证。付费请求在
发送前写入不可自动重领的 checkpoint，结果只进入 Private Cache。Compare 的 DataForSEO 阶段
成功而 LLM 阶段失败时保留 Partial Success，只允许通过独立报价重试语义阶段。

### Credential Source（凭证来源）

Provider 请求使用的凭证所有者，枚举为：

- `platform`：平台凭证，只允许 Admin/Cron 路径使用。
- `user`：用户加密保存的 BYOK 凭证，只允许明确的 BYOK Live Mode 使用。

### Paid Provider（付费 Provider）

会消耗外部额度或产生账单的服务，包括 DataForSEO，以及通过 OpenRouter、OpenAI、DeepSeek、Gemini 等模型服务执行的语义能力。

### Provider Connection（Provider 连接）

BYOK 使用的用户级凭证记录。当前隔离实现支持 OpenRouter API Key 与 DataForSEO
`{login,password}`。它只保存加密密文、密钥版本、掩码、指纹和验证状态，不代表一次具体执行。

## 数据与异步工作

### Cache Scope（缓存作用域）

- `shared`：由平台预计算、可供多个有权用户读取。
- `private`：只允许所属用户读取；BYOK 结果必须使用该作用域。

不要使用“cache”一词来同时表示业务结果、Job ID 和 Provider 原始回调。

### Research Job（研究任务）

面向 API/页面的一次异步研究执行，具有所有者、类型、状态、执行来源和结果引用。Research Job 不是 Pipeline Task，也不应依赖缓存表实现幂等。

### Pipeline Run（管线运行）

一次完整的后台管线运行，例如一次每日共享扩展或游戏扫描。

### Pipeline Task（管线任务）

Pipeline Run 中可独立记录、重试和诊断的阶段。当前幂等范围限定在单个 Run；未来 Queue 不得另建一套任务模型。

### Cost Event（成本事件）

一次付费 Provider 调用的账本记录。必须关联 Run/Task 或 Research Job，并记录 Provider、操作、凭证来源、幂等事件键和可获得的实际/估算成本。

### Partial Success（部分成功）

付费数据阶段已经成功，但非必需语义阶段失败的可用结果。例如 DataForSEO 成功、LLM 失败时返回规则过滤结果，并允许仅重试语义阶段。

## 强制不变量

1. Student 的 Shared Cache Mode 不得创建任何平台付费 Provider 请求。
2. Platform Execution 只允许 Admin 或 Cron。
3. BYOK 必须由用户显式选择，使用 `user` Credential Source，并写入 Private Cache。
4. BYOK 失败不得回退到平台凭证。
5. Job、Private Cache 和 Provider Connection 必须按用户隔离。
6. 重试、重复回调和轮询不得导致重复计费。
7. 日志、错误响应和管理页面不得暴露凭证明文。

## 文档权威顺序

1. 本文件：领域术语与不变量。
2. `docs/adr/`：已经确认的架构决策。
3. `ARCHITECTURE.md`：当前实现快照与已知过渡边界。
4. `docs/execution-roadmap.md`：交付顺序和当前状态。
5. `docs/technical-debt-register.md`：技术债关闭证据。
6. 历史 `*-todo.md`、handoff 和 memory 文档：设计过程或历史记录，不自动代表当前状态。
