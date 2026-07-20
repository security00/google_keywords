# 技术债台账

> 基线日期：2026-07-20。这里只记录工程、架构、安全、数据一致性和运维债务；产品增强项继续保留在执行路线图。

状态：`open`、`in-progress`、`resolved`、`accepted`、`deferred-product`。

| ID | 状态 | 问题与证据 | 关闭条件 | 批次 |
| --- | --- | --- | --- | --- |
| TD-001 | resolved | 架构、API、schema notes 与当前代码/迁移不一致 | 当前事实写入 CONTEXT、ADR、架构和 API 文档；旧记录标明历史属性 | 文档 |
| TD-002 | resolved | `auth_middleware.ts` 已删除；Principal、Cron、Effective Access 和拒绝状态统一由 `authz.ts`/`entitlements.ts` 提供，研究入口已迁移；遗留 Query Key 只在显式兼容选项中可用 | 所有业务入口使用统一 Principal、Effective Entitlement 和 Cron 验证；兼容包装完成下线 | D2 |
| TD-003 | in-progress | API Key 已增加默认 `cache:read` Scope、持久化失败限流和生产形状迁移测试；0016 与匹配应用已于 2026-07-20 受控上线；legacy `key` NOT NULL 列仍需写入不可逆哈希占位 | 完成观察窗口；新无明文表完成迁移；旧表备份后独立删除 | D2 |
| TD-004 | in-progress | Job 读写已统一校验 owner + type，内部越权函数显式命名；0017 与 POST 执行器已于 2026-07-20 上线；带副作用 GET 仍由兼容开关临时保留 | 观察 POST；关闭 `RESEARCH_STATUS_GET_EXECUTION_COMPAT` 后验证 GET 只读；提交阶段接入稳定幂等键 | D3 |
| TD-005 | in-progress | 0018 与匹配应用已于 2026-07-20 迁移优先上线，增加类型化 namespace/version/scope、完整 SHA-256 身份、明确过期时间和独立 `research_job_requests`；旧共享格式仅限时兼容，私有缓存禁止回退 | 观察新旧命中率后关闭旧共享读取并独立清理遗留行 | D4 |
| TD-006 | resolved | Worker 的 D1 访问已改为生成类型的 `DB` Binding-only，Binding 缺失时 fail closed，不再携带控制面 Token 或回退 REST；外部 Python 脚本保留各自的 REST 客户端 | Binding 路径及无 Binding 时不调用 `fetch` 均有回归测试；生成类型进入 CI | D1/D4 |
| TD-007 | resolved | DataForSEO 凭证、官方端点与 JSON Transport 已进入独立适配器；Expand、Compare、SERP、Trends 和关键词建议均可注入客户端。OpenRouter 过滤与意图识别改为通用 `ChatCompletionClient`；响应解析为纯函数，平台环境变量只留在平台适配器 | Provider 适配器、纯解析、语义过滤与意图识别均有特征测试；现有调用不传客户端时仍使用平台配置，显式 `null` LLM 不回退平台 | D5 |
| TD-008 | in-progress | 共享扩展、老词和游戏 Pipeline 已使用统一 Run/Task/Cost 账本；管理端按事件逐项 `actual ?? estimated` 汇总并展示异常；0019 与匹配应用已于 2026-07-20 受控上线 | 观察三条 Pipeline；确认成本事件完整率、异常阈值和缓存新鲜度后关闭 | D6 |
| TD-009 | resolved | TypeScript 与 Python 现在共用 `contracts/pipeline-contract-v1.json`，固定状态枚举、Credential Source、Execution Mode、稳定 JSON 和 Run/Task/Cost 键样本 | 两端测试共同读取同一 golden fixture；任何一端漂移会使 CI 失败 | D6 |
| TD-010 | in-progress | `serp_confidence_cache` 无调用封装已移除，表保留待线上无访问观察；审计确认 sitemap/discovered-keyword 路由、页面、Cron、脚本和只读报表仍在活跃使用，不能作为“死链路”删除 | `serp_confidence_cache` 观察、备份后用独立迁移删除；sitemap 需单独产品迁移先替换所有活跃消费者，详见 legacy runtime inventory | D4/D6 |
| TD-011 | resolved | CI 曾缺少 student-paid guard、lint/typecheck、迁移和生成类型校验；本地 Python 命令不跨平台 | 门禁已统一为 npm scripts，Windows/Linux Python 测试通过 | D1 |
| TD-012 | in-progress | 兼容日期、结构化日志采样和 Next middleware 警告待治理 | 兼容日期、采样和冗余 middleware 已处理；剩余业务日志结构化 | D1/D6 |
| TD-013 | accepted | CrazyGames 对 Python 原生请求有限制，当前依赖 curl subprocess | 适配器隔离、超时/错误可观测、健康检查覆盖；上游条件改变时再替换 | D6 |
| TD-014 | resolved | 旧文档声称 `api_keys.user_id` 类型不一致 | 当前 baseline 和迁移统一使用 TEXT；保留迁移测试防回归 | 文档 |
| TD-015 | resolved | 旧文档声称 Actions 仍使用 Node 20/checkout v4 | 当前 Workflow 已使用 Node 22、checkout/setup-node v6 | 文档 |
| TD-016 | resolved | 生产依赖存在 Next 高危、fast-xml-parser 关键级和 ECharts XSS 公告 | 依赖升级、XML 回归测试和完整 npm audit 均通过 | D1 |

## 不属于本轮技术债的项目

以下内容标记为 `deferred-product`：新增信号源、自动来源调权、从反馈训练/微调模型、恢复 sitemap 为正式来源，以及其他推荐算法增强。它们需要独立产品目标和验收标准。

## 删除策略

表、字段和旧链路统一采用四步法：移除新写入或运行入口、记录访问观察、备份、独立迁移删除。任何仍被生产访问或无法回滚的结构不在同一批代码改动中直接删除。
