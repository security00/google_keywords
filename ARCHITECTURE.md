# google_keywords 项目架构文档

> 更新时间：2026-04-22 | 剑主维护
> 项目地址：https://discoverkeywords.co
> Git：https://github.com/security00/google_keywords.git（公开仓库，**禁止写入任何密钥/凭证**）

---

## 一、全局概览

```
┌──────────────────────────────────────────────────────────────────────┐
│                        discoverkeywords.co                             │
│                     Cloudflare Worker + D1 数据库                      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ 学员页面  │  │ 管理后台  │  │ API 端点  │  │ Cron / Python 脚本  │  │
│  │ (SSR/CSR)│  │ (CSR)    │  │ (Worker)  │  │ (预计算/扫描/采集)  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬───────────┘  │
│       │             │             │                   │               │
│       └─────────────┴──────┬──────┴───────────────────┘               │
│                            │                                          │
│                   ┌────────▼────────┐                                │
│                   │   D1 数据库      │                                │
│                   │   (SQLite)       │                                │
│                   └────────┬────────┘                                │
│                            │                                          │
│              ┌─────────────┼─────────────┐                           │
│              │             │             │                             │
│        ┌─────▼────┐ ┌─────▼────┐ ┌──────▼─────┐                    │
│        │ 缓存层    │ │ 会话层   │ │ 业务数据层  │                     │
│        │ 4张表     │ │ 2张表    │ │ 19张表     │                     │
│        └──────────┘ └──────────┘ └────────────┘                     │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
         │              │               │              │
         ▼              ▼               ▼              ▼
  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
  │ DataForSEO  │ │ OpenRouter │ │  HN Algolia │ │   GitHub   │
  │ (付费 API)  │ │ (LLM 过滤) │ │ (免费,社区) │ │  (免费)    │
  │ 趋势/SERP   │ │            │ │             │ │            │
  └────────────┘ └────────────┘ └────────────┘ └────────────┘
```

---

## 二、技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 框架 | Next.js (App Router) | SSR + CSR 混合 |
| 构建 | @opennextjs/cloudflare | 输出 Worker 兼容格式 |
| 运行时 | Cloudflare Worker | CPU 30s 限制，内存 128MB |
| 数据库 | Cloudflare D1 (SQLite) | 通过 HTTP API 访问（`d1Query()` 封装） |
| 部署 | wrangler deploy | CI: GitHub Actions → wrangler deploy |
| 图表 | recharts | 游戏趋势对比图 + 老词趋势图 |
| UI | shadcn/ui + Tailwind | 组件库 |
| 外部 API | DataForSEO | Google Trends + SERP（付费，按次计费） |
| LLM | OpenRouter | 关键词过滤和意图分类 |
| 社区信号 | HN Algolia + GitHub | 免费公开 API |
| 脚本 | Python 3 | 预计算、游戏扫描、老词管线、社区信号采集 |

### ⚠️ 关键限制

- **Worker CPU 30s 超时** — 所有同步 API 必须在此内完成
- **D1 通过 HTTP API 访问** — 业务代码主要使用 `d1Query()` 封装；Worker 仍保留 `DB` binding 作为运行时配置一致性保障
- **Wrangler 配置唯一源** — `wrangler.jsonc` 是 canonical 配置文件，CI 显式 `--config wrangler.jsonc`
- **仓库公开** — 严禁写入密钥、凭证、内部 URL
- **CI 部署** — GitHub Actions 自动部署（pin wrangler@4.83.0）

---

## 三、三条关键词路径

本项目有三条独立的发现路径，最终在学员端统一展示：

