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
    cost_event_count: number | null;
    error: string | null;
    metadata_json: string | null;
  }>(
    `SELECT pr.run_id, pr.pipeline, pr.status, pr.started_at, pr.completed_at, pr.duration_seconds,
            pr.checked_count, pr.saved_count,
            COALESCE(SUM(pce.estimated_cost_usd), pr.estimated_cost_usd) as estimated_cost_usd,
            COUNT(pce.id) as cost_event_count,
            pr.error, pr.metadata_json
     FROM pipeline_runs pr
     LEFT JOIN pipeline_cost_events pce ON pce.run_id = pr.run_id
     ${whereSql ? whereSql.replace(/\bpipeline\b/g, "pr.pipeline").replace(/\bstatus\b/g, "pr.status") : ""}
     GROUP BY pr.run_id
     ORDER BY pr.started_at DESC
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
