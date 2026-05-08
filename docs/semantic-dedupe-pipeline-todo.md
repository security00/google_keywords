# Semantic Dedupe Pipeline Preview TODO

目标：把语义去重预览从旧 `discovered_keywords` 历史样本扩展到当前推荐管道 `game_keyword_pipeline`，只读观察，不影响学生端、推荐结果、候选状态或付费 API。

## 背景约束

- `discovered_keywords` / `sitemap_sources` 旧采集链路已因噪音过多被弃用，不能恢复为正式新游来源。
- 旧池只作为历史样本/规则练习，页面必须标注清楚。
- 新增 `pipeline` 数据源读取 `game_keyword_pipeline`，用于校准真实推荐管道中的重复/近似重复。
- 本阶段不提供 apply mode，不改 `game_keyword_pipeline` 数据。

## 验收

1. API 支持 `source=discovered|pipeline`，默认 discovered 兼容现有行为。
2. `source=pipeline` 只执行 SELECT，读取非 skip 且有推荐/状态的 pipeline 候选。
3. 页面新增数据源下拉，并标注 discovered 是历史停用样本。
4. compare 主选择逻辑、学生 `/api/game-keywords`、付费 API guard 不变。
5. targeted tests + build + `scripts/check_student_paid_guards.py` 通过。
