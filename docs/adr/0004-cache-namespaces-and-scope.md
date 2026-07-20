# ADR-0004：缓存命名空间与作用域

- 状态：Accepted
- 日期：2026-07-20

## 决策

缓存记录必须声明 namespace、版本和 Cache Scope。Shared Cache 与 Private Cache 逻辑隔离；Research Job 幂等记录、Provider 原始回调和业务结果不得继续共用同一种缓存语义。

缓存主键由规范化输入的完整加密哈希生成，不再截断原始键构造 ID。

## 影响

- 新格式采用新写入、旧格式兼容读取的迁移方式。
- BYOK 只写 Private Cache，默认 TTL 为 24 小时。
- 未使用缓存结构先退役运行时代码，经审计和备份后再删除表。
