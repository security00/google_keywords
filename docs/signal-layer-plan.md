# 信号层实施方案

> 目标：为 google_keywords 项目增加多源信号采集层，从社区/媒体源反向发现新关键词需求。
> 参考项目：Thysrael/Horizon（AI 新闻雷达，src/scrapers/ + orchestrator 模式）
> 状态：规划稿，待总管确认后执行

---

## 一、现状与问题

### 当前管线流向

```
[127个种子词] → DataForSEO Expand → LLM过滤 → 趋势对比 → 意图分类 → 学员端展示
                    ↑ 单向，只能从已有种子出发，不能反向发现
```

### 已有但孤立的脚本

- `scripts/fetch_community_signals.py` — 为已有 keyword 查 HN/GitHub 信号（补充信息，非发现）
- 方向：**已知关键词 → 查社区热度**

### 核心不足

| 问题 | 表现 |
|---|---|
| 源单一 | 只依赖 DataForSEO 和预定义种子词 |
| 发现被动 | 无法感知"正在出现"的需求，只能看"已经存在"的数据 |
| 时间滞后 | DataForSEO 数据更新周期决定，等拿到数据机会窗口过半 |
| 无法覆盖长尾 | 种子词外的领域完全不可见 |

---

## 二、改造目标

### 新增的方向（逆向）

```
[HD/Reddit/RSS/GitHub Trending/...] → 信号采集 → 关键词候选提取
                                                        ↓
[已有种子词] → DataForSEO Expand → LLM过滤 → 趋势对比 → 意图分类 → 学员端
                                                        ↑
                                              (候选词汇入，与种子词展开同等待遇)
```

### 核心价值

1. **发现新需求** — 当 Reddit/HN 上开始频繁讨论某个新工具/新概念时，我们第一时间捕捉到
2. **挖掘长尾** — 从讨论中提取未被覆盖的长尾关键词
3. **交叉验证** — 多源热度加权，比单一 DataForSEO 数据更可靠
4. **时机优势** — 社区讨论 → 搜索量爬升之间存在时间差，这是窗口期

---

## 三、架构设计

### 3.1 模块结构

```
google_keywords/
├── signal_collector/             ← 新增，信号采集层（Python 包）
│   ├── __init__.py
│   ├── models.py                 ← 统一数据模型（参考 Horizon ContentItem）
│   ├── base.py                   ← BaseScraper 基类
│   ├── collectors/
│   │   ├── __init__.py
│   │   ├── hackernews.py         ← HN 采集器（已有 fetch_community_signals 逻辑升级）
│   │   ├── reddit.py             ← Reddit 采集器（新增）
│   │   ├── rss.py                ← RSS 采集器（新增）
│   │   └── github_trending.py    ← GitHub Trending 采集器（新增）
│   ├── extractor.py              ← 信号→关键词提取（从文本内容提取候选词）
│   ├── router.py                 ← 候选词过滤+分流（送现有管线 or 直接入库）
│   └── pipeline.py               ← 编排：采集→提取→过滤→分流
├── scripts/
│   ├── signal_discovery.py       ← 新增，信号发现主脚本（cron 驱动）
│   ├── fetch_community_signals.py ← 已有，保留不动（为已有词查信号，供前端展示）
│   └── ...
```

### 3.2 数据模型

```python
# signal_collector/models.py

class SignalProvider(str, Enum):
    HACKERNEWS = "hackernews"
    REDDIT = "reddit"
    RSS = "rss"
    GITHUB_TRENDING = "github_trending"

class SignalItem:
    """统一信号条目模型"""
    id: str                # {provider}:{native_id}
    provider: SignalProvider
    title: str
    url: str
    content: str           # 正文/摘要
    author: str
    published_at: datetime
    score: int             # 源自带热度（HN points / Reddit upvotes / GitHub stars）
    metadata: dict         # 源相关信息

class KeywordCandidate:
    """从信号中提取的关键词候选"""
    keyword: str
    sources: list[SignalItem]     # 支撑信号（多个源讨论同话题时合并）
    source_count: int             # 有多少独立源提到
    avg_signal_score: float       # 平均信号热度
    first_seen_at: datetime
    extract_method: str           # "title_ngram" | "content_tfidf" | "llm_extract"
```