```
┌─────────────────────────────────────────────────────────────────────┐
│                      三条关键词发现路径                                │
│                                                                      │
│  ┌─────────────────────┐   ┌─────────────────────┐                 │
│  │  路径1: 新词扩展      │   │  路径2: 老词推荐      │                 │
│  │  (Expand Pipeline)  │   │  (Old Word Pipeline) │                 │
│  │                     │   │                     │                 │
│  │  127个种子词 →       │   │  5个种子词 →         │                 │
│  │  DataForSEO expand  │   │  DataForSEO expand  │                 │
│  │  → LLM过滤 → SERP   │   │  → 二次扩展 → 过滤   │                 │
│  │  → 趋势对比 → 评分   │   │  → 趋势 → 评分      │                 │
│  │                     │   │                     │                 │
│  │  输出: 全量候选池     │   │  输出: 千人千面3词   │                 │
│  │  (无千人千面)        │   │  (hash选词)         │                 │
│  └──────────┬──────────┘   └──────────┬──────────┘                 │
│             │                         │                             │
│             └────────────┬────────────┘                             │
│                          │                                          │
│  ┌───────────────────────▼─────────────────────┐                  │
│  │  路径3: 新游发现 (Game Discovery Pipeline)   │                  │
│  │                                             │                  │
│  │  CrazyGames /new  → ~68个/天                 │                  │
│  │  Poki /new        → ~20个/天                 │                  │
│  │  Addicting Games  → ~2个/周                  │                  │
│  │  → 趋势检查(14天) → SERP → 4级评分           │                  │
│  │  → 历史基线检查(防老游戏)                    │                  │
│  │                                             │                  │
│  │  输出: 千人千面3词 (hash选词)                │                  │
│  └─────────────────────────────────────────────┘                  │
│                                                                      │
│  学员端展示:                                                          │
│  ├─ /dashboard/candidates    新词: 全量推荐池                         │
│  ├─ /dashboard/old-keywords  老词: 3个/人 (千人千面)                  │
│  └─ /dashboard/games         游戏词: 3个/人 (千人千面)               │
└─────────────────────────────────────────────────────────────────────┘
```

### 千人千面机制

三条路径中，老词和游戏词实现了千人千面，新词展示全量池：

| 路径 | 千人千面 | 机制 | 位置 |
|---|---|---|---|
| 新词 (Expand) | ❌ 不做 | 候选词不多，全部展示 | 前端 buildRecommendedSelection |
| 老词 (Old Words) | ✅ 3个/人 | 服务端 hash(userId) 选词 | `/api/old-keywords` route.ts |
| 游戏词 (Games) | ✅ 3个/人 | 服务端 hash(userId) 选词 | `/api/game-keywords` route.ts |

**Hash 算法（三处统一）：**
```typescript
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
// 选词: result[(hash + i * 7) % total]
```

---

## 四、认证系统

```
┌─────────────────────────────────────────────────┐
│                  认证架构                         │
│                                                  │
│  认证方式:                                        │
│  1. Cookie (kr_session) — 浏览器登录             │
│  2. Bearer Token (gk_live_xxx) — API/Skill      │
│  3. x-cron-secret — Cron 脚本                    │
│                                                  │
│  用户角色:                                        │
│  ├─ admin   — 管理员，全部权限                     │
│  └─ student — 学员，受限访问                       │
│                                                  │
│  认证函数:                                        │
│  ├─ getAuthUser()       → Cookie认证              │
│  ├─ authenticate()      → 三合一(Bearer/Query/Cookie)│
│  ├─ requireAdmin()      → admin session认证        │
│  ├─ validateApiKey()    → API Key验证              │
│  └─ checkStudentAccess()→ 试用期检查               │
│                                                  │
│  ⚠️ 单点登录: 新登录会删掉该用户所有旧 session      │
│  ⚠️ 401 全局拦截: 未登录/过期自动跳转登录页         │
└─────────────────────────────────────────────────┘
```

### API Key 系统

- 格式：`gk_live_` + 32-64 位 hex
- 存储：`api_keys` 表（key 列存完整 key，通过 validateApiKey 验证）
- 限流：内存 Map，IP+UA 指纹，10 次失败 → 15 分钟封禁
- 每用户最多 5 个活跃 key
- ⚠️ 连续失败会被自动禁用（active=0），需手动恢复

### 角色检测（风探 Skill 用）

```
风探 Skill 持有 API Key
       │
       ▼
GET /api/me (Bearer key)
       │
       ├─ 返回 { id, role, email }
       │
       ├─ role === "admin"  → 走管理端接口 (全量数据)
       └─ role === "student" → 走学生端接口 (千人千面)
```

### 权限隔离

