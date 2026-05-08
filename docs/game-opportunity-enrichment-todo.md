# 新游 Top N 二阶段富集 TODO

## 目标

借鉴 Horizon 的 two-stage enrichment：先用现有 `game_keyword_pipeline` 做低成本筛选，再只对 Top N 新游候选生成可行动的 SEO 机会摘要。

## 当前最小切片

只做 **admin 只读预览**：

- 新增 API：`/api/admin/game-opportunity-enrichment`
- 新增页面：`/dashboard/admin/game-opportunities`
- 数据源：`game_keyword_pipeline`
- 不写数据库
- 不调用 DataForSEO / OpenRouter / SERP / Trends
- 不改变推荐结果、学生端接口、缓存、candidate status

## v1 富集字段

用已有 pipeline 字段生成确定性预览：

- `whyWorthDoing`：为什么值得做
- `intent`：搜索意图粗分
- `contentAngle`：内容切入角度
- `risk`：竞争/噪音风险
- `format`：建议内容形态（新闻/攻略/列表/工具页等）
- `priorityScore`：展示排序分，不回写

## 验收标准

1. API admin-only，未登录返回 401。
2. API 只读查询 `game_keyword_pipeline`，只返回非 skip 推荐候选。
3. Top N 可通过 `limit` 控制，范围 1-50，默认 10。
4. 页面能展示摘要卡片和候选富集列表。
5. `scripts/check_student_paid_guards.py` 通过。
6. `npm run build` 通过。

## 后续版本

- v2：给人工反馈加“值得做 / 不值得做 / 原因”。
- v3：只对 Top N 调 LLM 生成更细 brief，并做缓存/成本控制。
- v4：沉淀每日/每周新游机会报告。