### 3.3 数据流

```
                          ┌──────────────────┐
                          │  多源采集并发完成  │
                          │  asyncio.gather   │
                          └────────┬─────────┘
                                   ▼
                          ┌──────────────────┐
                          │  去重+归并         │
                          │  同话题多源合并    │
                          └────────┬─────────┘
                                   ▼
                          ┌──────────────────┐
                    ┌─────┤  关键词提取       ├─────┐
                    │     │  标题n-gram /     │     │
                    │     │  LLM提取          │     │
                    │     └────────┬─────────┘     │
                    ▼              ▼                ▼
              ┌──────────┐ ┌──────────────┐ ┌──────────┐
              │ 与已有池   │ │ 过滤           │ │ 送入      │
              │ 去重      │ │ 非名词/无意义   │ │ DataForSEO│
              └──────────┘ └──────────────┘ └────┬─────┘
                                                  ▼
                                         ┌──────────────────┐
                                         │ 已有预计算管线     │
                                         │ expand+filter+   │
                                         │ compare+intent   │
                                         └────────┬─────────┘
                                                  ▼
                                         ┌──────────────────┐
                                         │ 机会评分 + 排序    │
                                         │ (源热度×增长×竞争) │
                                         └────────┬─────────┘
                                                  ▼
                                         ┌──────────────────┐
                                         │ 输出：             │
                                         │ - D1 入库（学员端）│
                                         │ - 飞书 Top 10     │
                                         └──────────────────┘
```

---

## 四、分阶段执行

### 第一阶段（P0，2天）：Reddit + HN 信号发现

**做什么：**
1. 搭 `signal_collector/` 包结构，参考 Horizon 的 BaseScraper
2. Reddit 采集器：可配置多个 subreddit（r/SEO, r/juststart, r/blogging, r/smallbusiness + 各工具站垂直版块）
3. HN 采集器：升级现有 `fetch_community_signals.py` 的 HN 逻辑，改为主动发现模式
4. 关键词提取器：从标题/正文中提取高频名词短语 + LLM 辅助提取
5. 候选词去重（与已有 expand 候选池比对）
6. 送入已有管线做 DataForSEO volume 校验

**配置示例（到这一步时决定源列表）：**

```json
{
  "reddit": {
    "enabled": true,
    "subreddits": ["SEO", "juststart", "blogging", "smallbusiness",
                   "Entrepreneur", "webdev", "sideproject"],
    "sort": "hot",
    "fetch_limit": 25
  },
  "hackernews": {
    "enabled": true,
    "fetch_top_stories": 50,
    "min_score": 50
  }
}
```

**验证标准：**
- [x] 第一天跑出 20+ 候选词
- [x] 至少 5 个词进入已有管线并产出完整数据（volume/KD/趋势）
- [x] 飞书能收到 Top 10 推送

### 第二阶段（P1，1-2天）：RSS + GitHub Trending

**做什么：**
1. RSS 采集器：配置行业博客（Ahrefs blog、Moz、SearchEngine Land、行业/垂直自媒体）
2. GitHub Trending 采集器：OSSInsight API → 新仓库 → 提取关键词（项目名/描述/标签）
3. 多源加权评分算法（单个源热度 vs 多源交叉验证）
4. 关键词候选：信号出现频率×信号源权重

**验证标准：**
- [x] 信号采集跑通 4 个源
- [x] 多源交叉验证打分可运行
- [x] 每天产生 50+ 候选词

### 第三阶段（P2，0.5天）：RSS 订阅管理 + 飞书推送

**做什么：**
1. 候选词验收：总管/掌柜可在飞书对推送的候选词确认/否决
2. 反馈闭环：被否决的词降级，被确认的词进入核心管线
3. RSS 源管理：可动态增删订阅源

