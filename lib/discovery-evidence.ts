import { GAME_RECOMMENDATION_MAX_AGE_DAYS, GAME_STUDENT_MIN_RATIO } from "@/config/business-rules";

export const studentGamePredicate = `status = 'recommended'
  AND serp_organic > 0
  AND (reason IS NULL OR reason NOT LIKE '%⚠️ SERP首页缺少游戏相关结果%')
  AND datetime(trend_checked_at) BETWEEN datetime('now', ?) AND datetime('now')
  AND (recommendation IN ('🔥 hot', '📈 rising')
    OR (recommendation = '🎯 niche' AND trend_ratio >= ? AND trend_slope > 0))`;

export const studentGameParams = () => [`-${GAME_RECOMMENDATION_MAX_AGE_DAYS} days`, GAME_STUDENT_MIN_RATIO];

// Match only evidence from the same scan. Older v1 evaluations may have
// written a numeric score even when the provider returned no organic results.
export const oldEvaluationJoin = `LEFT JOIN old_keyword_evaluations e
  ON e.keyword_normalized = lower(trim(o.keyword)) AND e.scan_date = o.scan_date
  AND e.evaluation_version = 'serp-v1' AND e.serp_organic > 0`;

export const studentOldPredicate = `o.scan_date = (
    SELECT MAX(scan_date) FROM old_keyword_opportunities WHERE scan_date BETWEEN date('now', '-30 days') AND date('now')
  )
  AND o.cpc > 0 AND NOT (o.kd <= 0 AND (o.volume >= 10000 OR o.competition != 'LOW'))`;
