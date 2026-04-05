import "server-only";

import { randomUUID } from "crypto";

import { d1Query } from "@/lib/d1";

export type JobStatus = "pending" | "processing" | "complete" | "failed";
export type JobType = "expand" | "compare";

export type ResearchJob = {
  id: string;
  user_id: string;
  job_type: JobType;
  status: JobStatus;
  task_ids: string[];
  payload: Record<string, unknown> | null;
  session_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type JobRow = {
  id: string;
  user_id: string;
  job_type: JobType;
  status: JobStatus;
  task_ids: string | null;
  payload: string | null;
  session_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const parseJson = <T,>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const parseJsonArray = (value: string | null) => {
  const parsed = parseJson<string[]>(value);
  return Array.isArray(parsed) ? parsed : [];
};

const toJob = (row: JobRow): ResearchJob => ({
  id: row.id,
  user_id: row.user_id,
  job_type: row.job_type,
  status: row.status,
  task_ids: parseJsonArray(row.task_ids),
  payload: parseJson<Record<string, unknown>>(row.payload),
  session_id: row.session_id,
  error: row.error,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export const createJob = async (
  userId: string,
  jobType: JobType,
  taskIds: string[],
  payload: Record<string, unknown>
) => {
  const id = randomUUID();
  const now = new Date().toISOString();

  await d1Query(
    "INSERT INTO research_jobs (id, user_id, job_type, status, task_ids, payload, session_id, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      userId,
      jobType,
      "pending",
      JSON.stringify(taskIds),
      JSON.stringify(payload),
      null,
      null,
      now,
      now,
    ]
  );

  return id;
};

export const getJob = async (id: string, userId: string) => {
  const { rows } = await d1Query<JobRow>(
    "SELECT * FROM research_jobs WHERE id = ? AND user_id = ? LIMIT 1",
    [id, userId]
  );
  const row = rows[0];
  return row ? toJob(row) : null;
};

export const updateJobStatus = async (
  id: string,
  status: JobStatus,
  fields: { sessionId?: string | null; error?: string | null } = {}
) => {
  const now = new Date().toISOString();
  await d1Query(
    "UPDATE research_jobs SET status = ?, session_id = ?, error = ?, updated_at = ? WHERE id = ?",
    [status, fields.sessionId ?? null, fields.error ?? null, now, id]
  );
};
