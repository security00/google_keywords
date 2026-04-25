import { NextResponse } from "next/server";
import { d1Query } from "@/lib/d1";
import { isAuthzError, requireCronOrAdmin } from "@/lib/authz";

export async function POST(request: Request) {
  const principal = await requireCronOrAdmin(request);
  if (isAuthzError(principal)) return principal;

  const body = await request.json();
  const keywords: Array<Record<string, unknown>> = body.keywords || [];

  if (!Array.isArray(keywords) || keywords.length === 0) {
    return NextResponse.json({ error: "keywords array required" }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  let saved = 0;

  for (const kw of keywords) {
    try {
      await d1Query(
        `INSERT OR REPLACE INTO old_keyword_opportunities
         (keyword, source_seed, volume, cpc, kd, competition, intent, toolable, score, scan_date, trend_series)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(kw.keyword || ""),
          String(kw.source_seed || ""),
          Number(kw.volume || 0),
          Number(kw.cpc || 0),
          Number(kw.kd || 0),
          String(kw.competition || ""),
          String(kw.intent || ""),
          Boolean(kw.toolable) ? 1 : 0,
          Number(kw.score || 0),
          today,
          kw.trend_series || null,
        ]
      );
      saved++;
    } catch {
      // Skip
    }
  }

  return NextResponse.json({ saved, total: keywords.length });
}

export async function GET(request: Request) {
  const principal = await requireCronOrAdmin(request);
  if (isAuthzError(principal)) return principal;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
  const minScore = parseInt(url.searchParams.get("minScore") || "0");

  const { rows } = await d1Query<Record<string, unknown>>(
    `SELECT keyword, source_seed, volume, cpc, kd, competition, intent, toolable, score, scan_date, trend_series
     FROM old_keyword_opportunities
     WHERE score >= ?
     ORDER BY score DESC
     LIMIT ?`,
    [minScore, limit]
  );

  return NextResponse.json({ keywords: rows });
}
