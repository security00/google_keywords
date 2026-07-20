import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireEffectiveUser } from "@/lib/authz";
import { d1Query } from "@/lib/d1";
import { GAME_KEYWORDS_PER_USER } from "@/config/business-rules";

/** Deterministic hash to pick a stable subset of keywords per user. */
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export async function GET(req: NextRequest) {
  const principal = await requireEffectiveUser(req, {
    allowLegacyQueryKey: true,
  });
  if (isAuthzError(principal)) return principal;

  const userId = principal.userId;

  // Fetch only fully verified game keywords. Intermediate rows may carry a
  // non-skip recommendation before SERP finishes; those must not reach students.
  const { rows } = await d1Query<Record<string, unknown>>(
    `SELECT keyword, source_site, trend_ratio, trend_slope, trend_verdict,
            serp_organic, serp_auth, serp_featured, recommendation, reason,
            trend_series
     FROM game_keyword_pipeline
     WHERE status = 'recommended'
       AND recommendation != '⏭️ skip'
       AND recommendation IS NOT NULL
       AND serp_organic > 0
       AND (reason IS NULL OR reason NOT LIKE '%⚠️ SERP首页缺少游戏相关结果%')
     ORDER BY trend_ratio DESC
     LIMIT 200`
  );

  const hash = simpleHash(userId);
  const count = Math.min(GAME_KEYWORDS_PER_USER, rows.length);
  if (count === 0) {
    return NextResponse.json({
      keywords: [],
      message: "暂无推荐游戏关键词，系统每日自动扫描中",
    });
  }

  // Pick keywords using hash offset (千人千面)
  const picked: typeof rows = [];
  for (let i = 0; i < count; i++) {
    const idx = (hash + i * 7) % rows.length;
    picked.push(rows[idx]);
  }

  // Format for student
  const result = picked.map((row) => {
    const raw = row.trend_series as string | null;
    const item: Record<string, unknown> = {
      keyword: row.keyword,
      source: row.source_site,
      ratio: Number(row.trend_ratio),
      slope: Number(row.trend_slope),
      verdict: row.trend_verdict,
      recommendation: row.recommendation,
      reason: row.reason,
      // Backward-compatible fields used by the student games page.
      trend_ratio: Number(row.trend_ratio),
      trend_slope: Number(row.trend_slope),
      trend_verdict: row.trend_verdict,
      trend_series: raw,
    };

    // Parse trend_series for chart
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
