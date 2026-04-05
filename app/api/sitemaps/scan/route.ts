import { NextResponse } from "next/server";

import { d1Query } from "@/lib/d1";
import { getAuthUser } from "@/lib/auth";
import {
  DEFAULT_CHECK_INTERVAL_MINUTES,
  ensureSitemapSourcesColumns,
  runDiscoveryScan,
  type DiscoverySourceRow,
} from "@/lib/sitemap-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await ensureSitemapSourcesColumns();
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const sourceId = typeof body?.sourceId === "string" ? body.sourceId : null;
    const ignoreFirstScan = body?.ignoreFirstScan !== false;

    const sourcesQuery = sourceId
      ? {
          sql: `SELECT id, user_id, name, sitemap_url, enabled, rules_json, etag, last_modified, last_checked_at,
                 check_interval_minutes, next_check_at
                FROM sitemap_sources
                WHERE id = ? AND user_id = ?
                LIMIT 1`,
          params: [sourceId, user.id],
        }
      : {
          sql: `SELECT id, user_id, name, sitemap_url, enabled, rules_json, etag, last_modified, last_checked_at,
                 check_interval_minutes, next_check_at
                FROM sitemap_sources
                WHERE user_id = ? AND enabled = 1
                ORDER BY created_at DESC`,
          params: [user.id],
        };

    const { rows } = await d1Query<DiscoverySourceRow>(sourcesQuery.sql, sourcesQuery.params);
    if (rows.length === 0) {
      return NextResponse.json({ error: "No sitemap sources found" }, { status: 400 });
    }

    const results = await runDiscoveryScan(rows, {
      ignoreFirstScan,
      defaultCheckIntervalMinutes: DEFAULT_CHECK_INTERVAL_MINUTES,
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error("[sitemaps/scan]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