| 接口类型 | Admin | Student | 匿名 |
|---|---|---|---|
| `/api/admin/*` | ✅ | ❌ 403 | ❌ 403 |
| `/api/game-keywords` | ✅ (但建议用admin接口) | ✅ 3词 | ❌ 401 |
| `/api/old-keywords` | ✅ | ✅ 3词 | ❌ 401 |
| `/api/me` | ✅ | ✅ | ❌ 401 |
| `/api/research/*` | ✅ (可触发计费) | ✅ (走缓存) | ❌ 401 |

**Admin 接口权限校验流程（`/api/admin/game-keywords` 为例）：**
```
请求进入
  │
  ├─ requireAdmin() session 检查 → 通过 → 放行
  │
  ├─ Bearer Token 检查
  │   ├─ validateApiKey() 验证 key
  │   ├─ 查询用户 role
  │   └─ role === "admin" → 放行 / 否则 → 403
  │
  └─ 都不满足 → 403
```

---

## 五、路径1: 新词扩展管道 (Expand Pipeline)

### 5.1 主流程

```
学员/风探 发起请求
       │
       ▼
POST /api/research/expand
       │
       ├─ authenticate() 认证
       ├─ checkStudentAccess() 检查试用期
       ├─ normalizeKeywords() 标准化
       │
       ├─ D1 query_cache 查询
       │   ├─ 命中 → 返回缓存 jobId (fromCache: true)
       │   │   └─ 同时注入 gameKeywords
       │   └─ 未命中
       │       ├─ 学员 → 返回 fallback 缓存 (不触发计费)
       │       │   └─ fallback 优先级:
       │       │       1. getLatestSuccessfulSharedExpandResult (完整)
       │       │       2. _trimmed 版本 (top 200，防 CPU 超时)
       │       │       3. getLatestSuccessfulSharedExpandResultAny
       │       └─ Cron → 提交 DataForSEO 异步任务
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
       ├─ SERP 交叉验证 (top 20)
       ├─ Trends 对比 (top 10 vs benchmark)
       ├─ 持久化 session (research_sessions + candidates)
       └─ 返回完整结果
```

### 5.2 缓存层（4 层）

| 缓存表 | 键格式 | 作用 | 过期策略 |
|---|---|---|---|
| `query_cache` | `query_type:sorted_keywords:date` | 共享缓存，学员免计费 | 按天自然过期 |
| `postback_results` | `pb_{task_id}` | DataForSEO 原始回调数据 | 永久（查询用） |
| `filter_cache` | `cache_key` | LLM 过滤结果去重 | 按天自然过期 |
| `serp_confidence_cache` | `keyword_normalized:cache_date` | SERP 置信度去重 | 按天自然过期 |

### 5.3 预计算系统

```
每日 UTC 00:05 触发（stagger 5min）
       │
       ▼
scripts/precompute_shared_expand.py
       │
       ├─ 读取 127 个种子关键词 (config/seed-keywords.txt)
       ├─ 分批，每批 5 个关键词
       ├─ 调用 expand API (x-cron-secret 认证)
       ├─ 调用 compare/trends API (对比基准)
       ├─ LLM 重过滤 + 意图识别
       ├─ 结果存入 D1 query_cache
       ├─ 自动存储 _trimmed 版本（top 200）
       └─ 同步健康状态到线上

⚠️ 预计算 LLM 过滤保留游戏关键词:
   - filter_terms 中不含 "games"
   - LLM prompt 包含 "online games, game tools, game platforms"
   - 游戏词可通过种子词扩展被发现

失败告警:
  ├─ 脚本层: try/except → Telegram
  └─ Cron 层: 连续失败 2 次 → Telegram 通知

Watchdog:
  每 10 分钟检查，失败自动补偿
```

---

## 六、路径2: 老词管道 (Old Word Pipeline)

