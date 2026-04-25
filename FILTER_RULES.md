# google_keywords 过滤规则备忘

更新时间：2026-04-25

---

## 总体流程

当前关键词过滤分为三层：

1. **前置规则过滤（rule-engine）**
   - 文件：`lib/rule-engine.ts`
   - 目标：低成本挡掉 obvious 垃圾词，减少 LLM 和 compare 成本

2. **后置 LLM 语义过滤（expand / precompute）**
   - 文件：`lib/expand/ai-filter.ts`
   - 目标：挡掉“字面像工具词、语义其实不是工具需求”的词

3. **游戏词专用过滤**
   - 文件：`scripts/game_trend_scanner.py`
   - 目标：挡掉通用英文词、伪游戏名、歧义热点

---

## 一、前置规则过滤（`lib/rule-engine.ts`）

### A. 直接 block 的词

#### 1) 基础脏数据
- 空词
- 长度 `< 3`
- 长度 `> 60`
- 词数 `>= 7`
- 纯数字
- 问句（`?` / `？`）

#### 2) 字典 / 语言类
触发词：
- `meaning`
- `definition`
- `riddle`
- `crossword`
- `puzzle`
- `word game`
- `etymology`
- `spelling`
- `pronunciation`

动作：`block`

#### 3) 地理 / 地点类
触发词：
- `city`
- `country`
- `airport`
- `station`
- `port`
- `park`
- `temple`
- `church`
- `mountain`
- `river`
- `lake`
- `island`
- `capital`

动作：`block`

#### 4) 登录 / 门户类
触发词：
- `login`
- `sign in`
- `sign up`
- `register`
- `auth`
- `portal`

动作：`block`

#### 5) 赌博 / 成人 / 域名垃圾
触发词：
- `casino`
- `gambling`
- `betting`
- `sportsbook`
- `lottery`
- `slot`
- `odds`
- 域名类：`xxx.com` / `xxx.net` / `xxx.io`
- 成人词：`porn` / `xxx` / `adult` / `escort` / `onlyfans` / `nsfw`

动作：`block`

#### 6) 政治 / 娱乐 / 犯罪新闻
政治触发词：
- `trump`
- `biden`
- `election`
- `president`
- `senator`
- `politics`

娱乐触发词：
- `celebrity`
- `actor`
- `singer`
- `movie`
- `film`
- `tv show`
- `episode`
- `season`
- `cast`
- `trailer`
- `netflix`

新闻/犯罪触发词：
- `arrest`
- `lawsuit`
- `scandal`
- `killed`
- `shot`
- `crime`
- `dui`

动作：`block`

#### 7) 考试 / 答案 / 短命题材
触发词：
- `exam`
- `result`
- `answer key`
- `answer`
- `wordle`
- `crossword`
- `hint`
- `jee`
- `cbse`
- `cutoff`

动作：`block`

#### 8) 金融 / 投资 / 大宗商品
触发词：
- `stock`
- `stocks`
- `equity`
- `futures`
- `trading`
- `forex`
- `crypto`
- `bitcoin`
- `gold price`
- `share price`
- `dividend`
- `ipo`

动作：`block`

#### 9) 体育 / 游戏赛事 / 事件追踪
触发词：
- `football`
- `soccer`
- `nba`
- `nhl`
- `masters`
- `league`
- `draft`
- `score chart`
- `pokemon`
- `cyclone`
- `typhoon`
- `ship tracker`
- `marine traffic`
- `hurricane`
- `weather tracker`

动作：`block`

#### 10) 新增：体育帅位新闻拦截

**球队实体词直接拦截：**
- `chelsea`
- `arsenal`
- `liverpool`
- `manchester united`
- `man utd`
- `manchester city`
- `newcastle`
- `barcelona`
- `real madrid`
- `tottenham`
- `spurs`

动作：`block`

**manager 新闻组合拦截：**
- 包含：`manager / coach / head coach`
- 且同时包含：
  - `sacked`
  - `rumor / rumors`
  - `next`
  - `new`
  - `replacement`
  - `hired`
  - `appointment`
  - `appointed`

示例：
- `chelsea manager`
- `chelsea manager sacked`
- `newcastle manager rumors`

动作：`block`

#### 11) 优惠 / code 噪音
触发词：
- `coupon`
- `promo code`
- `redeem code`
- `presale code`
- `hsn code`
- `area code`

动作：`block`

#### 12) 泛问句
触发前缀：
- `how to`
- `where to`
- `what is`
- `who is`
- `why does`
- `when does`

动作：`block`

---

### B. 降权（demote）的词

这些词不会直接拦掉，但优先级会被压低。

#### 娱乐类
- `trailer`
- `cast`
- `episode`
- `season`
- `movie`
- `film`
- `anime`
- `manga`
- `celebrity`

动作：`demote`

#### 新闻类
- `news`
- `outage`
- `incident`
- `crime`
- `lawsuit`

动作：`demote`

#### 金融类
- `stock`
- `invest`
- `trading`
- `crypto`
- `bitcoin`

动作：`demote`

#### 医疗类
- `symptom`
- `disease`
- `treatment`
- `medicine`
- `doctor`

动作：`demote`

---

### C. 加分（keep）的词

这些词会被认为更像持续需求、可产品化的 web 工具 / AI 工具 / SaaS 词。

