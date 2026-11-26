import { NextResponse } from "next/server";
import { d1Batch, d1Query } from "@/lib/d1";
import { oldEvaluationJoin } from "@/lib/discovery-evidence";
import { isAuthzError, requireCronOrAdmin } from "@/lib/authz";

export async function POST(request: Request) {
  const principal = await requireCronOrAdmin(request);
  if (isAuthzError(principal)) return principal;

  const body = await request.json();
  const keywords: Array<Record<string, unknown>> = body.keywords || [];

  if (!Array.isArray(keywords) || keywords.length === 0) {
    return NextResponse.json({ error: "keywords array required" }, { status: 400 });
  }

  const scanDate = body.scanDate ?? new Date().toISOString().slice(0, 10);
  if (typeof scanDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scanDate) ||
      !Number.isFinite(Date.parse(scanDate)) || new Date(scanDate).toISOString().slice(0, 10) !== scanDate ||
      keywords.some(kw => typeof kw?.keyword !== "string" || !kw.keyword.trim())) {
    return NextResponse.json({ error: "Invalid scan date or keyword" }, { status: 400 });
  }
  await d1Batch(keywords.map(kw => ({
    sql: `INSERT INTO old_keyword_opportunities
     (keyword, source_seed, volume, cpc, kd, competition, intent, toolable, score, scan_date, trend_series, monthly_searches_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(keyword, scan_date) DO UPDATE SET
       source_seed=excluded.source_seed, volume=excluded.volume, cpc=excluded.cpc, kd=excluded.kd,
       competition=excluded.competition, intent=excluded.intent, toolable=excluded.toolable, score=excluded.score,
       trend_series=coalesce(excluded.trend_series, old_keyword_opportunities.trend_series),
       monthly_searches_json=coalesce(excluded.monthly_searches_json, old_keyword_opportunities.monthly_searches_json)`,
    params: [
      String(kw.keyword || ""),
      String(kw.source_seed || ""),
      Number(kw.volume || 0),
      Number(kw.cpc || 0),
      Number(kw.kd || 0),
      String(kw.competition || ""),
      String(kw.intent || ""),
      Boolean(kw.toolable) ? 1 : 0,
      Number(kw.score || 0),
      scanDate,
      kw.trend_series || null,
      Array.isArray(kw.monthlySearches) && kw.monthlySearches.length ? JSON.stringify(kw.monthlySearches.slice(-12)) : null,
    ],
  })));

  return NextResponse.json({ saved: keywords.length, total: keywords.length });
}

export async function GET(request: Request) {
  const principal = await requireCronOrAdmin(request);
  if (isAuthzError(principal)) return principal;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
  const minScore = parseInt(url.searchParams.get("minScore") || "0");
  const scanDate = (url.searchParams.get("scanDate") || "").trim();

  const aliasedDateFilterSql = scanDate
    ? "o.scan_date = ?"
    : "o.scan_date = (SELECT MAX(scan_date) FROM old_keyword_opportunities)";
  const aliasedReliableKdSql = "NOT (o.kd <= 0 AND (o.volume >= 10000 OR o.competition != 'LOW'))";
  const params: Array<string | number> = scanDate ? [minScore, scanDate, limit] : [minScore, limit];

  const { rows } = await d1Query<Record<string, unknown>>(
    `SELECT o.keyword, o.source_seed, o.volume, o.cpc, o.kd, o.competition, o.intent,
            o.toolable, o.score, o.scan_date, o.trend_series,
            e.real_score, e.base_score, e.serp_score, e.brand_safety_score,
            e.intent_score, e.content_feasibility_score, e.serp_organic, e.serp_auth,
            e.serp_featured, e.serp_ai_overview, e.top_domains_json, e.signals_json,
            e.evaluated_at
     FROM old_keyword_opportunities o
     ${oldEvaluationJoin}
     WHERE o.score >= ? AND ${aliasedDateFilterSql} AND ${aliasedReliableKdSql}
     ORDER BY e.real_score IS NULL, e.real_score DESC, o.score DESC
     LIMIT ?`,
    params
  );

  const { rows: dateRows } = await d1Query<{ scan_date: string; total: number }>(
    `SELECT scan_date, COUNT(*) as total
     FROM old_keyword_opportunities
     GROUP BY scan_date
     ORDER BY scan_date DESC`
  );

  return NextResponse.json({
    keywords: rows.map((row) => ({
      ...row,
      top_domains: typeof row.top_domains_json === "string" ? safeParseJson(row.top_domains_json) : null,
      signals: typeof row.signals_json === "string" ? safeParseJson(row.signals_json) : null,
    })),
    scanDate: scanDate || dateRows[0]?.scan_date || null,
    availableDates: dateRows,
  });
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
