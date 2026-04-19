# google_keywords 项目架构文档

> 更新时间：2026-04-19 | 剑主维护
> 项目地址：https://discoverkeywords.co
> Git：https://github.com/security00/google_keywords.git

---

## 一、全局概览

```
┌─────────────────────────────────────────────────────────────┐
│                     discoverkeywords.co                      │
│                  Cloudflare Worker + D1 数据库                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ 学员页面  │  │ 管理后台  │  │ API 端点  │  │ Cron/脚本 │   │
│  │ (SSR/CSR)│  │ (CSR)    │  │ (Worker)  │  │ (Python) │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │              │          │
│       └─────────────┴──────┬──────┴──────────────┘          │
│                            │                                 │
│                   ┌────────▼────────┐                       │
│                   │   D1 数据库      │                       │
│                   │   `ai-trends`    │                       │
│                   └────────┬────────┘                       │
│                            │                                 │
│              ┌─────────────┼─────────────┐                  │
│              │             │             │                   │
│        ┌─────▼────┐ ┌─────▼────┐ ┌──────▼─────┐            │
│        │ 缓存层    │ │ 会话层   │ │ 业务数据层  │            │
│        │ 4张表     │ │ 2张表    │ │ 10+张表     │            │
│        └──────────┘ └──────────┘ └────────────┘            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  ┌──────────────┐            ┌──────────────────┐
  │  DataForSEO   │            │   OpenRouter      │
  │  (付费 API)   │            │   (LLM 过滤)      │
  │  趋势/SERP    │            │                   │
  └──────────────┘            └──────────────────┘
```

## 二、技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 框架 | Next.js (App Router) | SSR + CSR 混合 |
| 构建 | @opennextjs/cloudflare | 输出 Worker 兼容格式 |
| 运行时 | Cloudflare Worker | CPU 30s 限制，内存 128MB |
| 数据库 | Cloudflare D1 (SQLite) | 通过 HTTP API 访问，非 binding |
| 部署 | wrangler deploy | 两步：build → deploy |
| 图表 | recharts | 游戏趋势对比图 |
| UI | shadcn/ui + Tailwind | 组件库 |
| 外部 API | DataForSEO | Google Trends + SERP（付费，按次计费） |
| LLM | OpenRouter | 关键词过滤和意图分类 |
| 脚本 | Python 3 | 预计算、游戏扫描、发现爬虫 |

### ⚠️ 关键限制

- **Worker CPU 30s 超时** — 所有同步 API 必须在此内完成
- **D1 通过 HTTP API 访问** — 使用 `d1Query()` 封装，不是 Worker binding
- **wrangler.toml 在 .gitignore** — 本地构建必须存在
- **CI 部署无效** — 必须手动 `npx opennextjs-cloudflare build && npx wrangler deploy`

## 三、认证系统

```
┌─────────────────────────────────────────────┐
│               认证流程                        │
│                                              │
│  注册 ──▶ invite_code 验证                   │
│    │         │                               │
│    ▼         ▼                               │
│  auth_users_v2          auth_sessions        │
│  ├─ id (UUID)           ├─ id               │
│  ├─ email               ├─ user_id          │
│  ├─ password_hash       ├─ token_hash (SHA256)│
│  ├─ role                ├─ created_at        │
│  ├─ trial_started_at    └─ expires_at (7天)  │
│  └─ trial_expires_at                         │
│                                              │
│  认证方式:                                    │
│  1. Cookie (kr_session) — 浏览器登录          │
│  2. Bearer Token (gk_live_...) — API/Skill   │
│  3. x-cron-secret — Cron 脚本                │
│                                              │
│  ⚠️ 单点登录: 新登录会删掉该用户所有旧 session │
└─────────────────────────────────────────────┘
```

### 认证函数分工

