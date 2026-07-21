# BYOK 删除与 D1 恢复对账 Runbook

> 删除语义：立即从 live application 硬删除 connection row；无凭证 audit event 保留。
> 不能声称 D1 Time Travel/历史备份中的密文被即时物理擦除。

## 删除前后记录

删除操作必须由 Cookie Principal 发起，并以服务端 owner 为准。只记录 connection id、owner id、provider、删除时间、audit event id、credential version 与 KEK version。禁止记录 ciphertext、wrapped DEK、fingerprint、完整 mask 或 Provider 正文。

## 恢复前

1. 关闭 `BYOK_PROVIDER_CONNECTIONS_ENABLED` 与所有 BYOK Live Mode 入口。
2. 记录恢复目标、bookmark、commit、migration 版本和批准人。
3. 导出恢复点之后发生的删除 tombstone 清单；只含上述非敏感字段。
4. 确认恢复运行时仍持有恢复点所需 read KEK/fingerprint key；缺失时保持 fail closed。

## 恢复后强制对账

1. 在重新开放流量前，按 tombstone 的 owner + connection id 再次硬删除被恢复的 live row。
2. 对账每个 tombstone：live row 为 0，删除 audit 至少一条；重复删除必须安全且不恢复凭证。
3. 检查 migration 0020/0021、owner/provider 唯一性、verify limit 和所有 version 字段。
4. 运行跨 owner 404、无明文响应、固定 Provider endpoint、零平台回退测试。
5. 仅在差异为 0 且安全负责人签字后恢复 allowlist；feature 仍默认关闭。

## 异常处理

- tombstone 缺失或数量无法闭合：停止开放，保留恢复副本，只做只读调查。
- 恢复出未知 key version：不得改写 version 伪造成功；保持不可用并升级处理。
- 发现任何凭证明文进入日志、D1、异常或响应：关闭全部 BYOK 路径并按安全事件处理。
- 恢复后出现 Shared Cache 或平台凭证调用：立即回滚应用入口并冻结 BYOK Job 执行。

## 演练验收

- 创建测试 connection -> 删除 -> 确认 live row 0；
- 从本地快照恢复 -> 执行 tombstone 对账 -> 再次确认 live row 0；
- audit 不含凭证，重复对账幂等；
- 恢复期间 BYOK 管理和执行入口均不可访问；
- 演练只使用测试凭证，不调用收费 Provider。
