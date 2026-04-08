import { NextResponse } from "next/server";

import { d1Query } from "@/lib/d1";
import {
  DEFAULT_CHECK_INTERVAL_MINUTES,
  ensureSitemapSourcesColumns,
  normalizeCheckIntervalMinutes,
  runDiscoveryScan,
  type DiscoverySourceRow,
} from "@/lib/sitemap-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isAuthorized = (request: Request) => {
  const secret = process.env.CRON_SECRET;
  const extSecret = process.env.EXTERNAL_CRON_SECRET;
  if (!secret && !extSecret) return false;

  const authHeader = request.headers.get("authorization");
  if (secret && authHeader && authHeader === `Bearer ${secret}`) return true;
  if (extSecret && authHeader && authHeader === `Bearer ${extSecret}`) return true;

  const headerSecret = request.headers.get("x-cron-secret");
  if (secret && headerSecret && headerSecret === secret) return true;
  if (extSecret && headerSecret && headerSecret === extSecret) return true;

  const querySecret = new URL(request.url).searchParams.get("secret");
  if (secret && querySecret === secret) return true;
  if (extSecret && querySecret === extSecret) return true;

  return false;
};

const handleCronRun = async (request: Request) => {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureSitemapSourcesColumns();
    const now = new Date();
    const runAt = now.toISOString();
    const defaultCheckIntervalMinutes = normalizeCheckIntervalMinutes(
      (() => {
        const value = process.env.SITEMAP_DISCOVERY_DEFAULT_CHECK_INTERVAL_MINUTES;
        if (!value) return undefined;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      })(),
      DEFAULT_CHECK_INTERVAL_MINUTES
    );

    const { rows } = await d1Query<DiscoverySourceRow>(
      `SELECT id, user_id, name, sitemap_url, enabled, rules_json, etag, last_modified, last_checked_at, check_interval_minutes, next_check_at
       FROM sitemap_sources
       WHERE enabled = 1 AND (next_check_at IS NULL OR next_check_at <= ?)
       ORDER BY COALESCE(next_check_at, last_checked_at) ASC
       LIMIT 100`,
      [runAt]
    );

    if (rows.length === 0) {
      return NextResponse.json({ scanned: 0, results: [] });
    }

    const results = await runDiscoveryScan(rows, {
      ignoreFirstScan: false,
      runAt,
      defaultCheckIntervalMinutes,
    });

    const failed = results.filter((result) => Boolean(result.error)).length;

    return NextResponse.json({
      scanned: rows.length,
      failed,
      results,
    });
  } catch (error) {
    console.error("[cron/discovery]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
};

export async function POST(request: Request) {
  return handleCronRun(request);
}

export async function GET(request: Request) {
  return handleCronRun(request);
}