```
每周一 UTC 06:00 触发
       │
       ▼
scripts/old_word_pipeline.py
       │
       ├─ Phase 1: DataForSEO batch (5个种子词)
       │   └─ 获取大量相关关键词 + 搜索量/CPC/KD
       │
       ├─ Phase 2: 二次扩展 (取 top 100)
       │   └─ 每个词再 expand 获取更多变体
       │
       ├─ Phase 3: 过滤 (2000+ → ~200)
       │   ├─ KD < 30
       │   ├─ 搜索量 > 1000
       │   ├─ CPC > 0（排除无商业价值词）
       │   └─ 排除品牌词/竞品词
       │
       ├─ Phase 4: 趋势获取 (top 50)
       │   └─ 12个月趋势，计算 head/tail ratio
       │   └─ 🔴 SPIKE (ratio < 0.5) → 清除趋势数据
       │   └─ 🟡 DECLINE (ratio < 0.8) → 保留观察
       │   └─ 🟢 STABLE/RISING → 保留推荐
       │
       └─ Phase 5: 写入 old_keyword_opportunities

每周二 UTC 07:00: 社区信号采集
       │
       ▼
scripts/fetch_community_signals.py
       │
       ├─ HN Algolia (points/comments)
       ├─ GitHub Search (stars)
       └─ 24h 缓存，存入 community_signals
```

### 学员端老词推荐（千人千面）

```
GET /api/old-keywords
       │
       ├─ authenticate() 认证
       ├─ 从 trend_series IS NOT NULL AND cpc > 0 中选
       ├─ 按 score DESC 排序
       ├─ simpleHash(userId) → 确定性偏移
       ├─ 选 3 个词 (hash + i*7) % total
       └─ 返回关键词 + 12个月趋势数据
```

---

## 七、路径3: 新游发现管道 (Game Discovery Pipeline)

### 7.1 数据源

| 数据源 | 端点 | 频率 | 数量 | 说明 |
|---|---|---|---|---|
| CrazyGames | `/new` | 每日 | ~68个 | 最大源，需 curl subprocess（Python urllib 被 CF 拦截） |
| Poki | JSON-LD `/new` | 每日 | ~20个 | 页面内嵌结构化数据 |
| Addicting Games | `/new-games` | 每周 | ~2个 | 14天内新游戏 |

**已移除的数据源：**
- ~~Steam~~ — 付费游戏，搜索意图不匹配
- ~~Sitemap Discovery~~ — 噪音大，老游戏多，已停更

### 7.2 扫描流程

```
每日 UTC 10:00 触发
       │
       ▼
scripts/game_trend_scanner.py
       │
       ├─ Phase 1: 数据采集
       │   ├─ CrazyGames /new → ~68 游戏
       │   ├─ Poki /new (JSON-LD) → ~20 游戏
       │   ├─ Addicting Games /new-games → ~2 游戏 (14天内)
       │   └─ 合并去重 → ~90 个候选
       │
       ├─ Phase 2: 去重
       │   └─ 排除 D1 中已 trend_checked 的词
       │
       ├─ Phase 3: 趋势检查 (14天窗口 vs benchmark)
       │   └─ POST /api/research/trends → 轮询 status
       │   └─ 批量 5 个词，最多 50 个关键词
       │   └─ 结果缓存: 有缓存直接用
       │
       ├─ Phase 3.5: 历史基线检查 (防老游戏)
       │   ├─ 对 ratio ≥ 0.1 的词查 90 天历史均值
       │   ├─ 🔴 OLD: hist_avg > 20 → 标记为已建立搜索量
       │   └─ 🟢 NEW: hist_avg < 20 → 保留为新发现
       │
       ├─ Phase 4: SERP 竞争检查
       │   └─ 批量查询 Google 前 10 页
       │   └─ 检查: organic 数量、权威站、featured snippet
       │
       ├─ Phase 5: 4 级评分
       │   ├─ 🔥 Hot: ratio ≥ 2.0 + slope > 0
       │   ├─ 📈 Rising: ratio ≥ 0.5 + slope > 0 + 有权威站
       │   ├─ 🎯 Niche: 低 SERP 竞争 + 有趋势
       │   └─ ⏭️ Skip: 趋势太低/下滑/老游戏
       │
       ├─ Phase 6: LLM 意图分类
       │   └─ 对推荐词做 intent 分析 (game tool / game search / etc)
       │
       └─ 存入 D1 game_keyword_pipeline + 推送结果到天机阁群
```

### 7.3 推荐门槛

