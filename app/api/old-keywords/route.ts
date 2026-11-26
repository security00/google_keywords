import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireEffectiveUser } from "@/lib/authz";
import { OLD_WORD_PER_USER } from "@/config/business-rules";
import { d1Query } from "@/lib/d1";
import { oldEvaluationJoin, studentOldPredicate } from "@/lib/discovery-evidence";

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

  const { rows } = await d1Query<Record<string, unknown>>(
    `SELECT o.keyword, o.volume, o.cpc, o.kd, o.competition, o.score, o.trend_series,
            o.monthly_searches_json, o.scan_date, e.real_score AS verified_score, e.serp_organic, e.evaluated_at
     FROM old_keyword_opportunities o ${oldEvaluationJoin}
     WHERE ${studentOldPredicate}
     ORDER BY verified_score DESC, o.score DESC, o.keyword
     LIMIT 200`
  );

  const hash = simpleHash(userId);
  const count = Math.min(OLD_WORD_PER_USER, rows.length);
  if (count === 0) {
    return NextResponse.json({ keywords: [], message: "暂无老词数据，等待后台管线运行" });
  }

  const picked: typeof rows = [];
  for (const pool of [rows.filter(row => row.verified_score != null), rows.filter(row => row.verified_score == null)]) {
    const take = Math.min(count - picked.length, pool.length);
    for (let i = 0; i < take; i++) picked.push(pool[(hash + i) % pool.length]);
  }

  // Format for student: hide internal fields
  const result = picked.map((row) => {
    const item: Record<string, unknown> = {
      keyword: row.keyword,
      volume: row.volume,
      cpc: row.cpc,
      kd: row.kd,
      competition: row.competition,
      score: row.score,
      verifiedScore: row.verified_score,
      serpOrganic: row.serp_organic,
      scanDate: row.scan_date,
      evaluatedAt: row.evaluated_at,
    };
    if (typeof row.monthly_searches_json === "string") {
      try {
        const months = JSON.parse(row.monthly_searches_json);
        if (Array.isArray(months)) item.monthlySearches = months.filter(p =>
          typeof p?.month === "string" && Number.isFinite(p.searches) && p.searches >= 0);
      } catch {}
    }

    // Parse trend_series for chart
    const raw = row.trend_series as string | null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.keyword) && parsed.keyword.some((p: { value?: number }) => Number(p?.value) > 0)) {
          item.trend = {
            keyword: (parsed.keyword as Array<{ date: string; value: number }>).map((p) => ({
              date: p.date?.slice(5, 10),
              value: p.value,
            })),
            benchmark: (parsed.benchmark || []).map(
              (p: { date: string; value: number }) => ({
                date: p.date?.slice(5, 10),
                value: p.value,
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
