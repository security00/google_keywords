import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth_middleware";
import { OLD_WORD_PER_USER } from "@/config/business-rules";
import { d1Query } from "@/lib/d1";

/** Deterministic hash to pick a stable subset of keywords per user. */
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 });
  }

  const userId = auth.userId!;

  // Read keywords that have trend data first, then fill from rest
  const { rows: withTrend } = await d1Query<Record<string, unknown>>(
    `SELECT keyword, volume, cpc, kd, competition, intent, score, trend_series
     FROM old_keyword_opportunities
     WHERE trend_series IS NOT NULL AND cpc > 0
     ORDER BY score DESC
     LIMIT 200`
  );

  const hash = simpleHash(userId);
  const count = Math.min(OLD_WORD_PER_USER, withTrend.length);
  if (count === 0) {
    return NextResponse.json({ keywords: [], message: "暂无老词数据，等待后台管线运行" });
  }

  const picked: typeof withTrend = [];
  for (let i = 0; i < count; i++) {
    const idx = (hash + i * 7) % withTrend.length;
    picked.push(withTrend[idx]);
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
    };

    // Parse trend_series for chart
    const raw = row.trend_series as string | null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.keyword && Array.isArray(parsed.keyword)) {
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
