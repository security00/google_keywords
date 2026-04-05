import { NextResponse } from "next/server";

import { d1Query } from "@/lib/d1";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KeywordRow = {
  id: string;
  keyword: string;
  status: string;
  url: string;
  extracted_at: string;
  source_id: string;
  source_name: string | null;
  sitemap_url: string;
};

export async function GET(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const sourceId = url.searchParams.get("sourceId");
    const query = url.searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const offset = (page - 1) * limit;

    const where: string[] = ["dk.user_id = ?"];
    const params: unknown[] = [user.id];

    if (status) {
      where.push("dk.status = ?");
      params.push(status);
    }

    if (sourceId) {
      where.push("dk.source_id = ?");
      params.push(sourceId);
    }

    if (query) {
      where.push("(dk.keyword LIKE ? OR dk.url LIKE ?)");
      params.push(`%${query}%`, `%${query}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const { rows: countRows } = await d1Query<{ total: number }>(
      `SELECT COUNT(*) as total FROM discovered_keywords dk ${whereSql}`,
      params
    );

    const { rows } = await d1Query<KeywordRow>(
      `SELECT dk.id, dk.keyword, dk.status, dk.url, dk.extracted_at, dk.source_id,
              s.name as source_name, s.sitemap_url
       FROM discovered_keywords dk
       JOIN sitemap_sources s ON s.id = dk.source_id
       ${whereSql}
       ORDER BY dk.extracted_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return NextResponse.json({
      total: countRows[0]?.total ?? 0,
      page,
      limit,
      keywords: rows.map((row) => ({
        id: row.id,
        keyword: row.keyword,
        status: row.status,
        url: row.url,
        extractedAt: row.extracted_at,
        sourceId: row.source_id,
        sourceName: row.source_name,
        sitemapUrl: row.sitemap_url,
      })),
    });
  } catch (error) {
    console.error("[sitemaps/keywords]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