```
关键词必须同时满足:
  ├─ trend_ratio ≥ 1.0 (当前搜索量 ≥ benchmark 的 100%)
  ├─ 非 OLD (90天历史均值 < 20)
  ├─ 14天窗口内有实际搜索量
  └─ recommendation ≠ "⏭️ skip"
```

### 7.4 学员端游戏词推荐（千人千面）

```
GET /api/game-keywords
       │
       ├─ authenticate() 认证
       ├─ 从 game_keyword_pipeline 中查 status='recommended'
       ├─ ORDER BY trend_ratio DESC
       ├─ simpleHash(userId) → 确定性偏移
       ├─ 选 3 个词 (hash + i*7) % total
       └─ 返回: keyword, source, ratio, slope, verdict
```

### 7.5 管理端游戏词管理

```
GET /api/admin/game-keywords
       │
       ├─ requireAdmin() + API Key role 检查
       ├─ 支持分页 (pageSize, page)
       ├─ 支持过滤 (?filter=recommended)
       └─ 返回全量数据 + trend_series JSON
```

---

## 八、风探 Skill 集成

```
风探 Skill (keyword-research-agent)
       │
       ├─ 环境变量
       │   ├─ GK_SITE_URL → 线上地址
       │   └─ GK_API_KEY → 管理员 API Key
       │
       ├─ 调用方传入 student_api_key (可选)
       │   │
       │   ├─ 有 student_api_key
       │   │   ├─ GET /api/me → 检查 role
       │   │   ├─ student → 走学生端接口 (千人千面)
       │   │   │   ├─ /api/game-keywords (3个)
       │   │   │   └─ build_recommended_selection (2个)
       │   │   └─ admin → 走管理端接口 (全量)
       │   │
       │   └─ 无 student_api_key (管理员模式)
       │       ├─ /api/admin/game-keywords (全量)
       │       └─ build_recommended_selection (全量)
       │
       └─ 统一入口: get_complete_keyword_research()
           ├─ keywords: 种子词列表
           ├─ student_api_key: 学员 key (可选)
           └─ 返回: expand + compare + opportunities + gameKeywords
```

---

## 九、社区信号系统 (Community Signals)

### 数据源

| API | 端点 | 认证 | 返回字段 |
|---|---|---|---|
| HN Algolia | `hn.algolia.com/api/v1/search` | 无需 | points, num_comments, title, url |
| GitHub Search | `api.github.com/search/repositories` | GitHub Token | stargazers_count, full_name, html_url |

### 采集流程

```
scripts/fetch_community_signals.py
       │
       ├─ 输入: 关键词列表
       ├─ 24h 缓存（检查 updated_at）
       ├─ HN: 搜索 story，取 top 1
       ├─ GitHub: 搜索 repo，取 top 1
       ├─ 写入 community_signals 表
       └─ 限速: 每词间隔 0.5s
```

---

## 十、前端页面

### 学员侧

| 路径 | 页面 | 说明 |
|---|---|---|
| `/dashboard` | 首页 | 扩展关键词输入 |
| `/dashboard/expand` | 扩展结果 | DataForSEO 结果展示 |
| `/dashboard/candidates` | 候选词 | 全量推荐池（无千人千面） |
| `/dashboard/analysis` | 分析 | SERP + 趋势分析 |
| `/dashboard/discovery` | 发现 | 历史会话 |
| `/dashboard/settings` | 设置 | API Key 管理 |
| `/dashboard/games` | 🎮 新游发现 | 千人千面 3 词/人 |
| `/dashboard/old-keywords` | 📊 老词推荐 | 千人千面 3 词/人 + 趋势图 |

### 管理侧

| 路径 | 页面 |
|---|---|
| `/dashboard/admin` | 重定向到 health |
| `/dashboard/admin/health` | 系统健康面板 |
| `/dashboard/admin/users` | 用户管理（全部/待激活 Tab） |
| `/dashboard/admin/users/[id]` | 用户详情 |
| `/dashboard/admin/games` | 游戏关键词管理 |
| `/dashboard/admin/old-keywords` | 老词管理（趋势图 + 评分 + 分页） |
| `/dashboard/admin/codes` | 邀请码管理 |