| 函数 | 位置 | 用途 |
|---|---|---|
| `getAuthUser()` | `lib/auth.ts` | Cookie 认证，返回用户信息 |
| `authenticate()` | `lib/auth_middleware.ts` | 三合一：Bearer / Query / Cookie |
| `requireAdmin()` | `lib/admin.ts` | getAuthUser + role=admin 检查 |
| `checkStudentAccess()` | `lib/usage.ts` | 检查试用是否过期 |

### API Key 系统

- 格式：`gk_live_` + 32-64 位 hex（正则 `/^gk_live_[0-9a-f]{32,64}$/`）
- 存储：`api_keys` 表，`user_id` 是 INTEGER（已知 TEXT 不匹配，低风险）
- 限流：内存 Map，IP+UA 指纹，10 次失败 → 15 分钟封禁
- 每用户最多 5 个活跃 key
- 管理 key（本地脚本用）：`gk_live_*************************`

## 四、核心业务：关键词研究管道

### 4.1 Expand 管道（主流程）

```
学员/风探 发起请求
       │
       ▼
POST /api/research/expand
       │
       ├─ 认证 (authenticate)
       ├─ checkStudentAccess
       ├─ normalizeKeywords
       │
       ├─ D1 query_cache 查询
       │   ├─ 命中 → 返回缓存 jobId (fromCache: true)
       │   │   └─ 同时注入 gameKeywords
       │   └─ 未命中
       │       ├─ 学员 → 409 cache_miss（不触发计费）
       │       │   └─ 尝试 fallback:
       │       │       1. getLatestSuccessfulSharedExpandResult
       │       │       2. _trimmed 版本（200条，防 CPU 超时）
       │       │       3. getLatestSuccessfulSharedExpandResultAny
       │       └─ Cron → 提交 DataForSEO 任务
       │
       ▼
DataForSEO 异步处理
       │
       ├─ Postback → POST /api/research/webhook
       │   └─ 存入 postback_results + query_cache
       │
       ▼
GET /api/research/expand/status?jobId=X
       │
       ├─ 检查 postback_results
       ├─ 解析 DataForSEO 数据 (top/rising)
       ├─ Rule Engine 预过滤 (lib/rule-engine.ts)
       ├─ LLM 过滤 (filter_cache 去重)
       ├─ 保存 keyword_history
       ├─ 评分 (score) + 标记 (isNew)
       ├─ SERP 交叉验证 (top 20, serp_confidence_cache)
       ├─ Trends 对比 (top 10 vs "gpts" 基准)
       ├─ 持久化 session (research_sessions + candidates)
       └─ 返回完整结果 (含 gameKeywords)
```

### 4.2 缓存层（4 层）

| 缓存表 | 键格式 | 作用 | 过期策略 |
|---|---|---|---|
| `query_cache` | `query_type:sorted_keywords:date` | 共享缓存，学员免计费 | 按天自然过期 |
| `postback_results` | `pb_{task_id}` | DataForSEO 原始回调数据 | 永久（查询用） |
| `filter_cache` | `cache_key` | LLM 过滤结果去重 | 按天自然过期 |
| `serp_confidence_cache` | `keyword_normalized:cache_date` | SERP 置信度去重 | 按天自然过期 |

### 4.3 预计算系统

```
每日 UTC 00:05 触发
       │
       ▼
scripts/precompute_shared_expand.py
       │
       ├─ 读取 127 个种子关键词 (config/seed-keywords.txt)
       ├─ 分 26 批，每批 5 个关键词
       ├─ 调用 expand API (x-cron-secret)
       ├─ 调用 trends API (对比基准)
       ├─ 结果存入 D1 query_cache
       ├─ 自动存储 _trimmed 版本（top 200）
       └─ 同步健康状态到线上 (/api/admin/precompute-health)

健康文件：
  /root/.local/state/google_keywords/precompute_state_YYYY-MM-DD.json
  /root/.local/state/google_keywords/precompute_health_YYYY-MM-DD.json

Watchdog:
  每 10 分钟检查，失败自动补偿
  Cron ID: 69ec6b9f
```

### 4.4 DataForSEO 集成

