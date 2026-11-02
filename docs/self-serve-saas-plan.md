# 自助 SaaS 转型实施计划（路线 B）

> 基线日期：2026-08-17。
>
> 本文是产品交付计划，权威顺序低于 `CONTEXT.md`、`docs/adr/` 和
> `ARCHITECTURE.md`；工程债务证据仍以 `docs/technical-debt-register.md` 为准。
> 本文来源于 2026-08-17 的三视角站点审计（安全/认证、产品/增长、运维/管线）。
>
> 目标：把当前"邀请制 + 人工激活 + Stripe test mode"的课程型工具，转型为
> "公开注册 → 自助试用 → 到期自助订阅"的自助 SaaS，同时不破坏任何既有
> 强制不变量（学生点击不计费、BYOK 隔离、迁移优先部署）。

## 1. 审计背景摘要

计划成立的关键事实（均已核对代码）：

- 权益系统已把 Stripe 订阅放在最高优先级（`lib/entitlements.ts` 的
  `getEffectiveEntitlement`：admin → Stripe active/trialing → 课程试用 → 拒绝）。
- Billing 五个路由齐全：`app/api/billing/{checkout,portal,status,sync,webhook}`。
- 计划枚举已预留 `scout/builder/studio` 多档位与 brief 限额（10/50/100）。
- 注册默认要求邀请码（`app/api/auth/sign-up/route.ts`）；共享注册 token 与
  Google OAuth 新用户进入 pending，等待管理员人工开通。
- Stripe 仍在 test mode（`README.md`），Founding Member $49/月无法真实收款。
- 邮件能力仅有密码重置（Resend，`app/api/auth/forgot-password/route.ts`）。
- GA/Clarity 只有 page_view，无 sign_up/begin_checkout/purchase 转化事件
  （`components/google-analytics.tsx`）。
- SEO 缺口：`app/sitemap.ts` 漏 `/pricing`；全站无 Open Graph/Twitter 卡片；
  结构化数据仅 FAQ（`components/faq-schema.tsx`）。
- 安全前置项：登录/注册/找回密码无速率限制；DataForSEO Webhook 仅 IP 校验、
  无请求体上限；Stripe Webhook 无 event 级幂等。

**结论：变现管道已铺好，缺的是打开水阀（Stripe live + 自助注册）和引流
（SEO/邮件/埋点）。**

## 2. 前置业务决策

以下决策由产品负责人拍板，对应阶段开工前必须确定：

| # | 决策 | 现状 | 建议 | 阻塞阶段 |
| --- | --- | --- | --- | --- |
| D1 | 公开注册试用时长 | 邀请码注册立即 90 天试用 | 公开注册 7–14 天；90 天保留给邀请码（课程学员），两通道并存 | 阶段 2.3 |
| D2 | Stripe live 账户 | test mode | 需要真实收款主体、live 版 Product/Price/Webhook；只能由所有者操作 | 阶段 2.1 |
| D3 | 定价档位 | 定价页仅 Founding $49/月 | 首发只上 Founding 单档；多档位（scout/builder/studio）留到有付费用户后 | 阶段 2.1 |
| D4 | pending 流程去留 | 共享链接/OAuth 新用户全部 pending 等人工开通 | 公开注册直接开试用；pending 仅保留为风控手段 | 阶段 2.3 |

## 3. 阶段顺序与依赖

~~~text
阶段1(安全加固) ──→ 阶段2(Stripe live + 自助订阅) ──→ 阶段3(邮件/埋点)
                                                        ↘ 阶段4(SEO, 可与3并行)
                                                             ↘ 阶段5(放大, 待有付费用户)
~~~

每个编号项做成独立分支 + PR，全部通过 README 的完整校验清单
（`npm test`、`npm run check:student-paid-guards`、`npm run build` 等），
数据库变更遵循迁移优先部署。

## 4. 阶段 1：上线前安全加固

开放公开注册等于把认证入口暴露给全网，因此审计中的 P0 安全项是本路线的
硬前置。

### 1.1 认证入口速率限制

- 改动点：`app/api/auth/sign-in/route.ts`、`sign-up/route.ts`、
  `forgot-password/route.ts`、`reset-password/route.ts`。
- 实现：复用 `lib/api_keys.ts` 已有的 D1 持久化失败限流模式，按 IP 和邮箱
  两个维度限流；需要一个新迁移。
- 顺带修复：找回密码对未注册邮箱返回 404 的枚举问题，改为统一返回
  "已发送"。

### 1.2 Webhook 加固

- `app/api/research/webhook/route.ts`：加请求体大小上限、gunzip 解压后大小
  上限、任务级回调令牌（`ARCHITECTURE.md` §7 已自列为待办）。
- `app/api/billing/webhook/route.ts`：新增 `event.id` 幂等表（新迁移），
  防止 Stripe 重放造成重复副作用。切 live 前必须完成。

### 1.3 生产开关清理

- 关闭 `wrangler.jsonc` 中的 `DEBUG_API_LOGS`。
- 评估关闭 `RESEARCH_STATUS_GET_EXECUTION_COMPAT`（TD-004 观察窗口已超期，
  关闭后带副作用 GET 变为只读快照）。

## 5. 阶段 2：Stripe 切 live + 自助订阅闭环

### 2.1 Stripe live 切换（依赖 D2、D3）

- Stripe live 模式创建 Founding Member Product/Price，配置 webhook endpoint
  `https://www.discoverkeywords.co/api/billing/webhook`。
