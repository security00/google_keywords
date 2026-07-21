# BYOK 密钥配置与轮换 Runbook

> 适用范围：Provider Connection envelope 的 KEK 与 fingerprint HMAC key。
> 当前分支仅允许本地演练；没有单独的生产变更批准时，不得执行远程命令。

## 不变量

- 密钥必须是 32 字节随机值、无 padding base64url 编码，只能进入 Worker Secret。
- `wrangler.jsonc` 只保存 active/read version 名称，不保存密钥值。
- 新写入只使用 active version；读取窗口同时保留旧、新 version。
- KEK 轮换只 unwrap/rewrap DEK，不解密并重写 credential ciphertext。
- fingerprint key 不能只靠 DEK rewrap 轮换；旧 fingerprint key 必须保留到用户换钥或受控重加密完成。
- 任一密钥缺失、版本未知或复核失败都 fail closed，不得回退平台凭证。

## 首次配置（G1 前的独立变更窗口）

1. 记录当前 commit、环境、D1 bookmark/备份标识与操作者。
2. 在受控终端生成两个独立随机 secret；不要复制到 issue、聊天、日志或仓库。
3. G0 部署与观察期间不要求配置 BYOK Secret；两个 feature flag 必须保持关闭，缺少密钥时
   Provider Connection 路径继续 fail closed。
4. G1 前把两个 secret 放入仓库外、权限受限的临时 JSON 文件，并一次性执行
   `wrangler versions secret bulk <FILE> --name google-keywords --message "stage BYOK v1 keyring"`。
   该命令只创建未部署 Worker version；记录 version id，立即删除临时文件，不得把文件内容
   输出到日志或 shell history。
5. 禁止在本流程使用 `wrangler secret put` 或 `wrangler secret bulk`：普通 secret 命令会立即
   创建并部署新 Worker version，绕过 G0/G1 的显式发布门。
6. 用 `wrangler versions view <VERSION_ID> --json` 复核版本元数据，并确认以下版本变量仍为：
   - `BYOK_ACTIVE_KEK_VERSION=v1`
   - `BYOK_KEK_READ_VERSIONS=v1`
   - `BYOK_ACTIVE_FINGERPRINT_KEY_VERSION=v1`
   - `BYOK_FINGERPRINT_KEY_READ_VERSIONS=v1`
7. 由于当前 Next.js 静态资源没有 version affinity，不做长期 Worker 百分比切流。在批准的
   变更窗口将该 version 明确发布到 100%，保持 `BYOK_PROVIDER_CONNECTIONS_ENABLED=false`
   与 `BYOK_LIVE_MODE_ENABLED=false`，随即运行无费用 smoke；发布版本与开 Connection
   Management 是两个独立动作。
8. 只有 migration、回滚、删除对账和内部 allowlist 均通过审批后，才可通过新的配置发布
   对单个维护者账号开放 Connection Management。

## KEK v1 -> v2

1. 先加入 `BYOK_KEK_V2`，将 read versions 设为 `v1,v2`，active 仍为 `v1`。
2. 验证两版密钥均能加载，再将 active 切到 `v2`；此后新写入只用 v2。
3. 对每条 live connection 执行受控 rewrap：读取 owner/id/provider/credential version/kek version；用 v1 unwrap DEK、用 v2 rewrap；以 owner + id + provider + credential version + expected KEK version 原子更新；写入不含凭证的 `kek_rewrapped` audit event。
4. 对账 `kek_version != 'v2'` 必须为 0，并抽样执行解密与固定官方端点 verify。
5. 在 D1 Time Travel/备份保留窗口结束前，默认保留 v1。若提前移除，历史恢复点将有意 fail closed，必须记录风险接受人。
6. 移除 v1 前再次保存 bookmark、导出无敏感聚合计数并演练回滚；随后从 read versions 和 Worker Secret 中移除 v1。

## 回滚

- active 切换后但 rewrap 前：把 active 恢复 v1，保留 v2。
- 部分 rewrap 后：read versions 必须继续包含 v1,v2；可恢复 active v1，但不可删除任一 KEK。
- 发现密钥疑似泄露：立即关闭 BYOK feature 与 Live Mode；进入安全事件流程，轮换 KEK，并要求受影响用户轮换 Provider credential。

## 完成证据

- active/read version 配置变更记录（不含 secret）。
- 按 KEK version 聚合的 live row 数量、成功/冲突/失败数量。
- `kek_rewrapped` 审计数量与 live row 对账结果。
- 新旧窗口下的自动化测试、verify 结果和零平台凭证调用证明。
