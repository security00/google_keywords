# Source Quality Stats TODO

## 背景

借鉴 Horizon 的信息雷达机制，但本次只落地 Google Keywords 项目里的最小安全切片：**信号源质量统计**。

目标是让管理员看到每个游戏/站点信号源的产出质量，而不是改动现有学员查询、预计算、DataForSEO 调用或游戏扫描主流程。

## 核心原则

1. **旁路只读优先**：第一版不新增写入链路，不改 scanner 行为，只从既有表聚合。
2. **不影响主流程**：不改变 `/api/game-keywords`、`/api/research/*`、预计算 cron、`game_trend_scanner.py` 的行为。
3. **不引入新计费调用**：统计页只查 D1，不触发 DataForSEO / OpenRouter / SERP。
4. **架构完整但不过度设计**：先抽一个深模块负责聚合与指标计算，API/UI 只调用它。
5. **可演进**：后续若要做 source hub / 权重 / 降权，可在此基础上扩展。

## 指标定义（第一版）

数据源：
- `game_keyword_pipeline.source_site`：已跑过趋势/SERP 的游戏候选来源。
- `sitemap_sources` + `discovered_keywords`：sitemap 发现源的候选产出。

### Game pipeline source metrics

按 `game_keyword_pipeline.source_site` 聚合：
- `total_checked`：该来源已进入 game pipeline 的关键词数。
- `recommended_count`：`recommendation IS NOT NULL AND recommendation != '⏭️ skip'`。
- `hot_count`：`recommendation = '🔥 hot'`。
- `rising_count`：`recommendation = '📈 rising'`。
- `niche_count`：`recommendation = '🎯 niche'`。
- `skip_count`：`recommendation = '⏭️ skip'`。
- `avg_trend_ratio`：平均 `trend_ratio`。
- `avg_trend_slope`：平均 `trend_slope`。
- `avg_serp_auth`：平均 `serp_auth`。
- `snr`：`recommended_count / total_checked`。
- `last_checked_at`：最大 `trend_checked_at`。

### Sitemap discovery source metrics

按 `sitemap_sources.id` 聚合：
- `source_id`
- `name`
- `sitemap_url`
- `enabled`
- `discovered_count`：`discovered_keywords` 数量。
- `new_count`：`status = 'new'`。
- `last_checked_at`
- `last_extracted_at`

第一版页面主表展示 game pipeline metrics；sitemap metrics 作为下方辅助表。

## 实现 TODO

### 0. 现状确认

- [x] 确认项目路径：`/root/clawd/projects/google_keywords`
- [x] 确认现有脏文件：`.wrangler` 本地状态、`scripts/game_trend_scanner.py`、`CLAUDE.md`、`docs/agents/`、`tmp/`，本任务避免误碰。
- [x] 确认 admin 路由风格：`requireAdminRequest` + `d1Query`。
- [x] 确认导航位置：`app/dashboard/layout.tsx` 管理后台菜单。

### 1. 聚合模块

- [x] 新增 `lib/source-quality.ts`。
- [x] 导出类型：`GameSourceQualityRow`、`SitemapSourceQualityRow`、`SourceQualitySummary`。
- [x] 导出纯函数 `calculateSnr(recommended, total)`，便于测试。
- [x] 导出 `getSourceQualityStats()`，内部只读 D1 聚合。
- [x] SQL 使用 `COALESCE` 和 `NULLIF` 防止空值/除零。
- [x] 返回 summary：总来源数、总扫描数、总推荐数、整体 SNR、最佳来源。

### 2. 行为测试

- [x] 新增 `lib/source-quality.test.ts`。
- [x] 测 `calculateSnr(0, 0) === 0`。
- [x] 测 `calculateSnr(3, 10) === 0.3`。
- [x] 测 summary 纯函数（如抽出 `buildSourceQualitySummary`）：空列表、安全默认值、最佳来源排序。

### 3. Admin API

- [x] 新增 `app/api/admin/source-quality/route.ts`。
- [x] GET admin only。
- [x] 返回 `{ summary, gameSources, sitemapSources }`。
- [x] 不接受会触发外部调用的参数。

### 4. Admin UI

- [x] 新增 `app/dashboard/admin/source-quality/page.tsx`。
- [x] 展示顶部统计卡：来源数、扫描数、推荐数、整体 SNR。
- [x] 展示 Game source 主表：来源、扫描、推荐、SNR、Hot/Rising/Niche/Skip、趋势均值、最近扫描。
- [x] 展示 Sitemap source 辅助表：名称、enabled、发现数、新候选、最近检查。
- [x] loading/error/empty 状态完整。
- [x] 不加自动刷新，不制造额外压力。

### 5. 导航

- [x] `app/dashboard/layout.tsx` 管理后台增加「信号源质量」入口。
- [x] 图标使用现有 lucide 图标，避免新增依赖。

### 6. 文档

- [x] 更新 `ARCHITECTURE.md`：管理 API、管理页面、表/指标说明。
- [x] 保留本 TODO 作为实施记录。

### 7. 验证

- [x] `npm test -- lib/source-quality.test.ts` 或等价 vitest 定向测试。
- [x] `npx eslint lib/source-quality.ts lib/source-quality.test.ts app/api/admin/source-quality/route.ts app/dashboard/admin/source-quality/page.tsx app/dashboard/layout.tsx`
- [x] `npm run build`
- [ ] 若要上线：只提交相关文件，不带 `.wrangler`、`scripts/game_trend_scanner.py` 等无关脏文件。

## 后续可选，不在第一版做

- 对 source 进行自动权重调整。
- 在扫描阶段写入 per-source 运行日志。
- 语义去重候选词。
- Top N 候选二阶段 explanation。
- Source Hub / 源市场 / 协作贡献体系。
