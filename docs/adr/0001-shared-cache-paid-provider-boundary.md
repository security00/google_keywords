# ADR-0001：共享缓存与平台付费边界

- 状态：Accepted
- 日期：2026-07-20

## 决策

学生默认使用 Shared Cache Mode。学生页面和普通 `gk_live` API Key 不得触发平台 DataForSEO、OpenRouter 或其他付费 Provider。Platform Execution 只允许 Admin 或 Cron。

未来 BYOK 必须是显式的 BYOK Live Mode，且只使用用户凭证。

## 原因

平台需要可预测地控制成本，同时保证学生请求不会因为缓存未命中而产生隐性账单。

## 影响

- 所有付费入口都必须通过统一授权和静态守卫测试。
- 缓存未命中不能静默回退为平台实时查询。
- 新 Provider 能力必须声明执行模式和凭证来源。
