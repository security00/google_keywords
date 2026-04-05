import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { d1Query } from "@/lib/d1";
import { getAuthUser } from "@/lib/auth";
import {
  DEFAULT_CHECK_INTERVAL_MINUTES,
  ensureSitemapSourcesColumns,
  normalizeCheckIntervalMinutes,
} from "@/lib/sitemap-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SourceRow = {
  id: string;
  user_id: string;
  name: string | null;
  sitemap_url: string;
  enabled: number | null;
  rules_json: string | null;
  last_checked_at: string | null;
  check_interval_minutes: number | null;
  next_check_at: string | null;
  created_at: string;
  updated_at: string;
};

const parseCheckIntervalMinutes = (value: unknown) => {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : undefined;
  return normalizeCheckIntervalMinutes(normalized, DEFAULT_CHECK_INTERVAL_MINUTES);
};

const toBool = (value: number | null) => Boolean(value);

export async function GET() {
  try {
    await ensureSitemapSourcesColumns();
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { rows } = await d1Query<SourceRow>(
      "SELECT id, user_id, name, sitemap_url, enabled, rules_json, last_checked_at, check_interval_minutes, next_check_at, created_at, updated_at FROM sitemap_sources WHERE user_id = ? ORDER BY created_at DESC",
      [user.id]
    );

    return NextResponse.json({
      sources: rows.map((row) => ({
        id: row.id,
        name: row.name,
        sitemapUrl: row.sitemap_url,
        enabled: toBool(row.enabled),
        rulesJson: row.rules_json,
        lastCheckedAt: row.last_checked_at,
        checkIntervalMinutes: row.check_interval_minutes ?? DEFAULT_CHECK_INTERVAL_MINUTES,
        nextCheckAt: row.next_check_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSitemapSourcesColumns();
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const now = new Date().toISOString();

    const sources = Array.isArray(body?.sources)
      ? body.sources
      : body?.sitemapUrl
        ? [body]
        : [];

    if (sources.length === 0) {
      return NextResponse.json({ error: "sitemapUrl is required" }, { status: 400 });
    }

    let inserted = 0;
    for (const item of sources) {
      const sitemapUrl = typeof item?.sitemapUrl === "string" ? item.sitemapUrl.trim() : "";
      if (!sitemapUrl) continue;
      const name = typeof item?.name === "string" ? item.name.trim() : null;
      const rulesJson = typeof item?.rulesJson === "string" ? item.rulesJson.trim() : null;
      const enabled = item?.enabled === false ? 0 : 1;
      const checkIntervalMinutes = parseCheckIntervalMinutes(item?.checkIntervalMinutes);
      const nextCheckAt = new Date(Date.now() + checkIntervalMinutes * 60_000).toISOString();

      const { meta } = await d1Query(
        `INSERT OR IGNORE INTO sitemap_sources (id, user_id, name, sitemap_url, enabled, rules_json, check_interval_minutes, next_check_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          user.id,
          name,
          sitemapUrl,
          enabled,
          rulesJson,
          checkIntervalMinutes,
          nextCheckAt,
          now,
          now,
        ]
      );
      if (meta?.changes) inserted += meta.changes;
    }

    return NextResponse.json({ inserted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
