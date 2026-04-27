import "server-only";

import { d1Query } from "@/lib/d1";
import type {
  PipelineRun,
  PipelineRunCompletionInput,
  PipelineRunInput,
  PipelineRunUpdateInput,
} from "./types";

type PipelineRunRow = {
  run_id: string;
  run_key: string | null;
  pipeline: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  checked_count: number | null;
  saved_count: number | null;
  estimated_cost_usd: number | null;
  budget_usd: number | null;
  error: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

const parseObject = (value: string | null): Record<string, unknown> | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const toPipelineRun = (row: PipelineRunRow): PipelineRun => ({
  runId: row.run_id,
  runKey: row.run_key,
  pipeline: row.pipeline,
  status: row.status,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  durationSeconds: row.duration_seconds,
  checkedCount: row.checked_count,
  savedCount: row.saved_count,
  estimatedCostUsd: row.estimated_cost_usd,
  budgetUsd: row.budget_usd,
  error: row.error,
  metadata: parseObject(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const loadPipelineRunById = async (runId: string) => {
  const { rows } = await d1Query<PipelineRunRow>(
    "SELECT * FROM pipeline_runs WHERE run_id = ? LIMIT 1",
    [runId]
  );
  return rows[0] ? toPipelineRun(rows[0]) : null;
};

export const loadPipelineRunByKey = async (runKey: string) => {
  const { rows } = await d1Query<PipelineRunRow>(
    "SELECT * FROM pipeline_runs WHERE run_key = ? LIMIT 1",
    [runKey]
  );
  return rows[0] ? toPipelineRun(rows[0]) : null;
};

export const startPipelineRun = async (input: PipelineRunInput) => {
  const now = new Date().toISOString();
  const startedAt = input.startedAt ?? now;

  await d1Query(
    `INSERT INTO pipeline_runs
       (run_id, run_key, pipeline, status, started_at, budget_usd, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET
       run_key = COALESCE(excluded.run_key, pipeline_runs.run_key),
       pipeline = excluded.pipeline,
       status = excluded.status,
       started_at = excluded.started_at,
       budget_usd = COALESCE(excluded.budget_usd, pipeline_runs.budget_usd),
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`,
    [
      input.runId,
      input.runKey ?? null,
      input.pipeline,
      input.status ?? "running",
      startedAt,
      input.budgetUsd ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
    ]
  );

  return loadPipelineRunById(input.runId);
};

export const updatePipelineRun = async (runId: string, input: PipelineRunUpdateInput) => {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.checkedCount !== undefined) {
    sets.push("checked_count = ?");
    params.push(input.checkedCount);
  }
  if (input.savedCount !== undefined) {
    sets.push("saved_count = ?");
    params.push(input.savedCount);
  }
  if (input.estimatedCostUsd !== undefined) {
    sets.push("estimated_cost_usd = ?");
    params.push(input.estimatedCostUsd);
  }
  if (input.budgetUsd !== undefined) {
    sets.push("budget_usd = ?");
    params.push(input.budgetUsd);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata_json = ?");
    params.push(input.metadata ? JSON.stringify(input.metadata) : null);
  }
  if (!sets.length) return loadPipelineRunById(runId);

  sets.push("updated_at = ?");
  params.push(new Date().toISOString(), runId);

  await d1Query(`UPDATE pipeline_runs SET ${sets.join(", ")} WHERE run_id = ?`, params);
  return loadPipelineRunById(runId);
};

export const completePipelineRun = async (
  runId: string,
  input: PipelineRunCompletionInput
) => {
  const completedAt = input.completedAt ?? new Date().toISOString();

  await d1Query(
    `UPDATE pipeline_runs
     SET status = ?,
         completed_at = ?,
         duration_seconds = COALESCE(?, duration_seconds),
         error = ?,
         metadata_json = COALESCE(?, metadata_json),
         updated_at = ?
     WHERE run_id = ?`,
    [
      input.status,
      completedAt,
      input.durationSeconds ?? null,
      input.error ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      completedAt,
      runId,
    ]
  );

  return loadPipelineRunById(runId);
};
