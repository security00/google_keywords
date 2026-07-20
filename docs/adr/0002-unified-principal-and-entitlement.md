# ADR-0002：统一 Principal 与有效权益

- 状态：Accepted
- 日期：2026-07-20

## 决策

认证统一产出 Principal；访问能力统一通过 Effective Entitlement 判断。Cookie、Bearer API Key、Admin 和 Cron 不再由业务路由分别拼接权限逻辑。

API Key Scope 属于 Principal。普通 Key 保持缓存能力；未来只有明确含 `provider:execute` 的 Key 才可触发 BYOK。

## 影响

- 试用、订阅、课程授权和管理员特权必须汇总为一个最终权益结果。
- Cron Secret 校验集中实现。
- URL 查询参数中的 API Key 进入兼容退役流程，未来计费接口从不接受该形式。
