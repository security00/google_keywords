import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireEffectiveUser } from "@/lib/authz";
import { d1Query } from "@/lib/d1";
import {
  GAME_KEYWORDS_PER_USER,
  GAME_RECOMMENDATION_MAX_AGE_DAYS,
  GAME_STUDENT_MIN_RATIO,
  GAME_WEEKLY_HOT_WINDOW_DAYS,
} from "@/config/business-rules";
import { pickStudentGameKeywords } from "@/lib/game-student-picks";

export async function GET(req: NextRequest) {
  const principal = await requireEffectiveUser(req, {
    allowLegacyQueryKey: true,
  });
  if (isAuthzError(principal)) return principal;

  const userId = principal.userId;

  type PipelineRow = {
    keyword: string;
    source_site: string;
    trend_ratio: number;
    trend_slope: number;
    trend_verdict: string;
    serp_organic: number;
    serp_auth: number;
    serp_featured: number;
    recommendation: string;
    reason: string | null;
    trend_series: string | null;
    trend_checked_at: string | null;
  };

  // Fetch only fully verified, recently checked game keywords. Intermediate
  // rows may carry a non-skip recommendation before SERP finishes; those must
  // not reach students. Stale recommended rows are hidden here and demoted by
  // the scanner so they can re-enter watchlist recheck.
  const { rows } = await d1Query<PipelineRow>(
    `SELECT keyword, source_site, trend_ratio, trend_slope, trend_verdict,
            serp_organic, serp_auth, serp_featured, recommendation, reason,
            trend_series, trend_checked_at
     FROM game_keyword_pipeline
     WHERE status = 'recommended'
       AND recommendation != '⏭️ skip'
       AND recommendation IS NOT NULL
       AND serp_organic > 0
       AND (reason IS NULL OR reason NOT LIKE '%⚠️ SERP首页缺少游戏相关结果%')
       AND trend_checked_at IS NOT NULL
       AND datetime(trend_checked_at) >= datetime('now', ?)
       AND (
         recommendation IN ('🔥 hot', '📈 rising')
         OR (recommendation = '🎯 niche' AND trend_ratio >= ? AND trend_slope > 0)
       )
     ORDER BY trend_ratio DESC
     LIMIT 200`,
    [`-${GAME_RECOMMENDATION_MAX_AGE_DAYS} days`, GAME_STUDENT_MIN_RATIO],
  );

  const picked = pickStudentGameKeywords(rows, userId, {
    count: GAME_KEYWORDS_PER_USER,
    weeklyWindowDays: GAME_WEEKLY_HOT_WINDOW_DAYS,
    maxAgeDays: GAME_RECOMMENDATION_MAX_AGE_DAYS,
    minRatio: GAME_STUDENT_MIN_RATIO,
  });
  if (picked.length === 0) {
    return NextResponse.json({
      keywords: [],
      message: "新游结果还在更新。每日扫描完成后，这里会重新出现本周推荐。",
    });
  }

  const result = picked.map((row) => {
    const raw = row.trend_series as string | null;
    const item: Record<string, unknown> = {
      keyword: row.keyword,
      source: row.source_site,
      slot: row.slot,
      ratio: Number(row.trend_ratio),
      slope: Number(row.trend_slope),
      verdict: row.trend_verdict,
      recommendation: row.recommendation,
      reason: row.reason,
      trend_ratio: Number(row.trend_ratio),
      trend_slope: Number(row.trend_slope),
      trend_verdict: row.trend_verdict,
      trend_series: raw,
      trend_checked_at: row.trend_checked_at,
    };

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.timestamps && Array.isArray(parsed.timestamps)) {
          item.trend = {
            keyword: parsed.timestamps.map((ts: string, i: number) => ({
              date: ts?.slice(5, 10),
              value: (parsed.values as number[])[i],
            })),
            benchmark: (parsed.benchmarkValues || []).map(
              (v: number, i: number) => ({
                date: parsed.timestamps[i]?.slice(5, 10),
                value: v,
              })
            ),
          };
        }
      } catch {}
    }
    return item;
  });

  return NextResponse.json({ keywords: result });
}
