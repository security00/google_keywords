# Stripe Live Cutover Runbook

> 当前状态：生产 Worker 已切到共享 live Stripe 账号与含税 $49 Founding Member Price。
> 本 runbook 只记录已完成的切换与回滚步骤。它不授权公开注册、部署、改生产 Secret，也不授权创建税务登记。

## 1. 不要在这次切换里做的事

- 不要把 `NEXT_PUBLIC_PUBLIC_SIGNUP_ENABLED` 改成 `true`
- 不要从 PR 对生产 D1 执行 migration
- 不要改现有预计算、游戏扫描、discovery cron
- 不要动 Matcha / QR / Mayan 已有 webhook
- 不要自动创建 Stripe Tax Collecting registrations
- 不要关闭 `DEBUG_API_LOGS` 或 `RESEARCH_STATUS_GET_EXECUTION_COMPAT`

## 2. 账号与对象

| 用途 | 账号 | 说明 |
|---|---|---|
| 本地 / 测试 | `acct_1TTNr52eJNPpLqRe` | DK Founding 测试账号 |
| 生产 | `acct_1TTNqjGh0EBdFLJt` | 与 Matcha / QR / Mayan 共用的 live 账号 |

生产对象：

- Product：`prod_V61O710WEHQCZh`
- Price：`price_1U5pLIGh0EBdFLJt1KqlKANp`（$49 / month，`tax_behavior=inclusive`）
- Webhook：`we_1U5pLJGh0EBdFLJty0AkEAOX`
- 回调地址：`https://www.discoverkeywords.co/api/billing/webhook`

测试对象（只用于本地 `.env.local`）：

- Product：`prod_UoN3rN1xA0txvA`
- Price：`price_1TokJz2eJNPpLqRe0Jefwq39`

## 3. 生产 Worker Secret 现状

生产 Worker `google-keywords` 已配置：

- `STRIPE_SECRET_KEY`：现有 live restricted key
- `STRIPE_FOUNDING_PRICE_ID`：`price_1U5pLIGh0EBdFLJt1KqlKANp`
- `STRIPE_WEBHOOK_SECRET`：上面这条 DK live webhook 的签名密钥

本地 `.env.local` 继续使用 test key / test price，不要把 live webhook secret 写进仓库。

## 4. 回滚到测试计费

只在确认生产 Checkout 不能收款、或误用了错误 Price 时执行。回滚本身会让线上 Subscribe 重新打到测试账号，因此必须单独批准。

1. 记录当前 Worker version 与三条 Stripe Secret 的“已设置”状态，不要把值写进文档或聊天。
2. 把生产 `STRIPE_SECRET_KEY` 改回 test restricted key。
3. 把生产 `STRIPE_FOUNDING_PRICE_ID` 改回 `price_1TokJz2eJNPpLqRe0Jefwq39`。
4. 把生产 `STRIPE_WEBHOOK_SECRET` 改回测试 webhook 签名密钥。
5. 不要删除 live webhook 端点，只停用或忽略它，避免影响其他产品。
6. 用一次测试 Checkout 确认会话回到 Stripe test mode。
7. 公开注册开关保持 `false`。

## 5. 再切回 live

1. 确认 live Price 仍是含税 `$49`：`price_1U5pLIGh0EBdFLJt1KqlKANp`。
2. 恢复第 3 节的三条生产 Secret。
3. 用受控测试卡或真实小额支付验证 Checkout → webhook → 订阅写入。
4. 用 Customer Portal 验证取消 / 更新。
5. 公开注册仍然保持关闭，直到另一次明确批准。

## 6. 税务

- 订阅价必须含税，商户不承担额外税差。
- Stripe Tax Settings 已设为 inclusive + SaaS default tax code。
- Collecting registrations 目前为空；需要收税时由账号所有者在 Dashboard 按真实经营地登记。
- 本仓库不自动创建、过期或猜测税务管辖区。