- 更新 Cloudflare Secrets：`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、
  `STRIPE_FOUNDING_PRICE_ID`。
- 代码基本不动（`lib/stripe-billing.ts` 已接受 `sk_live_`）；需一次真实
  小额付款端到端验证 + Customer Portal 验证（退订/换卡）。
- 新增 `docs/runbooks/stripe-live-cutover.md`，包含回滚到 test mode 的步骤。

### 2.2 到期/未激活文案与产品能力对齐

- `lib/usage.ts`："试用期已过期…请联系管理员续费"改为指向自助订阅。
- `app/dashboard/settings/page.tsx`：Subscribe 入口提升为到期状态的主 CTA。
- 研究 API 403 响应的 `reason` 携带可行动信息，前端据此展示"订阅解锁"。
- Dashboard 顶部增加"试用剩余 N 天"提示条（数据 `getEffectiveEntitlement`
  已有，纯前端改动）。

### 2.3 自助注册开闸（依赖 D1、D4）

- `app/api/auth/sign-up/route.ts`：无邀请码时走"公开注册 → 立即开短试用 +
  建 session"分支；邀请码变为可选字段（保留 90 天通道和归因）。
- Google OAuth 新用户（`createPendingOAuthUser`）直接开试用，不再 pending。
- `app/register/page.tsx` 重写：英文为主（与营销站一致）、邀请码折叠为
  可选项、注册后直接进 dashboard。
- 营销页 CTA 从 "Request access" 改为 "Start free trial"
  （`components/marketing-page.tsx`、`app/page.tsx`）。

### 阶段 2 验收标准

陌生访客可在无人工介入下完成"落地页 → 注册 → 试用 → 到期 → 付款 →
权益恢复"全流程，且学生付费路径不触发任何平台 Provider 调用（由
`check:student-paid-guards` 持续保证）。

## 6. 阶段 3：生命周期邮件 + 转化埋点

### 3.1 邮件基础设施

- 抽出 `lib/email.ts`（复用 forgot-password 中的 Resend 逻辑）。
- 模板：欢迎信（注册即发）、试用到期前 7 天/1 天提醒、到期日"订阅继续
  使用"、付款成功确认（webhook 触发）。
- 到期提醒定时扫描：新增 `app/api/cron/lifecycle-emails` 路由（既有
  `x-cron-secret` 认证），由现有 Python cron 主机每日调用一次；复用现有
  调度设施，不引入新组件。
- 发送记录写 D1（新迁移，`email_events` 表），保证同一提醒不重发。

### 3.2 转化事件埋点

- `components/google-analytics.tsx` 补业务事件：`sign_up`（区分
  invite/public/oauth）、`begin_checkout`、`purchase`、
  `trial_expiring_view`、营销页 CTA 点击。
- 可后置：极简 admin 漏斗视图（注册数 → 激活试用数 → 到期数 → 订阅数），
  只读 admin API + 页面，符合仓库既有的只读运营面板模式。

## 7. 阶段 4：SEO / 获客修补（可与阶段 3 并行）

1. `app/sitemap.ts` 补 `/pricing`；将 `/login`、`/register` 移出 sitemap。
2. 全站 Open Graph/Twitter 卡片：根 `app/layout.tsx` 加默认 OG；各营销页
   `metadata` 补 `openGraph`；制作 1200x630 OG 图放 `public/`。
3. 结构化数据：新增 Organization 与 SoftwareApplication/Offer（$49）
   JSON-LD，挂到首页和 pricing。
4. `/login`、`/register` 补独立 metadata；登录/注册页头部加回营销站链接。
5. Solution 五页文案差异化：每页针对自身搜索意图重写首屏和 FAQ。
6. `/dashboard/discovery` 孤儿页：挂回导航或按 legacy inventory 四步法
   明确下线。

## 8. 阶段 5：差异化放大（收到第一批订阅后）

### 5.1 BYOK 完成灰度并变成付费卖点

- 按 `docs/runbooks/byok-gray-rollout.md` 执行 G3（3–5 个内部账号、连续
  7 天 UI+API 双覆盖）。这是既有门禁，不需要新开发。
- 通过后将 "Bring your own DataForSEO/OpenRouter keys" 写进 pricing 页和
  solution 页；BYOK 可作为订阅档位核心权益（`byok:execute` scope 已存在，
  权益判断挂到 `getEffectiveEntitlement`）。

### 5.2 内容飞轮

- 新增公开"每周关键词机会榜单"页（脱敏 + 延迟 7 天发布），数据直接读
  三条管线已有共享结果，零额外 Provider 成本。
- 每期自动生成静态页进 sitemap，形成持续长尾 SEO 入口，同时是产品活演示。

## 9. 范围外但建议并行的事项

以下不属于路线 B，但开始收钱后会直接影响付费用户体验，建议与阶段 3
并行处理（详见审计与运维清单）：

- 三条 Python 管线的统一失败告警（扩展既有 Telegram 通道 + "今日
  precompute 未完成"检测）。
- cron 主机单点的备份/迁移 runbook。
- 遗留 Query-string API Key 退役（ADR-0002）。

## 10. 交付门禁

- 每个 PR 通过 README 的完整校验清单；涉及研究/认证/缓存/Pipeline/
  Provider 的改动必须全量执行。
- 涉及 D1 的改动一律迁移优先，遵循 `docs/deployment-runbook.md`。
- 阶段 2 上线后新增一条生产 smoke：公开注册 → 试用权益生效（不产生
  Provider 调用）。
- 任何阶段不得违反 `CONTEXT.md` 强制不变量，特别是"Student 的 Shared
  Cache Mode 不得创建任何平台付费 Provider 请求"。