#### 工具后缀
- `tool`
- `builder`
- `generator`
- `creator`
- `maker`
- `checker`
- `converter`
- `analyzer`
- `calculator`
- `finder`
- `scanner`
- `detector`
- `solver`
- `optimizer`
- `editor`
- `manager`
- `planner`
- `tracker`
- `monitor`
- `extractor`
- `enhancer`
- `remover`

#### AI 词
- `ai`
- `gpt`
- `llm`
- `copilot`
- `agent`
- `chatbot`
- `automation`
- `machine learning`
- `claude`
- `gemini`
- `openai`

#### SaaS / 软件词
- `app`
- `software`
- `platform`
- `service`
- `extension`
- `plugin`
- `api`
- `sdk`
- `integration`
- `workflow`
- `template`
- `dashboard`

#### 额外加分项
- `free`
- `online`
- `top N`
- 2 到 4 个词的组合词
- `AI + tool` 组合额外高分

---

## 二、后置 LLM 语义过滤（`lib/expand/ai-filter.ts`）

LLM 过滤的职责不是替代前置规则，而是继续判断：

> 这个词是不是“可持续、可产品化、可商业化”的需求，
> 还是“看起来像工具词，其实只是事件/八卦/品牌/短期热词”。

### LLM 倾向保留的词
- 工具 / utility intent
  - builder, generator, converter, checker, analyzer, calculator, finder
- AI / automation intent
  - ai, gpt, copilot, agent, chatbot, automation
- 软件 / SaaS intent
  - app, platform, extension, plugin, template, workflow, dashboard
- 有商业价值的信息型需求
  - 不是纯八卦，不是纯事件，不是纯 curiosity

### LLM 倾向 block 的词
- 一次性事件
  - 游戏上线、电影上映、专辑发布、patch notes、release date
- 品牌 / SKU / 单一产品实体
- 娱乐内容
  - anime, manga, novel, TV show, celebrity
- 新闻 / 事件
  - crime, politics, weather, sports scores, awards
- 泛问句 / 泛解释
  - how to, what is, definition, translation, spelling
- 登录 / 地点类
  - login, sign up, portal, city, country, airport, festival

### LLM 的关键判断原则
- `ai character creator` → 保留
- `free ai headshot generator` → 保留
- `ai video enhancer` → 保留
- `pokemon legends z-a release date` → 拦截
- `spider man 4 trailer` → 拦截
- `palworld update 1.2` → 拦截

### precompute 链路里的 LLM 过滤要求
额外强调：
- 保留 durable / productizable / commercial 词
- 拦 short-lived noise / sports / games / celebrity / politics / coupons / gambling
- 品牌词 / 一次性实体词尽量拦掉，除非明确是可复用工具需求

---

## 三、游戏词专用过滤（`scripts/game_trend_scanner.py`）

这套是专门给新游发现链路用的，不完全依赖 `rule-engine`。

### 会拦掉的内容
- 太短 / 太长
- 纯数字
- 明显 SEO 垃圾
- 泛词
- 单个常见英文词
- 高歧义标题

### 当前显式黑名单（高歧义词）
- `ant`
- `memories`
- `number`
- `delivery`
- `where`
- `pin`
- `rush hour`
- `time traveler`
- `the lighthouse`
- `cold city`
- `passenger 6`

### 当前额外规则
- 单个英文常见词默认拦截
- 无明显游戏名特征的短词默认拦截
- 保留极少数明确例外，如：`votv`、`obby`

### 目的
避免以下问题：
- itch.io / 浏览器游戏源带来大量普通英文词
- Trends 热度是词义本身，不是游戏本身
- 误把普通单词热点当成“新游戏机会”

---

## 四、当前这套规则最擅长过滤什么

### 会明显被挡掉的词
- 体育新闻
- 帅位更迭
- 娱乐新闻
- 名人八卦
- 金融投机词
- 赌博成人词
- 登录门户词
- 考试答案词
- 事件追踪词
- 普通英文词伪装成游戏名

### 仍然可能漏掉的词
- 看起来像工具后缀、实际是事件新闻的词
- 品牌词 + 工具后缀
- 特别新的实体热词，前置规则没覆盖到，但语义上其实是短期新闻

---

## 五、当前结论

### 过滤策略核心原则
1. **前置规则** 负责低成本挡 obvious 垃圾
2. **LLM 语义识别** 负责挡“字面像工具、语义不是工具”的词
3. **游戏词专用过滤** 负责挡通用英文词和伪游戏名

### 当前目标
- 让关键词更偏：AI 工具 / web 工具 / 软件 / SaaS / 持续需求
- 让游戏词更偏：真正的新游名，而不是普通英文词或事件热词
- 尽量减少：新闻、八卦、体育、娱乐、金融、短期 hype

---

## 六、后续可继续补的方向

1. 增加更多**体育/名人/影视实体词**拦截
2. 增加更多**品牌事故 / recall / scandal** 类组合词拦截
3. 给游戏词黑名单增加更多**高歧义普通词**
4. 定期回看最近进入共享 compare 的噪音词，持续补规则

---

## 七、相关文件清单

- 前置规则：`lib/rule-engine.ts`
- LLM 语义过滤：`lib/expand/ai-filter.ts`
- 游戏词扫描与过滤：`scripts/game_trend_scanner.py`
- 共享预计算：`scripts/precompute_shared_expand.py`

---

如后续规则有新增，优先更新本文件做备忘。
