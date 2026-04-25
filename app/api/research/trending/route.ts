import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth_middleware";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/research/trending?days=3&limit=50
 * Get keywords that first appeared recently, sorted by current value
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") ?? "3", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  const { rows } = await d1Query<{
    keyword: string;
    current_value: number;
    first_seen: string;
    days_active: number;
  }>(
    `SELECT 
       h.keyword,
       h.value as current_value,
       MIN(h2.date) as first_seen,
       CAST(julianday('now') - julianday(MIN(h2.date)) AS INTEGER) as days_active
     FROM keyword_history h
     JOIN keyword_history h2 ON h.keyword_normalized = h2.keyword_normalized
     WHERE h.date = date('now')
       AND h2.date >= date('now', '-' || ? || ' days')
     GROUP BY h.keyword_normalized
     HAVING first_seen >= date('now', '-' || ? || ' days')
     ORDER BY h.value DESC
     LIMIT ?`,
    [String(days), String(days), String(limit)]
  );

  return NextResponse.json({
    days,
    keywords: rows.map(r => ({
      keyword: r.keyword,
      value: r.current_value,
      firstSeen: r.first_seen,
      daysActive: r.days_active ?? 1,
    })),
  });
}
