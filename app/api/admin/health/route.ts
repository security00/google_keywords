import { NextResponse } from "next/server";

import {
  listRecentPrecomputeHealth,
  type PrecomputeHealth,
  writePrecomputeHealth,
} from "@/lib/admin_health";
import { isAuthzError, requireAdminRequest, requireCron } from "@/lib/authz";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PipelineRunHealthRow = {
  pipeline: string;
  run_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  error: string | null;
  actual_cost_usd: number | null;
  estimated_cost_usd: number | null;
  accounted_cost_usd: number | null;
  cost_event_count: number;
  failed_task_count: number;
};

const loadOperationsHealth = async () => {
  try {
    const [{ rows: recentRuns }, { rows: totals }] = await Promise.all([
      d1Query<PipelineRunHealthRow>(
        `SELECT pr.pipeline, pr.run_id, pr.status, pr.started_at, pr.completed_at,
                pr.duration_seconds, pr.error,
                (SELECT SUM(actual_cost_usd) FROM pipeline_cost_events WHERE run_id = pr.run_id) AS actual_cost_usd,
                (SELECT SUM(estimated_cost_usd) FROM pipeline_cost_events WHERE run_id = pr.run_id) AS estimated_cost_usd,
                COALESCE((SELECT SUM(COALESCE(actual_cost_usd, estimated_cost_usd)) FROM pipeline_cost_events WHERE run_id = pr.run_id), pr.estimated_cost_usd) AS accounted_cost_usd,
                (SELECT COUNT(*) FROM pipeline_cost_events WHERE run_id = pr.run_id) AS cost_event_count,
                (SELECT COUNT(*) FROM pipeline_tasks WHERE run_id = pr.run_id AND status = 'failed') AS failed_task_count
         FROM pipeline_runs pr
         WHERE julianday(pr.started_at) >= julianday('now', '-7 days')
         ORDER BY pr.started_at DESC
         LIMIT 100`
      ),
      d1Query<{
        running_count: number;
        failed_runs_24h: number;
        failed_tasks_24h: number;
        actual_cost_24h: number | null;
        estimated_cost_24h: number | null;
        accounted_cost_24h: number | null;
        platform_cost_24h: number | null;
        user_cost_24h: number | null;
        stale_running_count: number;
        orphan_task_cost_count: number;
        missing_event_key_24h: number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM pipeline_runs WHERE status = 'running') AS running_count,
           (SELECT COUNT(*) FROM pipeline_runs WHERE status = 'failed' AND julianday(started_at) >= julianday('now', '-1 day')) AS failed_runs_24h,
           (SELECT COUNT(*) FROM pipeline_tasks WHERE status = 'failed' AND julianday(started_at) >= julianday('now', '-1 day')) AS failed_tasks_24h,
           (SELECT SUM(actual_cost_usd) FROM pipeline_cost_events WHERE julianday(created_at) >= julianday('now', '-1 day')) AS actual_cost_24h,
           (SELECT SUM(estimated_cost_usd) FROM pipeline_cost_events WHERE julianday(created_at) >= julianday('now', '-1 day')) AS estimated_cost_24h,
           (SELECT SUM(COALESCE(actual_cost_usd, estimated_cost_usd)) FROM pipeline_cost_events WHERE julianday(created_at) >= julianday('now', '-1 day')) AS accounted_cost_24h,
           (SELECT SUM(COALESCE(actual_cost_usd, estimated_cost_usd)) FROM pipeline_cost_events WHERE credential_source = 'platform' AND julianday(created_at) >= julianday('now', '-1 day')) AS platform_cost_24h,
           (SELECT SUM(COALESCE(actual_cost_usd, estimated_cost_usd)) FROM pipeline_cost_events WHERE credential_source = 'user' AND julianday(created_at) >= julianday('now', '-1 day')) AS user_cost_24h,
           (SELECT COUNT(*) FROM pipeline_runs WHERE status = 'running' AND julianday(updated_at) < julianday('now', '-2 hours')) AS stale_running_count,
           (SELECT COUNT(*) FROM pipeline_cost_events pce WHERE pce.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pipeline_tasks pt WHERE pt.task_id = pce.task_id)) AS orphan_task_cost_count,
           (SELECT COUNT(*) FROM pipeline_cost_events WHERE event_key IS NULL AND julianday(created_at) >= julianday('now', '-1 day')) AS missing_event_key_24h`
      ),
    ]);

    const latestByPipeline = new Map<string, PipelineRunHealthRow>();
    for (const run of recentRuns) {
      if (!latestByPipeline.has(run.pipeline)) latestByPipeline.set(run.pipeline, run);
    }
    return {
      available: true,
      latestRuns: [...latestByPipeline.values()],
      totals: totals[0] ?? {
        running_count: 0,
        failed_runs_24h: 0,
        failed_tasks_24h: 0,
        actual_cost_24h: null,
        estimated_cost_24h: null,
        accounted_cost_24h: null,
        platform_cost_24h: null,
        user_cost_24h: null,
        stale_running_count: 0,
        orphan_task_cost_count: 0,
        missing_event_key_24h: 0,
      },
    };
  } catch (error) {
    return {
      available: false,
      latestRuns: [],
      totals: null,
      error: error instanceof Error ? error.message : "Pipeline health unavailable",
    };
  }
};

const isValidHealth = (value: unknown): value is PrecomputeHealth => {
  if (!value || typeof value !== "object") return false;
  const health = value as Record<string, unknown>;
  return (
    typeof health.sharedDate === "string" &&
    health.sharedDate.length > 0 &&
    typeof health.status === "string" &&
    health.status.length > 0 &&
    typeof health.stage === "string" &&
    health.stage.length > 0
  );
};

export async function GET(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  try {
    const [items, operations] = await Promise.all([
      listRecentPrecomputeHealth(7),
      loadOperationsHealth(),
    ]);
    return NextResponse.json({
      latest: items[0] ?? null,
      items,
      operations,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Load failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const principal = await requireCron(request);
  if (isAuthzError(principal)) return principal;

  try {
    const body = await request.json().catch(() => null);
    if (!isValidHealth(body)) {
      return NextResponse.json(
        { error: "Invalid health payload" },
        { status: 400 }
      );
    }

    await writePrecomputeHealth(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Write failed" },
      { status: 500 }
    );
  }
}