---

## 十一、API 端点清单

### 研究类（核心）

| 端点 | 方法 | 认证 | 缓存 | 同步/异步 |
|---|---|---|---|---|
| `/api/research/expand` | POST | authenticate + cron | query_cache | 异步 (jobId) |
| `/api/research/expand/status` | GET | authenticate | 无 | 轮询 |
| `/api/research/expand/cache` | POST | cron only | 写缓存 | 同步 |
| `/api/research/webhook` | POST | IP 白名单 | postback_results | 被动接收 |
| `/api/research/trends` | POST | authenticate | query_cache | 异步 (jobId) |
| `/api/research/trends/status` | GET | authenticate | 无 | 主动轮询 |
| `/api/research/trends-quick` | POST | authenticate | D1 trend data | 同步 |
| `/api/research/serp` | POST | authenticate | query_cache | 同步 |
| `/api/research/compare` | POST | authenticate | query_cache | 异步 |
| `/api/research/compare/status` | GET | authenticate | 无 | 轮询 |
| `/api/research/history` | GET | authenticate | keyword_history | 同步 |
| `/api/research/trending` | GET | authenticate | - | 同步 |

### 老词类

| 端点 | 方法 | 认证 | 说明 |
|---|---|---|---|
| `/api/old-keywords` | GET | authenticate | 学员端：千人千面 3 词 + 趋势 |
| `/api/admin/old-keywords` | GET | admin only | 管理端：全量 + 分页 + 趋势图数据 |

### 游戏词类

| 端点 | 方法 | 认证 | 说明 |
|---|---|---|---|
| `/api/game-keywords` | GET | authenticate | 学员端：千人千面 3 词 |
| `/api/admin/game-keywords` | GET | admin only | 管理端：全量 + 分页 + 过滤 |

### 用户/角色类

| 端点 | 方法 | 认证 | 说明 |
|---|---|---|---|
| `/api/me` | GET | authenticate | 返回 { id, role, email }，用于角色检测 |
| `/api/auth/sign-up` | POST | 无 | 注册（需 invite code） |
| `/api/auth/sign-in` | POST | 无 | 登录（单点登录，踢旧 session） |
| `/api/auth/sign-out` | POST | 无 | 登出 |
| `/api/auth/session` | GET | cookie | 获取当前用户 { user: { id, email, role } } |
| `/api/auth/access` | GET | authenticate | 检查访问权限 |
| `/api/auth/keys` | GET/POST/DELETE | authenticate | API Key 管理 |

### 管理类

| 端点 | 方法 | 认证 |
|---|---|---|
| `/api/admin/users` | GET/POST | admin only |
| `/api/admin/users/[id]` | GET/PATCH | admin only |
| `/api/admin/health` | GET | admin only |
| `/api/admin/precompute-health` | GET/POST | admin / cron-secret |
| `/api/admin/invite-codes` | GET | admin only |

---

## 十二、D1 数据库表

### 认证 & 用户

| 表名 | 用途 | 关键字段 |
|---|---|---|
| `auth_users_v2` | 用户 | id, email, role, trial_started_at, trial_expires_at |
| `auth_sessions` | 会话 | user_id, token_hash (SHA256), expires_at |
| `api_keys` | API 密钥 | key, user_id, name, active |
| `invite_codes` | 邀请码 | code, max_uses, used_count |
| `daily_api_usage` | 用量统计 | user_id, api_calls |

### 研究管道

| 表名 | 用途 |
|---|---|
| `research_jobs` | 异步任务追踪 (expand/compare/trends/intent) |
| `research_sessions` | 研究会话持久化 (含 trends_summary) |
| `candidates` | 候选关键词 (含 score, confidence) |
| `postback_results` | DataForSEO 回调原始数据 |
| `keyword_history` | 关键词历史趋势 |
| `comparison_results` | 对比结果 |
| `comparisons` | 对比任务 |

### 缓存

| 表名 | 键 | 过期 |
|---|---|---|
| `query_cache` | `query_type:keywords:dateFrom,dateTo` | 按天 |
| `filter_cache` | `cache_key` | 按天 |
| `serp_confidence_cache` | `keyword_normalized:cache_date` | 按天 |