| 端点 | 用途 | 计费 |
|---|---|---|
| `keywords_data/google_trends/explore/live` | 关键词扩展（expand） | ~$0.005/词 |
| `keywords_data/google_trends/explore/live`（compare 模式）| 趋势对比 | ~$0.005/词 |
| `serp/google/organic/live/advanced` | SERP 竞争分析 | ~$0.01/词 |

- 所有 DataForSEO 凭证是 Worker secrets（本地不可用）
- Postback URL：`https://www.discoverkeywords.co/api/research/webhook`
- IP 白名单：6 个 DataForSEO V3 IP
- ⚠️ Postback 对 trends 任务不稳定，trends 改用主动轮询

## 五、游戏关键词管道

```
每日 UTC 10:00 触发
       │
       ▼
scripts/game_trend_scanner.py
       │
       ├─ Phase 1a: CrazyGames /new (~68 游戏)
       │   └─ curl subprocess (Python urllib 被 CF 拦截)
       │
       ├─ Phase 1b: D1 discovered_keywords (近 7 天)
       │   └─ 目前无新数据（discovery_scan 已停）
       │
       ├─ Phase 2: Steam API new_releases (~26 游戏)
       │   └─ store.steampowered.com/api/featured
       │
       ├─ 合并去重 (~94 个)
       │
       ├─ 过滤: 长度 3-40、去垃圾、D1 去重
       │
       ├─ Phase 3: 异步 Trends 批量对比 (14天窗口 vs "gpts")
       │   └─ POST /api/research/trends → GET .../status 轮询
       │
       ├─ Phase 4: SERP 竞争检查 (所有关键词)
       │
       ├─ Phase 5: 4 级评分
       │   ├─ 🔥 Hot: ratio ≥ 2.0
       │   ├─ 📈 Rising: ratio ≥ 0.5 + slope > 0 + 有权威站
       │   ├─ 🎯 Niche: 低 SERP 竞争
       │   └─ ⏭️ Skip: 趋势太低或下滑
       │
       ├─ 存入 D1 game_keyword_pipeline
       ├─ 推送结果到天机阁群
       └─ 管理后台 + 学员页面展示
```

## 六、API 端点清单

### 研究类（核心）

| 端点 | 方法 | 认证 | 缓存 | 同步/异步 |
|---|---|---|---|---|
| `/api/research/expand` | POST | authenticate + cron | query_cache | 异步 (jobId) |
| `/api/research/expand/status` | GET | authenticate | 无 | 轮询 |
| `/api/research/expand/cache` | POST | cron only | 写缓存 | 同步 |
| `/api/research/expand/webhook` | POST | IP 白名单 | postback_results | 被动接收 |
| `/api/research/trends` | POST | authenticate | query_cache | 异步 (jobId) |
| `/api/research/trends/status` | GET | authenticate | 无 | 主动轮询 DataForSEO |
| `/api/research/serp` | POST | authenticate | query_cache | 同步 (~30s) |
| `/api/research/compare` | POST | authenticate | query_cache | 异步 |
| `/api/research/compare/status` | GET | authenticate | 无 | 轮询 |
| `/api/research/history` | GET | authenticate | keyword_history | 同步 |
| `/api/research/trending` | GET | authenticate | - | 同步 |
| `/api/research/webhook` | POST | IP 白名单 | postback_results | 被动接收 |

### 认证类

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/auth/sign-up` | POST | 注册（需 invite code）|
| `/api/auth/sign-in` | POST | 登录（单点登录，踢旧 session）|
| `/api/auth/sign-out` | POST | 登出 |
| `/api/auth/session` | GET | 获取当前用户 |
| `/api/auth/access` | GET | 检查访问权限 |
| `/api/auth/keys` | GET/POST/DELETE | API Key 管理 |

### 管理类

| 端点 | 方法 | 认证 |
|---|---|---|
| `/api/admin/users` | GET/POST | requireAdmin |
| `/api/admin/users/[id]` | GET/PATCH | requireAdmin |
| `/api/admin/health` | GET | requireAdmin |
| `/api/admin/precompute-health` | GET/POST | admin / cron-secret |
| `/api/admin/game-keywords` | GET | 3 合 1: admin / API key / cookie |
| `/api/admin/invite-codes` | GET | requireAdmin |

### Sitemap 类（管理用）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/sitemaps/sources` | GET | 列出 sitemap 源 |
| `/api/sitemaps/sources/[id]` | PATCH | 启用/禁用源 |
| `/api/sitemaps/keywords` | GET | 已发现关键词 |
| `/api/sitemaps/scan` | POST | 触发扫描 |

