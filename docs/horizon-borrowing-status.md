# Horizon 开源项目借鉴清单与落地状态

> 来源：Potter 提供参考项目 `https://github.com/Thysrael/Horizon`。本项目只借鉴产品/架构思路，不照搬实现。

## 总结

Horizon 对 Google Keywords 的主要启发不是“复制一个信息雷达系统”，而是把新机会发现拆成更安全的旁路闭环：

1. 多信号源进入统一候选池。
2. 先做低成本筛选/聚合。
3. 只对 Top N 候选做二阶段富集。
4. 管理员先人工反馈。
5. 再把反馈沉淀成来源评分和调权建议。
6. 最后才考虑自动化，且必须避免影响学生端和付费 API 成本。

当前已经按“最小安全切片”在 `google_keywords` 落地多项 admin-only、只读/旁路能力。

## 借鉴点 → 落地状态

| Horizon 启发 | 在 Google Keywords 中的对应设计 | 状态 | 产物 |
|---|---|---|---|
| 信息雷达 / 信号源质量可观测 | Source Quality Stats：按来源聚合推荐率、hot/rising/niche/skip、趋势均值、SERP auth、SNR | 已实现 | `/dashboard/admin/source-quality`、`/api/admin/source-quality`、`lib/source-quality.ts`、`docs/source-quality-todo.md` |
| two-stage enrichment（二阶段富集） | 先用 `game_keyword_pipeline` 低成本筛选，再对 Top N 生成 SEO 机会摘要 | 已实现 v1 | `/dashboard/admin/game-opportunities`、`/api/admin/game-opportunity-enrichment`、`lib/game-opportunity-enrichment.ts`、`docs/game-opportunity-enrichment-todo.md` |
| 人工反馈闭环 | 管理员对新游机会标记“值得做 / 不值得做 / 备注 / 撤销”，写独立反馈侧表，不改推荐结果 | 已实现 | `/api/admin/game-opportunity-feedback`、`lib/game-opportunity-feedback.ts`、`migrations/d1/0008_game_opportunity_feedback.sql` |
| 每日/阶段机会报告 | 聚合 Top N 机会、人工反馈、来源质量，形成只读机会日报 | 已实现 | `/dashboard/admin/game-opportunity-report`、`/api/admin/game-opportunity-report`、`lib/game-opportunity-report.ts` |
| 来源评分 | 将 SNR、推荐量、人工反馈合成 Source Score，用于观察来源质量 | 已实现 | `/dashboard/admin/source-score`、`/api/admin/source-score`、`lib/source-score.ts` |
| 来源调权建议 | 基于反馈数量与 worth/not-worth 比例给出 boost/downrank/watch 建议，但不自动应用 | 已实现，只读 | `/dashboard/admin/source-weight-suggestions`、`/api/admin/source-weight-suggestions`、`lib/source-weight-suggestions.ts` |
| 候选去重 / 近义合并观察 | 语义去重预览与人工反馈，当前默认看 `game_keyword_pipeline`，历史 discovered 仅作样本 | 已实现，只读 | `/dashboard/admin/semantic-dedupe`、`/api/admin/semantic-dedupe-preview`、`/api/admin/semantic-dedupe-feedback`、`docs/semantic-dedupe-pipeline-todo.md` |
| 架构文档化 | 把 opportunity radar 相关页面/API/lib/表写入架构文档 | 已实现 | `ARCHITECTURE.md`、commit `f58e315 docs: update architecture for opportunity radar` |

## 已实现清单

相关 commits（近期）：

- `160ebfb feat: add source quality admin dashboard`
- `57c77af feat: add semantic dedupe preview`
- `1c36833 feat: add semantic dedupe admin page`
- `0ea5358 feat: add semantic dedupe feedback`
- `b5cf0d1 feat: preview pipeline semantic dedupe`
- `d2d8835 feat: add game opportunity enrichment preview`
- `8acd4f3 feat: add game opportunity feedback`
- `1b51a45 fix: add opportunity feedback notes`
- `208573a feat: add game opportunity report`
- `c30508a feat: allow opportunity feedback undo`
- `b8997ef feat: add source score dashboard`
- `b661db8 feat: add source weight suggestions`
- `f58e315 docs: update architecture for opportunity radar`

## 待实现 / 暂不实现

### 可继续做，但需要更多反馈后再推进

1. Source weight suggestions drilldown：展示每个来源的 boost/downrank/watch 是由哪些机会和反馈贡献的。
2. Top N LLM brief：只对 Top N 新游机会调用 LLM 生成更细内容 brief，并做缓存/成本控制。
3. 周报/月报版 opportunity report：从单次日报扩展为周期趋势观察。
4. Source run log：扫描阶段记录 per-source 运行日志，便于后续更精细诊断。
5. Source Hub / 源市场 / 协作贡献体系：只在信号源规模继续扩大后再考虑。

### 暂不做，除非 Potter 明确批准

1. 自动调权：不自动修改扫描来源权重。
2. 自动改变推荐结果：Source Score/feedback 不直接影响学生端推荐。
3. 自动训练/微调模型：反馈量不足前不做。
4. 恢复旧 sitemap discovery 为正式新游来源：该链路已确认噪音过多，只能作为历史样本/规则练习。
5. 任何会让学生端触发 DataForSEO / OpenRouter / SERP 新计费调用的前台链路。

## 当前安全边界

- 所有 Horizon 借鉴落地均为 admin-only。
- 优先只读/旁路，不影响 `/api/game-keywords`、学生端、预计算、缓存、candidate status。
- 不触发新的 DataForSEO / OpenRouter / SERP / Trends 付费调用。
- 人工反馈写独立侧表，不直接改推荐数据。
- 自动化调权和自动推荐变更仍处于禁止状态。

## 相关文档

- `docs/source-quality-todo.md`
- `docs/game-opportunity-enrichment-todo.md`
- `docs/semantic-dedupe-pipeline-todo.md`
- `ARCHITECTURE.md`
- `CHANGELOG.md`
