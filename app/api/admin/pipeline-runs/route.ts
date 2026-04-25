import { NextResponse } from "next/server";

import { isAuthzError, requireAdminRequest } from "@/lib/authz";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clampInt = (value: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

export async function GET(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  const { searchParams } = new URL(request.url);
  const page = clampInt(searchParams.get("page"), 1, 1, 10_000);
  const pageSize = clampInt(searchParams.get("pageSize"), 20, 1, 100);
  const pipeline = (searchParams.get("pipeline") || "").trim();
  const status = (searchParams.get("status") || "").trim();
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (pipeline) {
    where.push("pipeline = ?");
    params.push(pipeline);
  }
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { rows: countRows } = await d1Query<{ total: number }>(
    `SELECT COUNT(*) as total FROM pipeline_runs ${whereSql}`,
    params,
  );
  const total = Number(countRows[0]?.total || 0);

  const { rows } = await d1Query<{
    run_id: string;
    pipeline: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    duration_seconds: number | null;
    checked_count: number | null;
    saved_count: number | null;
    estimated_cost_usd: number | null;
    error: string | null;
    metadata_json: string | null;
  }>(
    `SELECT run_id, pipeline, status, started_at, completed_at, duration_seconds,
            checked_count, saved_count, estimated_cost_usd, error, metadata_json
     FROM pipeline_runs
     ${whereSql}
     ORDER BY started_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  return NextResponse.json({
    runs: rows.map((row) => ({
      ...row,
      metadata: row.metadata_json ? safeParseJson(row.metadata_json) : null,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