## 七、前端页面

### 学员侧

| 路径 | 页面 | 说明 |
|---|---|---|
| `/dashboard` | 首页 | 扩展关键词输入 |
| `/dashboard/expand` | 扩展结果 | DataForSEO 结果展示 |
| `/dashboard/candidates` | 候选词 | 过滤后的关键词列表 |
| `/dashboard/analysis` | 分析 | SERP + 趋势分析 |
| `/dashboard/discovery` | 发现 | 历史会话 |
| `/dashboard/settings` | 设置 | API Key 管理 |
| `/dashboard/games` | 🎮 新游发现 | 游戏关键词推荐（今日新增）|

### 管理侧

| 路径 | 页面 |
|---|---|
| `/dashboard/admin` | 重定向到 health |
| `/dashboard/admin/health` | 系统健康面板 |
| `/dashboard/admin/users` | 用户管理（全部/待激活 Tab）|
| `/dashboard/admin/users/[id]` | 用户详情 |
| `/dashboard/admin/games` | 游戏关键词管理 |
| `/dashboard/admin/codes` | 邀请码管理 |

## 八、D1 数据库表

### 核心业务表

| 表名 | 用途 | 关键字段 |
|---|---|---|
| `auth_users_v2` | 用户 | id, email, role, trial_started_at, trial_expires_at |
| `auth_sessions` | 会话 | user_id, token_hash (SHA256), expires_at |
| `api_keys` | API 密钥 | key, user_id (⚠️INTEGER), active |
| `invite_codes` | 邀请码 | code, max_uses, used_count |
| `daily_api_usage` | 用量统计 | user_id, api_calls |

### 研究管道表

| 表名 | 用途 |
|---|---|
| `research_jobs` | 异步任务追踪 (expand/compare/trends/intent) |
| `research_sessions` | 研究会话持久化 (含 trends_summary) |
| `candidates` | 候选关键词 (含 score, confidence) |
| `postback_results` | DataForSEO 回调原始数据 |

### 缓存表

| 表名 | 键 | 过期 |
|---|---|---|
| `query_cache` | `query_type:keywords:dateFrom,dateTo` | 按天 |
| `filter_cache` | `cache_key` | 按天 |
| `serp_confidence_cache` | `keyword_normalized:cache_date` | 按天 |

### 游戏 & 发现表

| 表名 | 用途 |
|---|---|
| `game_keyword_pipeline` | 游戏关键词（含趋势/SERP/评分/趋势序列）|
| `discovered_keywords` | Sitemap 爬取的游戏名（目前停更）|
| `sitemap_sources` | 游戏站源列表（9 个启用，11 个禁用）|
| `keyword_history` | 关键词历史趋势 |
| `comparison_results` | 对比结果 |
| `comparisons` | 对比任务 |

## 九、外部依赖

### DataForSEO（付费，核心）

- 账号凭证：Worker secrets（本地不可用）
- 端点：Trends Explore + SERP Organic
- Postback：不稳定，trends 已改用主动轮询
- 月成本（预计算模式）：~$2.4/月
- 月成本（无预计算）：~$120/月

### OpenRouter（LLM 过滤）

- 模型：`openai/gpt-5.2`
- 用途：关键词过滤、意图分类
- 凭证：Worker secret

### Steam API（免费）

- `store.steampowered.com/api/featured`
- 每日 ~26 个新游戏

### CrazyGames（免费）

