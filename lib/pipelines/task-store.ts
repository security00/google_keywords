import "server-only";

import { randomUUID } from "crypto";

import { d1Query } from "@/lib/d1";
import type {
  PipelineTask,
  PipelineTaskClaimResult,
  PipelineTaskInput,
  PipelineTaskStatus,
} from "./types";

type PipelineTaskRow = {
  task_id: string;
  run_id: string;
  pipeline: string;
  stage: string;
  status: PipelineTaskStatus;
  idempotency_key: string;
  queue_message_id: string | null;
  research_job_id: string | null;
  provider_task_ids_json: string | null;
  input_ref: string | null;
  output_ref: string | null;
  payload_json: string | null;
  result_json: string | null;
  attempt_count: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  next_run_at: string | null;
  started_at: string | null;
  completed_at: string | null;
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

const parseStringArray = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const toTask = (row: PipelineTaskRow): PipelineTask => ({
  taskId: row.task_id,
  runId: row.run_id,
  pipeline: row.pipeline,
  stage: row.stage,
  status: row.status,
  idempotencyKey: row.idempotency_key,
  queueMessageId: row.queue_message_id,
  researchJobId: row.research_job_id,
  providerTaskIds: parseStringArray(row.provider_task_ids_json),
  inputRef: row.input_ref,
  outputRef: row.output_ref,
  payload: parseObject(row.payload_json),
  result: parseObject(row.result_json),
  attemptCount: Number(row.attempt_count || 0),
  maxAttempts: Number(row.max_attempts || 0),
  leaseOwner: row.lease_owner,
  leaseExpiresAt: row.lease_expires_at,
  nextRunAt: row.next_run_at,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  error: row.error,
  metadata: parseObject(row.metadata_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const isCompleted = (status: PipelineTaskStatus) =>
  status === "succeeded" ||
  status === "success_with_warnings" ||
  status === "skipped" ||
  status === "failed" ||
  status === "dead_lettered";

const isLeaseActive = (leaseExpiresAt: string | null) =>
  leaseExpiresAt ? Date.parse(leaseExpiresAt) > Date.now() : false;

const isNotDue = (nextRunAt: string | null) =>
  nextRunAt ? Date.parse(nextRunAt) > Date.now() : false;

export const loadPipelineTaskById = async (taskId: string) => {
  const { rows } = await d1Query<PipelineTaskRow>(
    "SELECT * FROM pipeline_tasks WHERE task_id = ? LIMIT 1",
    [taskId]
  );
  return rows[0] ? toTask(rows[0]) : null;
};

export const loadPipelineTaskByIdempotencyKey = async (idempotencyKey: string) => {
  const { rows } = await d1Query<PipelineTaskRow>(
    "SELECT * FROM pipeline_tasks WHERE idempotency_key = ? LIMIT 1",
    [idempotencyKey]
  );
  return rows[0] ? toTask(rows[0]) : null;
};

export const claimPipelineTask = async (
  input: PipelineTaskInput
): Promise<PipelineTaskClaimResult> => {
  const now = new Date().toISOString();
  const taskId = input.taskId ?? randomUUID();
  const leaseOwner = input.leaseOwner ?? null;
  const leaseExpiresAt = input.leaseExpiresAt ?? null;
  const maxAttempts = input.maxAttempts ?? 3;

  const inserted = await d1Query(
    `INSERT OR IGNORE INTO pipeline_tasks
      (task_id, run_id, pipeline, stage, status, idempotency_key, queue_message_id,
       research_job_id, provider_task_ids_json, input_ref, output_ref, payload_json,
       result_json, attempt_count, max_attempts, lease_owner, lease_expires_at,
       next_run_at, started_at, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      taskId,
      input.runId,
      input.pipeline,
      input.stage,
      input.idempotencyKey,
      input.queueMessageId ?? null,
      input.researchJobId ?? null,
      JSON.stringify(input.providerTaskIds ?? []),
      input.inputRef ?? null,
      input.outputRef ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.result ? JSON.stringify(input.result) : null,
      maxAttempts,
      leaseOwner,
      leaseExpiresAt,
      input.nextRunAt ?? null,
      now,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
    ]
  );

  if ((inserted.meta?.changes ?? 0) > 0) {
    const task = await loadPipelineTaskById(taskId);
    if (!task) throw new Error("Pipeline task insert succeeded but task was not found");
    return { claimed: true, existing: false, task };
  }

  const existing = await loadPipelineTaskByIdempotencyKey(input.idempotencyKey);
  if (!existing) {
    throw new Error("Pipeline task conflict occurred but existing task was not found");
  }
  if (isCompleted(existing.status)) {
    return { claimed: false, existing: true, reason: "already_completed", task: existing };
  }
  if (existing.attemptCount >= existing.maxAttempts) {
    return { claimed: false, existing: true, reason: "max_attempts_exceeded", task: existing };
  }
  if (isLeaseActive(existing.leaseExpiresAt)) {
    return { claimed: false, existing: true, reason: "lease_active", task: existing };
  }
  if (isNotDue(existing.nextRunAt)) {
    return { claimed: false, existing: true, reason: "not_due", task: existing };
  }

  const previousStatus = existing.status;
  const updated = await d1Query(
    `UPDATE pipeline_tasks
     SET status = 'running',
         attempt_count = attempt_count + 1,
         lease_owner = ?,
         lease_expires_at = ?,
         started_at = COALESCE(started_at, ?),
         error = NULL,
         updated_at = ?
     WHERE task_id = ?
       AND status NOT IN ('succeeded', 'success_with_warnings', 'skipped', 'failed', 'dead_lettered')
       AND attempt_count < max_attempts
       AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
       AND (next_run_at IS NULL OR next_run_at <= ?)`,
    [leaseOwner, leaseExpiresAt, now, now, existing.taskId, now, now]
  );

  if ((updated.meta?.changes ?? 0) <= 0) {
    const task = await loadPipelineTaskById(existing.taskId);
    if (!task) throw new Error("Pipeline task claim conflict occurred but task was not found");
    if (isCompleted(task.status)) {
      return { claimed: false, existing: true, reason: "already_completed", task };
    }
    if (task.attemptCount >= task.maxAttempts) {
      return { claimed: false, existing: true, reason: "max_attempts_exceeded", task };
    }
    if (isLeaseActive(task.leaseExpiresAt)) {
      return { claimed: false, existing: true, reason: "lease_active", task };
    }
    return { claimed: false, existing: true, reason: "not_due", task };
  }

  const task = await loadPipelineTaskById(existing.taskId);
  if (!task) throw new Error("Pipeline task claim update succeeded but task was not found");
  return { claimed: true, existing: true, previousStatus, task };
};

export const markPipelineTaskWaitingProvider = async (
  taskId: string,
  fields: {
    researchJobId?: string | null;
    providerTaskIds?: string[];
    outputRef?: string | null;
    result?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  } = {}
) => {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE pipeline_tasks
     SET status = 'waiting_provider',
         research_job_id = COALESCE(?, research_job_id),
         provider_task_ids_json = COALESCE(?, provider_task_ids_json),
         output_ref = COALESCE(?, output_ref),
         result_json = COALESCE(?, result_json),
         metadata_json = COALESCE(?, metadata_json),
         updated_at = ?
     WHERE task_id = ?`,
    [
      fields.researchJobId ?? null,
      fields.providerTaskIds ? JSON.stringify(fields.providerTaskIds) : null,
      fields.outputRef ?? null,
      fields.result ? JSON.stringify(fields.result) : null,
      fields.metadata ? JSON.stringify(fields.metadata) : null,
      now,
      taskId,
    ]
  );
};

export const markPipelineTaskSucceeded = async (
  taskId: string,
  fields: {
    status?: Extract<PipelineTaskStatus, "succeeded" | "success_with_warnings" | "skipped">;
    outputRef?: string | null;
    result?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  } = {}
) => {
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE pipeline_tasks
     SET status = ?,
         output_ref = COALESCE(?, output_ref),
         result_json = COALESCE(?, result_json),
         metadata_json = COALESCE(?, metadata_json),
         lease_owner = NULL,
         lease_expires_at = NULL,
         completed_at = ?,
         updated_at = ?
     WHERE task_id = ?`,
    [
      fields.status ?? "succeeded",
      fields.outputRef ?? null,
      fields.result ? JSON.stringify(fields.result) : null,
      fields.metadata ? JSON.stringify(fields.metadata) : null,
      now,
      now,
      taskId,
    ]
  );
};

export const markPipelineTaskFailed = async (
  taskId: string,
  fields: {
    error: string;
    retryAt?: string | null;
    deadLetter?: boolean;
    metadata?: Record<string, unknown> | null;
  }
) => {
  const now = new Date().toISOString();
  const status: PipelineTaskStatus = fields.deadLetter
    ? "dead_lettered"
    : fields.retryAt
      ? "retry_scheduled"
      : "failed";

  await d1Query(
    `UPDATE pipeline_tasks
     SET status = ?,
         error = ?,
         next_run_at = ?,
         metadata_json = COALESCE(?, metadata_json),
         lease_owner = NULL,
         lease_expires_at = NULL,
         completed_at = CASE WHEN ? IN ('failed', 'dead_lettered') THEN ? ELSE completed_at END,
         updated_at = ?
     WHERE task_id = ?`,
    [
      status,
      fields.error,
      fields.retryAt ?? null,
      fields.metadata ? JSON.stringify(fields.metadata) : null,
      status,
      now,
      now,
      taskId,
    ]
  );
};
