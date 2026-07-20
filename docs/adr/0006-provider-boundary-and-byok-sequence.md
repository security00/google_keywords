# ADR-0006：Provider 边界与 BYOK 顺序

- 状态：Accepted
- 日期：2026-07-20

## 决策

Provider 重构采用渐进式适配器，不复制整套业务流程：

1. 先用特征测试固定现有 DataForSEO/OpenRouter 行为。
2. 提取请求构造、响应解析、规则处理和结果合并等纯业务核心。
3. 保留现有平台 Transport，并保持环境变量、超时和返回结构不变。
4. 技术债稳定后新增并行的用户凭证 Transport，共用同一业务核心。

首批 LLM Provider 固定为 OpenRouter、OpenAI、DeepSeek 和 Gemini 官方地址，不提供任意 Base URL。

## 影响

- BYOK 不是复制平台链路，而是新增 Credential Source 与 Private Scope。
- BYOK 永远不得回退到平台凭证。
- DataForSEO 成功而 LLM 失败时允许 Partial Success 和语义阶段单独重试。