- `/new` 页面（需 curl subprocess）
- 每日 ~68 个新游戏
- ⚠️ Python urllib 被 CF challenge 拦截

## 十、Cron 作业

| Cron ID | 名称 | 频率 | 说明 |
|---|---|---|---|
| `6544d7a8` | 预计算 | 每日 UTC 00:05 | 127 种子词，run_precompute_with_retry.sh |
| `69ec6b9f` | Watchdog | 每 10 分钟 | 检查预计算状态，失败补偿 |
| `5f304af8` | 游戏扫描 | 每日 UTC 10:00 | CrazyGames + Steam，推送天机阁 |
| `b8a57915` | Discovery Scan | **已禁用** | urllib 被 CF 拦截 |

## 十一、关键文件路径

```
/root/clawd/projects/google_keywords/          ← 项目根目录
├── app/
│   ├── api/                                   ← 所有 API 路由
│   └── dashboard/                             ← 前端页面
├── lib/
│   ├── auth.ts                                ← 认证核心（单点登录）
│   ├── auth_middleware.ts                     ← 三合一认证
│   ├── admin.ts                               ← 管理函数
│   ├── api_keys.ts                            ← API Key 管理
│   ├── cache.ts                               ← 4 层缓存操作
│   ├── d1.ts                                  ← D1 HTTP API 封装
│   ├── keyword-research.ts                    ← DataForSEO 客户端（2694行！）
│   ├── research-jobs.ts                       ← 异步任务管理
│   ├── rule-engine.ts                         ← 规则引擎预过滤
│   ├── session-store.ts                       ← 会话持久化
│   ├── types.ts                               ← 类型定义
│   └── usage.ts                               ← 用量检查
├── scripts/
│   ├── game_trend_scanner.py                  ← 游戏关键词扫描
│   ├── precompute_shared_expand.py            ← 每日预计算
│   └── discovery_scan.py                      ← Sitemap 爬虫（已停）
├── config/
│   └── seed-keywords.txt                      ← 127 个种子关键词
└── wrangler.toml                              ← CF 配置（.gitignore）

/root/.openclaw/workspace-potter-dev/.env      ← CF/GH 凭证
/root/.config/google_keywords/precompute.env   ← 预计算脚本配置
/root/.local/state/google_keywords/            ← 本地健康文件
```

## 十二、已知技术债 & 风险

| # | 问题 | 风险 | 优先级 |
|---|---|---|---|
| 1 | DataForSEO postback 投递不稳定 | 当日预计算可能无数据，学员 fallback 可能 CPU 超时 | 高 |
| 2 | `api_keys.user_id` INTEGER vs TEXT | 低风险（SQLite 弱类型），但欠债 | 低 |
| 3 | VPS curl 依赖 | CF 可能加强防护，Python 不可用 | 中 |
| 4 | keyword-research.ts 2694 行 | 单文件过大，难维护 | 中 |
| 5 | SERP/Trends 同步路由 | Worker CPU 30s 限制，已改 trends 为异步 | 低 |
| 6 | SERP confidence cache 未端到端验证 | 可能未生效 | 中 |
| 7 | CF 安全加固未做 | 无 WAF，暴露技术栈信息 | 低 |
| 8 | potter-ops tool gating 未解决 | agent cron 发不出消息 | 中 |

## 十三、部署流程

```bash
# 1. 加载凭证
source /root/.openclaw/workspace-potter-dev/.env

# 2. 构建（必须）
cd /root/clawd/projects/google_keywords
npx opennextjs-cloudflare build

# 3. 部署（必须用 API token，不能 OAuth）
CLOUDFLARE_API_TOKEN=$CF_API_TOKEN npx wrangler deploy

# 4. 提交代码
git add -A && git commit -m "xxx" && git push origin main
```

⚠️ **注意：**
- `npx opennextjs-cloudflare deploy` 会清除构建产物，必须分两步
- CI 的 GitHub Actions 部署不生效，只用于 lint/test
- `wrangler.toml` 在 `.gitignore`，但本地必须存在
