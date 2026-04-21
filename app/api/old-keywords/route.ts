import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth_middleware";
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

  // Read all scored keywords from D1
  const { rows } = await d1Query<Record<string, unknown>>(
    `SELECT keyword, volume, cpc, kd, competition, intent, score, trend_series
     FROM old_keyword_opportunities
     ORDER BY score DESC
     LIMIT 200`
  );

  if (rows.length === 0) {
    return NextResponse.json({ keywords: [], message: "暂无老词数据，等待后台管线运行" });
  }

  // Deterministic pick: use userId hash to select a rotating subset of 3
  const hash = simpleHash(userId);
  const count = Math.min(3, rows.length);
  const picked: typeof rows = [];

  // Use hash to skip through rows and pick non-adjacent ones
  for (let i = 0; i < count; i++) {
    const idx = (hash + i * 7) % rows.length; // spread picks
    picked.push(rows[idx]);
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