### 老词 & 社区

| 表名 | 用途 |
|---|---|
| `old_keyword_opportunities` | 老词推荐（含趋势序列、评分、社区信号关联） |
| `community_signals` | HN/GitHub 社区信号（24h 缓存） |

### 游戏

| 表名 | 用途 |
|---|---|
| `game_keyword_pipeline` | 游戏关键词（含趋势/SERP/评分/趋势序列/LLM意图） |

---

## 十三、lib/ 模块结构

```
lib/
├── keyword-research.ts          ← re-export 入口（向后兼容）
├── dataforseo-client.ts         ← DataForSEO API 通信层
│   ├─ URL 常量、认证头、重试逻辑
│   ├─ 配置常量（POLL_INTERVAL, MAX_WAIT 等）
│   └─ 信号配置（RECENT_POINTS, MIN_COVERAGE 等）
├── serp.ts                      ← SERP 查询
│   └─ submitSerpTasks / waitForSerpTasks / getSerpResults
├── expand.ts                    ← Expand/Filter（核心管道）
│   └─ submitExpansionTasks / organizeCandidates / filterCandidatesWithModel
├── compare.ts                   ← Compare/Freshness
│   └─ submitComparisonTasks / addFreshnessToComparisonResults
├── ai-intent.ts                 ← LLM 意图识别
├── keyword-utils.ts             ← normalizeKeywords / createBatches
├── auth.ts                      ← 认证核心（getAuthUser, createUser, etc.）
├── auth_middleware.ts           ← 三合一认证（authenticate）
├── admin.ts                     ← requireAdmin()
├── admin_health.ts              ← 管理健康面板
├── api_keys.ts                  ← API Key 管理（validateApiKey, 限流）
├── cache.ts                     ← 4层缓存 + serp_confidence
├── d1.ts                        ← D1 HTTP API 封装（d1Query）
├── research-jobs.ts             ← 异步任务管理
├── rule-engine.ts               ← 规则引擎预过滤
├── session-store.ts             ← 会话持久化
├── types.ts                     ← 类型定义
├── usage.ts                     ← 用量检查（checkStudentAccess）
├── history.ts                   ← 关键词历史
├── context/research-context.tsx ← 前端全局状态管理
│   └─ buildRecommendedSelection (新词推荐选词)
└── sitemap-discovery.ts         ← Sitemap 爬虫（已废弃）
```

---

## 十四、外部依赖

### DataForSEO（付费，核心）

- 端点：Trends Explore + SERP Organic
- Postback：带 `$tag` 变量，正确传递 type 和 cache_key
- Postback IP 白名单：6 个 DataForSEO V3 IP
- 月成本（预计算模式）：~$2.4/月

### OpenRouter（LLM 过滤）

- 模型：`openai/gpt-5.2`
- 用途：关键词过滤、意图分类

### HN Algolia（免费）

- 搜索 HN stories，无需认证
- 限速：建议每请求间隔 ≥0.5s

### GitHub Search API（免费）

- 搜索 repos，需 GitHub Token（避免 rate limit）
- 10 requests/min（认证后）

### 游戏数据源（免费）

| 数据源 | 端点 | 注意 |
|---|---|---|
| CrazyGames | `/new` | 需 curl subprocess，Python urllib 被 CF 拦截 |
| Poki | JSON-LD `/new` | 页面内嵌结构化数据 |
| Addicting Games | `/new-games` | 每周更新 |

---

## 十五、Cron 作业

| Cron ID | 名称 | 频率 | 说明 |
|---|---|---|---|
| `6544d7a8` | 预计算 | 每日 UTC 00:05 | 127 种子词扩展 + LLM 过滤 |
| `69ec6b9f` | Watchdog | 每 10 分钟 | 检查预计算状态，失败补偿 |
| `5f304af8` | 游戏扫描 | 每日 UTC 10:00 | CrazyGames + Poki + Addicting Games |
| `20b8da23` | 老词管线 | 每周一 UTC 06:00 | old_word_pipeline.py |
| `d715aa90` | 社区信号 | 每周二 UTC 07:00 | fetch_community_signals.py |

