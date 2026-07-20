# ADR-0005：D1 运行时访问边界

- 状态：Accepted
- 日期：2026-07-20

## 决策

Cloudflare Worker 内的生产数据访问只使用 D1 Binding。D1 REST API 仅用于 Worker 外部的迁移、运维和 Python/Node 管理脚本。

Binding 类型由 `wrangler types` 根据 `wrangler.jsonc` 生成，不手写平台 Binding 接口。

## 原因

Binding 是 Worker 数据平面访问方式，避免额外网络、控制面认证和配置漂移。

## 影响

- 当前 `lib/d1.ts` 的 REST fallback 是待迁移兼容债务。
- 本地/测试通过依赖注入或明确的外部客户端访问，不以生产 Worker 隐式 fallback 兜底。
