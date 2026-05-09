import { NextResponse } from "next/server";

import { isAuthzError, requireAdminRequest } from "@/lib/authz";
import { d1Query } from "@/lib/d1";
import { updateGameRadarSource, upsertGameRadarSource } from "@/lib/game-radar-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SourceRow = {
  id: string;
  name: string;
  base_url: string;
  sitemap_url: string;
  enabled: number;
  quality_tier: number;
  status_note: string | null;
  last_checked_at: string | null;
  page_count: number;
  candidate_count: number;
  latest_candidate_at: string | null;
};

type CandidateRow = {
  id: string;
  keyword: string;
  keyword_normalized: string;
  source_id: string;
  source_name: string;
  url: string;
  status: string;
  reject_reason: string | null;
  created_at: string;
};

type StatusRow = {
  status: string;
  count: number;
};

export async function GET(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  try {
    const [sources, candidates, statusCounts] = await Promise.all([
      d1Query<SourceRow>(
        `SELECT s.id, s.name, s.base_url, s.sitemap_url, s.enabled, s.quality_tier, s.status_note, s.last_checked_at,
                COUNT(DISTINCT p.id) AS page_count,
                COUNT(DISTINCT c.id) AS candidate_count,
                MAX(c.created_at) AS latest_candidate_at
         FROM game_radar_sources s
         LEFT JOIN game_radar_pages p ON p.source_id = s.id
         LEFT JOIN game_radar_candidates c ON c.source_id = s.id
         GROUP BY s.id, s.name, s.base_url, s.sitemap_url, s.enabled, s.quality_tier, s.status_note, s.last_checked_at
         ORDER BY s.quality_tier ASC, s.id ASC`
      ),
      d1Query<CandidateRow>(
        `SELECT c.id, c.keyword, c.keyword_normalized, c.source_id, s.name AS source_name,
                c.url, c.status, c.reject_reason, c.created_at
         FROM game_radar_candidates c
         JOIN game_radar_sources s ON s.id = c.source_id
         ORDER BY c.created_at DESC
         LIMIT 100`
      ),
      d1Query<StatusRow>(
        `SELECT status, COUNT(*) AS count
         FROM game_radar_candidates
         GROUP BY status
         ORDER BY count DESC`
      ),
    ]);

    return NextResponse.json({
      sources: sources.rows,
      candidates: candidates.rows,
      statusCounts: statusCounts.rows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  try {
    const body = await request.json().catch(() => ({}));
    await upsertGameRadarSource({
      id: typeof body.id === "string" ? body.id : "",
      name: typeof body.name === "string" ? body.name : "",
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
      sitemapUrl: typeof body.sitemapUrl === "string" ? body.sitemapUrl : "",
      enabled: Boolean(body.enabled),
      qualityTier: typeof body.qualityTier === "number" ? body.qualityTier : 9,
      urlIncludePatterns: typeof body.urlIncludePatterns === "string" ? body.urlIncludePatterns : "[]",
      urlExcludePatterns: typeof body.urlExcludePatterns === "string" ? body.urlExcludePatterns : "[]",
      keywordExtractRule: typeof body.keywordExtractRule === "string" ? body.keywordExtractRule : "{}",
      statusNote: typeof body.statusNote === "string" || body.statusNote === null ? body.statusNote : undefined,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    const status = message.includes("required") || message.includes("Invalid") || message.includes("must") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  try {
    const body = await request.json().catch(() => ({}));
    await updateGameRadarSource({
      id: typeof body.id === "string" ? body.id : "",
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      qualityTier: typeof body.qualityTier === "number" ? body.qualityTier : undefined,
      statusNote: typeof body.statusNote === "string" || body.statusNote === null ? body.statusNote : undefined,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    const status = message.includes("required") || message.includes("Invalid") || message.includes("provided") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