---

## 十六、关键文件路径

```
<project-dir>/                              ← 项目根目录
├── app/
│   ├── api/
│   │   ├── research/                          ← 研究类 API
│   │   ├── auth/                              ← 认证 API
│   │   ├── admin/                             ← 管理 API
│   │   │   └── game-keywords/route.ts         ← 游戏词管理 (admin only)
│   │   ├── old-keywords/route.ts              ← 老词 API (千人千面)
│   │   ├── game-keywords/route.ts             ← 游戏词 API (千人千面)
│   │   └── me/route.ts                        ← 角色检测 API
│   └── dashboard/
│       ├── candidates/page.tsx               ← 新词候选 (全量)
│       ├── games/page.tsx                    ← 游戏发现 (千人千面)
│       └── old-keywords/page.tsx             ← 老词推荐 (千人千面)
├── lib/
│   ├── context/research-context.tsx           ← 前端状态管理
│   ├── auth.ts / auth_middleware.ts           ← 认证
│   ├── admin.ts                              ← 管理员认证
│   ├── api_keys.ts                           ← API Key 管理
│   ├── cache.ts                              ← 缓存层
│   ├── d1.ts                                 ← D1 封装
│   ├── expand.ts / compare.ts / serp.ts      ← 核心管道
│   └── rule-engine.ts                        ← 规则引擎
├── scripts/
│   ├── precompute_shared_expand.py            ← 每日预计算
│   ├── game_trend_scanner.py                  ← 游戏扫描 (3源)
│   ├── old_word_pipeline.py                   ← 老词管线
│   ├── fetch_community_signals.py             ← 社区信号
│   └── run_precompute_with_retry.sh           ← 预计算启动脚本
├── config/
│   ├── business-rules.ts/json                 ← 业务规则配置
│   └── seed-keywords.txt                      ← 127 个种子关键词
└── wrangler.jsonc                             ← Cloudflare Worker canonical 配置

风探 Skill:
<skill-dir>/keyword-research-agent/
└── scripts/gk_api.py                          ← Skill API 客户端 (含角色检测)
```

---

## 十七、部署流程

### CI 自动部署（推荐）

```bash
git push origin main
→ GitHub Actions 自动触发
→ npx opennextjs-cloudflare build
→ npx wrangler@4.83.0 deploy --config wrangler.jsonc
→ 线上更新
```

### 手动部署（兜底）

```bash
source <env-file>  # 加载 CF_API_TOKEN
cd <project-dir>
npm run deploy
# 或显式执行:
# npx opennextjs-cloudflare build && npx wrangler@4.83.0 deploy --config wrangler.jsonc
```

⚠️ **注意：**
- `rm -rf .open-next` 后必须用 `npm run deploy`，不能只用 `npm run build`
- CI Secrets: `CF_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
- **部署后必须验证：首页 + /api/old-keywords + /api/game-keywords + /api/me**

---

## 十八、安全加固

- ✅ `x-powered-by` 和 `x-opennext` header 已隐藏
- ✅ API Key 已轮换（旧 key 已作废）
- ✅ 仓库公开但无敏感信息
- ✅ 401 全局拦截（未登录自动跳转登录页）
- ✅ Admin 接口严格限制 admin role（学生 403）
- ✅ Postback URL 带 type + cache_key 参数
- ✅ 预计算失败 Telegram 告警
- ✅ API Key 限流（10次失败→15分钟封禁）

---

## 十九、已知技术债

| # | 问题 | 优先级 | 说明 |
|---|---|---|---|
| 1 | `api_keys.user_id` 类型不一致 | 低 | INTEGER vs TEXT，SQLite 弱类型暂无影响 |
| 2 | VPS curl 依赖 | 中 | CrazyGames 需 curl subprocess，Python urllib 被 CF 拦截 |
| 3 | Discovery Scan 已废弃 | 低 | sitemap 爬虫已停更，代码保留 |
| 4 | 管理员健康面板 auth 未收口 | 中 | 管理后台健康面板同步到线上的 auth 还没完成 |

---

> 注：SERP confidence cache 表和函数已就绪，当前预计算模式下无重复命中机会，待评估接入时机。
