# ADR-0008：Provider Connection 信封加密与删除边界

- 状态：Accepted
- 日期：2026-07-21
- 部署约束：B0 稳定性 gate 通过前只允许独立分支开发和本地测试

## 背景

未来 BYOK Live Mode 需要保存用户 Provider credential。D1 不能保存明文，
Worker 日志、错误、管理页面和备份恢复也不能无意暴露 credential。B1 只建立安全
存储与 owner-scoped 管理能力，不批准 BYOK 执行。

Cloudflare Workers Web Crypto 支持 AES-GCM、AES-KW、HMAC 和 key wrap/unwrap。
D1 Time Travel 会保留可恢复的历史数据库状态，因此 live row 删除不等于历史恢复点
立即物理擦除。

## 决策

1. 每个 Provider Connection 使用随机 256-bit DEK，以 AES-256-GCM 加密规范化、
   版本化的 credential JSON；每次保存使用新的 96-bit IV。
2. DEK 以 AES-KW 由版本化 Worker Secret KEK 包装。D1 只保存 ciphertext、IV、
   wrapped DEK、KEK version 和 encryption version。
3. AES-GCM AAD 固定包含 encryption version、connection id、owner id 和
   provider，阻止 ciphertext 跨行、跨 owner 或跨 Provider 替换。
4. 使用独立的 256-bit versioned HMAC key 生成 owner/provider-scoped
   fingerprint；不保存裸 credential hash。解密时同时验证 fingerprint。
5. KEK 与 fingerprint secret 使用无 padding base64url 编码的 32-byte 随机值，
   只通过 Worker Secret 提供，不接受人类口令或 wrangler.jsonc 明文变量。
6. 明文 credential、解包后的 DEK 和解密结果只存在于单次调用局部范围，不进入
   模块级缓存、日志、错误、遥测、审计或 API 响应。异常只暴露稳定错误码。
7. Provider Connection 查询和 mutation 必须同时匹配当前 Principal owner 与
   connection id。B1 管理接口限制为 Cookie Principal。
8. 删除硬删除 live ciphertext 行并保留无凭证 audit event。用户语义为“立即从
   live application 不可用”；不能声称 D1 Time Travel 中即时物理擦除。
9. 恢复包含已删除 connection 的历史数据库后必须运行删除对账。缺少 KEK、错误
   version、认证失败或 fingerprint 不一致时全部 fail closed。
10. 用户 credential 失败时不得读取或调用平台 credential。Provider Connection
    不保存 Base URL，首批 Provider 只允许 ADR-0006 定义的官方地址。

## KEK 轮换

代码在短暂迁移窗口内支持读取旧/新 KEK version，但只使用 active version 新写。
轮换任务 unwrap 旧 DEK 并用新 KEK rewrap，然后以 connection/owner/version 条件
原子更新 wrapped DEK 与 version，不需要解密 credential payload。

所有 live 行完成并复核后才能退役旧 KEK。退役旧 KEK 会让仍引用旧版本的 D1 历史
恢复点无法解密；这是有意 fail-closed，还是等待 Time Travel 窗口结束，必须由轮换
runbook 明确选择。

## 删除与恢复语义

该方案保护 D1 live 数据和普通导出在没有 Worker KEK 时无法解密，但不防御已经
控制 Worker 代码或 Cloudflare 账户的攻击者。如果产品或合规要求“删除即密码学
擦除”，必须重开本 ADR，评估具有独立销毁语义的外部 KMS/Secret Store；当前设计
不得声称达到该保证。

## 实施与上线边界

- B1.1 只实现 crypto 与单元测试，不连接 D1、不读取环境变量。
- B1.2 才可增加 additive schema 与 owner-scoped store，且 feature 保持 off。
- B1.3/B1.4 才进入 Cookie-only API 和内部 allowlist。
- B0 gate 通过前，不配置生产 KEK、不执行远程 migration、不部署本分支。
- B2 必须单独评审；B1 不增加 Live Mode 或 credential_source=user 调用。
