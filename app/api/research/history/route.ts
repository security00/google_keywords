import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth_middleware";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/research/history?keyword=xxx&days=30
 * Get historical trend data for a keyword
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get("keyword");
  const days = parseInt(searchParams.get("days") ?? "30", 10);

  if (!keyword) {
    return NextResponse.json({ error: "keyword parameter required" }, { status: 400 });
  }

  const { rows } = await d1Query<{
    date: string;
    value: number;
    type: string;
  }>(
    `SELECT date, value, type FROM keyword_history 
     WHERE keyword_normalized = ? AND date >= date('now', '-' || ? || ' days')
     ORDER BY date ASC`,
    [keyword.toLowerCase().trim(), String(days)]
  );

  // Get first seen date
  const { rows: firstRows } = await d1Query<{ first_seen: string }>(
    `SELECT MIN(date) as first_seen FROM keyword_history WHERE keyword_normalized = ?`,
    [keyword.toLowerCase().trim()]
  );

  return NextResponse.json({
    keyword,
    history: rows,
    firstSeen: firstRows[0]?.first_seen ?? null,
    daysActive: firstRows[0]?.first_seen
      ? Math.max(1, Math.round((Date.now() - new Date(firstRows[0].first_seen).getTime()) / 86400000))
      : 0,
  });
}