---

## 五、与 Horizon 的具体复用

| Horizon 模块 | 复用方式 | 改动量 |
|---|---|---|
| `scrapers/base.py` → BaseScraper + ContentItem | 直接复制，修改 import 和模型名 | 小 |
| `scrapers/hackernews.py` | 直接复制，改为主动发现（不要输入关键词） | 中 |
| `scrapers/reddit.py` | 直接复制，改 subreddit 配置 | 小 |
| `scrapers/rss.py` | 直接复制 | 小 |
| `models.py` → SourceType, ContentItem | 简化版，去掉不需要的源 | 小 |
| 并发采集模式 `asyncio.gather` | 直接复用 | 小 |
| `orchestrator.py` 的采集编排 | 参考，简化 | 中 |

### 不用的 Horizon 模块
- MCP server（当前不接入，等后续）
- 多语言摘要（我们不需要双语文稿）
- Email delivery（我们有飞书）
- Webhook 平台适配层（我们用飞书通知，后续再考虑复用）

---

## 六、集成到现有管线

### 入口：新增 cron 脚本

```
scripts/signal_discovery.py     ← 每天 02:00 UTC (10:00 北京) 跑
```

**执行流程：**
1. 采集各源
2. 提取关键词候选
3. 去重（与已有 D1 candidates 表比对）
4. 对新候选词调 DataForSEO volume
5. 按机会分排序
6. 写入 D1（新表 signal_candidates）
7. 飞书推送 Top 10

### D1 新表

```sql
CREATE TABLE signal_candidates (
    id TEXT PRIMARY KEY,
    keyword TEXT NOT NULL UNIQUE,
    keyword_normalized TEXT NOT NULL,
    signal_sources TEXT NOT NULL,        -- JSON: 哪些源发现了它
    signal_score REAL NOT NULL DEFAULT 0, -- 多源加权分
    avg_hotness REAL NOT NULL DEFAULT 0, -- 源自带的平均热度
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    dataforseo_volume INTEGER DEFAULT 0,  -- 走完管线后的 DataForSEO 数据
    dataforseo_kd REAL DEFAULT 0,
    dataforseo_cpc REAL DEFAULT 0,
    processed INTEGER DEFAULT 0,          -- 是否已送预计算管线
    accepted TEXT DEFAULT NULL,           -- accepted / rejected / pending
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 飞书推送模板

每日 10:00 北京推送 Top 10：

```
🔔 新信号关键词 Top 10 | {date}

1. keyword1 (机会分: 85) — 出现在 Reddit(3) HN(1)
   趋势: ↑78% / KD: 12 / 搜索量: 2.4k
   → 子版块: r/SEO、r/juststart

2. keyword2 (机会分: 72) — 出现在 GitHub(2)
   趋势: ↑45% / KD: 8 / 搜索量: 800
   → 仓库: security00/new-tool

...
```

---

## 七、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| Reddit API 限频/封号 | 中 | 中 | 使用 RSS 模式作为 fallback（可不用 Reddit API） |
| 提取出大量无用词 | 高 | 中 | LLM 过滤 + 频次阈值（出现不少于 2 源） |
| 数据混入现有池 | 低 | 高 | 独立表 signal_candidates，显式标记来源 |
| 新增 cron 影响预计算 | 低 | 低 | signal_discovery 与现有管线独立运行 |
| 信号发现与已有种子词重复 | 中 | 低 | 与已有 expand 候选池去重后再送管线 |

---

## 八、验收标准

### 第一轮验收（Stage 1 完成时）
1. `signal_collector/` 模块可独立运行，完成 Reddit + HN 采集
2. 关键词提取产出一批候选词（>20）
3. 候选词去重与原候选池分流正常
4. 飞书推送正常

### 第二轮验收（Stage 2 完成时）
1. 4 源同时采集正常
2. 多源加权评分可用
3. 每日稳定产出 50+ 候选词
4. 至少 5 个词来自信号层而非种子词
