import { NextResponse } from "next/server";
import { d1Query } from "@/lib/d1";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin();
    if (admin.error) {
      // Fallback: accept API key via Authorization header (for skill integration)
      const authHeader = request.headers.get("authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (!token || !/gk_live_[0-9a-f]{32,64}/.test(token)) {
        return NextResponse.json({ error: admin.error }, { status: 403 });
      }
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = Math.min(parseInt(searchParams.get("pageSize") || "20"), 100);
    const filter = searchParams.get("filter"); // "recommended" | "all"
    const offset = (page - 1) * pageSize;

    let where = "";
    const params: string[] = [];

    if (filter === "recommended") {
      where = "WHERE recommendation != '⏭️ skip' AND recommendation IS NOT NULL";
    }

    const countResult = await d1Query(
      `SELECT COUNT(*) as total FROM game_keyword_pipeline ${where}`, params
    );
    const dataResult = await d1Query(
      `SELECT keyword, source_site, trend_ratio, trend_slope, trend_verdict,
              serp_organic, serp_auth, serp_featured, recommendation, reason,
              status, trend_checked_at, created_at, trend_series
       FROM game_keyword_pipeline ${where}
       ORDER BY trend_checked_at DESC LIMIT ? OFFSET ?`,
      [...params, String(pageSize), String(offset)]
    );

    const total = Number(countResult.rows[0]?.total || 0);
    const rows = dataResult.rows;

    return NextResponse.json({
      items: rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("admin") || msg.includes("Admin")) return NextResponse.json({ error: msg }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
