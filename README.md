# Keyword Research Platform

一个基于 Next.js App Router 的关键词研究与发现平台，当前主要用于内部使用。

## 主要能力

- 关键词扩展：从种子词扩展候选关键词
- 候选词筛选：结合规则过滤、SERP 信息和趋势信号筛选候选词
- 趋势对比：将候选词与基准词做时序对比，给出分级结果
- Sitemap 发现：监控站点 sitemap，发现最近新增页面与新词
- 对外数据接口：可通过 API 输出“发现的词 + 原因”

## 当前使用方式

- 当前站点为内部工具
- 注册入口已关闭
- 敏感配置不应提交到仓库

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Cloudflare D1
- DataForSEO
- OpenRouter（可选，用于语义过滤 / 意图补充）

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 复制环境变量模板

```bash
cp .env.local.example .env.local
```

3. 初始化 D1 必要表

```bash
npx wrangler d1 execute <D1_DATABASE_NAME> --remote --file scripts/d1_auth_schema.sql
npx wrangler d1 execute <D1_DATABASE_NAME> --remote --file scripts/d1_jobs_schema.sql
npx wrangler d1 execute <D1_DATABASE_NAME> --remote --file scripts/d1_sitemaps_schema.sql
```

4. 启动开发环境

```bash
npm run dev
```

5. 访问本地地址

```text
http://localhost:3000
```

## 环境变量说明

请根据 `.env.local.example` 在本地配置环境变量。敏感信息只应保存在本地环境或 Cloudflare Secret 中，不要写入仓库。

常见配置分类如下：

- DataForSEO 账号配置
- 基准词与任务轮询配置
- OpenRouter 配置（可选）
- Cloudflare / D1 部署配置
- 鉴权 Cookie / Cron Secret 等安全配置

## 目录说明

- `app/dashboard/*`：前端页面，包括扩词、候选词、分析、新游发现等模块
- `app/api/*`：API 路由，包括 auth、research、sitemaps、integrations 等
- `lib/keyword-research.ts`：关键词扩展、过滤、对比的核心逻辑
- `lib/context/research-context.tsx`：前端全局状态与任务轮询
- `lib/sitemap-discovery.ts`：sitemap 来源发现与扫描逻辑
- `lib/d1.ts`：D1 查询与写入封装
- `scripts/*.sql`：D1 数据表初始化与迁移脚本
- `discovery-feed-api.md`：对外数据接口说明

## Sitemap 自动发现

项目已支持基于 sitemap 的自动发现流程，并可配合 Cloudflare Cron 定时执行。

相关入口：

- 定时扫描接口：`POST /api/cron/discovery`
- 来源管理与扫描页面：`/dashboard/discovery`

部署时建议：

- 使用 Cloudflare Cron 定时触发扫描
- 通过 Secret 保护 cron 调用
- 不要在 README 或仓库中写入真实 token、数据库 ID、账号密码

如果数据库仍是旧版 `sitemap_sources` 结构，请先执行对应迁移脚本，补齐调度字段。

## 对外接口

项目支持通过 API 向第三方输出发现结果，接口文档见：

- `discovery-feed-api.md`

默认输出会尽量精简，只返回：

- 找到的词
- 命中原因

## 安全说明

本次已检查 README 内容：

- 未发现真实的 token、密码、账号、数据库 ID 等敏感值
- 原文件主要问题是文本编码污染，导致 GitHub 展示乱码

为避免后续误泄露，建议遵循下面的约束：

- 不在 README 中写入任何真实密钥
- 不提交 `.env.local`
- Cloudflare Secret、第三方 API Key 仅在部署环境配置

## 备注

如果你准备将该项目部署到 Cloudflare，建议优先检查：

- D1 表结构是否已完成最新迁移
- Cron 所需 Secret 是否已配置
- DataForSEO / OpenRouter 等外部依赖是否已正确注入环境变量
