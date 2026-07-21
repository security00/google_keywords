import "server-only";

import { createHash, randomUUID } from "crypto";

import { d1Batch, d1Query } from "@/lib/d1";

export type JobStatus = "pending" | "processing" | "complete" | "failed";
export type JobType = "expand" | "compare" | "intent" | "trends" | "semantic_filter";
export type JobExecutionMode = "platform" | "byok";
export type JobCredentialSource = "platform" | "user";
export type ProviderRequestState = "not_started" | "started" | "completed" | "failed";

type CreateJobOptions = {
  executionMode?: JobExecutionMode;
  credentialSource?: JobCredentialSource;
  idempotencyKey?: string | null;
};

export type ResearchJob = {
  id: string;
  user_id: string;
  job_type: JobType;
  status: JobStatus;
  task_ids: string[];
  payload: Record<string, unknown> | null;
  session_id: string | null;
  error: string | null;
  execution_mode: JobExecutionMode;
  credential_source: JobCredentialSource;
  idempotency_key: string | null;
  claim_token: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  provider_connection_id: string | null;
  provider_connection_version: number | null;
  provider_request_state: ProviderRequestState;
  result_cache_key: string | null;
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
  execution_mode: JobExecutionMode | null;
  credential_source: JobCredentialSource | null;
  idempotency_key: string | null;
  claim_token: string | null;
  lease_expires_at: string | null;
  attempt_count: number | null;
  provider_connection_id?: string | null;
  provider_connection_version?: number | null;
  provider_request_state?: ProviderRequestState | null;
  result_cache_key?: string | null;
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
  execution_mode: row.execution_mode ?? "platform",
  credential_source: row.credential_source ?? "platform",
  idempotency_key: row.idempotency_key,
  claim_token: row.claim_token,
  lease_expires_at: row.lease_expires_at,
  attempt_count: Number(row.attempt_count ?? 0),
  provider_connection_id: row.provider_connection_id ?? null,
  provider_connection_version: row.provider_connection_version == null
    ? null
    : Number(row.provider_connection_version),
  provider_request_state: row.provider_request_state ?? "not_started",
  result_cache_key: row.result_cache_key ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const buildJobRequestKey = (
  userId: string,
  jobType: JobType,
  logicalKey: string,
) =>
  createHash("sha256")
    .update(JSON.stringify({ userId, jobType, logicalKey }))
    .digest("hex");

export const createJob = async (
  userId: string,
  jobType: JobType,
  taskIds: string[],
  payload: Record<string, unknown>,
  options: CreateJobOptions = {},
) => {
  const id = randomUUID();
  const now = new Date().toISOString();

  await d1Query(
    `INSERT INTO research_jobs
     (id, user_id, job_type, status, task_ids, payload, session_id, error,
      execution_mode, credential_source, idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      jobType,
      "pending",
      JSON.stringify(taskIds),
      JSON.stringify(payload),
      null,
      null,
      options.executionMode ?? "platform",
      options.credentialSource ?? "platform",
      options.idempotencyKey ?? null,
      now,
      now,
    ]
  );

  return id;
};

export const createOrGetOwnedByokJob = async (input: Readonly<{
  userId: string;
  jobType: "semantic_filter";
  payload: Record<string, unknown>;
  idempotencyKey: string;
  providerConnectionId: string;
  providerConnectionVersion: number;
}>): Promise<{ job: ResearchJob; created: boolean }> => {
  if (
    !input.userId
    || !input.idempotencyKey
    || !input.providerConnectionId
    || !Number.isInteger(input.providerConnectionVersion)
    || input.providerConnectionVersion < 1
  ) {
    throw new Error("INVALID_BYOK_JOB_INPUT");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const results = await d1Batch<JobRow>([
    {
      sql: `INSERT OR IGNORE INTO research_jobs
            (id, user_id, job_type, status, task_ids, payload, session_id, error,
             execution_mode, credential_source, idempotency_key,
             provider_connection_id, provider_connection_version,
             provider_request_state, created_at, updated_at)
            VALUES (?, ?, ?, 'pending', '[]', ?, NULL, NULL,
                    'byok', 'user', ?, ?, ?, 'not_started', ?, ?)`,
      params: [
        id,
        input.userId,
        input.jobType,
        JSON.stringify(input.payload),
        input.idempotencyKey,
        input.providerConnectionId,
        input.providerConnectionVersion,
        now,
        now,
      ],
    },
    {
      sql: `SELECT * FROM research_jobs
            WHERE user_id = ? AND job_type = ? AND idempotency_key = ?
              AND execution_mode = 'byok' AND credential_source = 'user'
            LIMIT 1`,
      params: [input.userId, input.jobType, input.idempotencyKey],
    },
  ]);
  const row = results[1]?.rows[0];
  if (!row) throw new Error("BYOK_JOB_PERSISTENCE_ERROR");
  return {
    job: toJob(row),
    created: (results[0]?.meta?.changes ?? 0) === 1,
  };
};

export const claimOwnedByokJob = async (input: Readonly<{
  id: string;
  userId: string;
  jobType: "semantic_filter";
  providerConnectionId: string;
  providerConnectionVersion: number;
}>): Promise<ResearchJobClaim | null> => {
  const now = new Date().toISOString();
  const token = randomUUID();
  const { meta } = await d1Query(
    `UPDATE research_jobs
     SET status = 'processing', provider_request_state = 'started',
         claim_token = ?, lease_expires_at = NULL,
         attempt_count = attempt_count + 1, error = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND job_type = ?
       AND execution_mode = 'byok' AND credential_source = 'user'
       AND status = 'pending' AND provider_request_state = 'not_started'
       AND provider_connection_id = ? AND provider_connection_version = ?`,
    [
      token,
      now,
      input.id,
      input.userId,
      input.jobType,
      input.providerConnectionId,
      input.providerConnectionVersion,
    ],
  );
  return (meta?.changes ?? 0) === 1
    ? { token, leaseExpiresAt: now }
    : null;
};

export const completeOwnedByokJob = async (input: Readonly<{
  id: string;
  userId: string;
  claimToken: string;
  resultCacheKey: string;
}>): Promise<boolean> => {
  const now = new Date().toISOString();
  const { meta } = await d1Query(
    `UPDATE research_jobs
     SET status = 'complete', provider_request_state = 'completed',
         result_cache_key = ?, error = NULL, claim_token = NULL,
         lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND claim_token = ?
       AND execution_mode = 'byok' AND credential_source = 'user'
       AND provider_request_state = 'started'`,
    [input.resultCacheKey, now, input.id, input.userId, input.claimToken],
  );
  return (meta?.changes ?? 0) === 1;
};

export const failOwnedByokJob = async (input: Readonly<{
  id: string;
  userId: string;
  claimToken: string;
  errorCode: string;
}>): Promise<boolean> => {
  if (!/^[A-Z0-9_]{1,64}$/.test(input.errorCode)) {
    throw new Error("INVALID_BYOK_JOB_ERROR");
  }
  const now = new Date().toISOString();
  const { meta } = await d1Query(
    `UPDATE research_jobs
     SET status = 'failed', provider_request_state = 'failed', error = ?,
         claim_token = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND claim_token = ?
       AND execution_mode = 'byok' AND credential_source = 'user'
       AND provider_request_state = 'started'`,
    [input.errorCode, now, input.id, input.userId, input.claimToken],
  );
  return (meta?.changes ?? 0) === 1;
};

export const getOwnedJob = async (
  id: string,
  userId: string,
  jobType: JobType,
) => {
  const { rows } = await d1Query<JobRow>(
    "SELECT * FROM research_jobs WHERE id = ? AND user_id = ? AND job_type = ? LIMIT 1",
    [id, userId, jobType]
  );
  const row = rows[0];
  return row ? toJob(row) : null;
};

export const getInternalJobById = async (id: string, jobType: JobType) => {
  const { rows } = await d1Query<JobRow>(
    "SELECT * FROM research_jobs WHERE id = ? AND job_type = ? LIMIT 1",
    [id, jobType]
  );
  const row = rows[0];
  return row ? toJob(row) : null;
};

export const getOwnedJobStatusSnapshot = async (
  id: string,
  userId: string,
  jobType: JobType,
) => {
  const job = await getOwnedJob(id, userId, jobType);
  if (!job) return null;

  const results = Array.isArray(job.payload?.results)
    ? job.payload.results
    : undefined;
  return {
    status: job.status === "processing" ? "pending" : job.status,
    stage: job.status === "processing" ? "processing" : undefined,
    ready: job.status === "complete" ? job.task_ids.length : 0,
    total: job.task_ids.length,
    sessionId: job.session_id ?? undefined,
    error: job.status === "failed" ? job.error ?? "Job failed" : undefined,
    results,
  };
};

export const getJobForRequest = async (
  userId: string,
  jobType: JobType,
  logicalKey: string,
) => {
  const requestKey = buildJobRequestKey(userId, jobType, logicalKey);
  const now = new Date().toISOString();
  const { rows } = await d1Query<JobRow>(
    `SELECT j.*
     FROM research_job_requests r
     JOIN research_jobs j ON j.id = r.job_id
     WHERE r.request_key = ? AND r.user_id = ? AND r.job_type = ?
       AND r.expires_at > ?
       AND j.user_id = r.user_id AND j.job_type = r.job_type
     LIMIT 1`,
    [requestKey, userId, jobType, now],
  );
  return rows[0] ? toJob(rows[0]) : null;
};

export const linkJobToRequest = async (
  userId: string,
  jobType: JobType,
  logicalKey: string,
  jobId: string,
  ttlHours = 24,
) => {
  const requestKey = buildJobRequestKey(userId, jobType, logicalKey);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const boundedTtlHours = Number.isFinite(ttlHours)
    ? Math.min(24 * 30, Math.max(1, ttlHours))
    : 24;
  const expiresAt = new Date(
    nowMs + boundedTtlHours * 60 * 60 * 1000,
  ).toISOString();
  const { meta } = await d1Query(
    `INSERT INTO research_job_requests
     (request_key, user_id, job_type, job_id, created_at, expires_at)
     SELECT ?, ?, ?, j.id, ?, ?
     FROM research_jobs j
     WHERE j.id = ? AND j.user_id = ? AND j.job_type = ?
     ON CONFLICT(request_key) DO UPDATE SET
       job_id = excluded.job_id,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`,
    [
      requestKey,
      userId,
      jobType,
      now,
      expiresAt,
      jobId,
      userId,
      jobType,
    ],
  );
  return (meta?.changes ?? 0) > 0;
};

const DEFAULT_JOB_LEASE_MS = 10 * 60 * 1000;
const LEGACY_PROCESSING_STALE_MS = 2 * 60 * 1000;

export type ResearchJobClaim = {
  token: string;
  leaseExpiresAt: string;
};

export const isLegacyStatusGetExecutionEnabled = () =>
  String(process.env.RESEARCH_STATUS_GET_EXECUTION_COMPAT ?? "true") !== "false";

export const claimOwnedJob = async (
  id: string,
  userId: string,
  jobType: JobType,
  leaseMs = DEFAULT_JOB_LEASE_MS,
): Promise<ResearchJobClaim | null> => {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const legacyStaleAt = new Date(nowMs - LEGACY_PROCESSING_STALE_MS).toISOString();
  const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
  const token = randomUUID();
  const { meta } = await d1Query(
    `UPDATE research_jobs
     SET status = 'processing', claim_token = ?, lease_expires_at = ?,
         attempt_count = attempt_count + 1, error = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND job_type = ?
       AND (
         status = 'pending'
         OR (
           status = 'processing'
           AND (
             (lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
             OR (lease_expires_at IS NULL AND updated_at <= ?)
           )
         )
       )`,
    [token, leaseExpiresAt, now, id, userId, jobType, now, legacyStaleAt],
  );
  return (meta?.changes ?? 0) > 0 ? { token, leaseExpiresAt } : null;
};

export const claimInternalJob = async (
  id: string,
  jobType: JobType,
  leaseMs = DEFAULT_JOB_LEASE_MS,
): Promise<ResearchJobClaim | null> => {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const legacyStaleAt = new Date(nowMs - LEGACY_PROCESSING_STALE_MS).toISOString();
  const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
  const token = randomUUID();
  const { meta } = await d1Query(
    `UPDATE research_jobs
     SET status = 'processing', claim_token = ?, lease_expires_at = ?,
         attempt_count = attempt_count + 1, error = NULL, updated_at = ?
     WHERE id = ? AND job_type = ?
       AND (
         status = 'pending'
         OR (
           status = 'processing'
           AND (
             (lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
             OR (lease_expires_at IS NULL AND updated_at <= ?)
           )
         )
       )`,
    [token, leaseExpiresAt, now, id, jobType, now, legacyStaleAt],
  );
  return (meta?.changes ?? 0) > 0 ? { token, leaseExpiresAt } : null;
};

export const finishClaimedJob = async (
  id: string,
  userId: string,
  claimToken: string,
  status: Extract<JobStatus, "complete" | "failed">,
  fields: { sessionId?: string | null; error?: string | null } = {},
) => {
  const now = new Date().toISOString();
  const { meta } = await d1Query(
    `UPDATE research_jobs
     SET status = ?, session_id = ?, error = ?, claim_token = NULL,
         lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND claim_token = ?`,
    [
      status,
      fields.sessionId ?? null,
      fields.error ?? null,
      now,
      id,
      userId,
      claimToken,
    ],
  );
  return (meta?.changes ?? 0) > 0;
};

export const finishInternalClaimedJob = async (
  id: string,
  claimToken: string,
  status: Extract<JobStatus, "complete" | "failed">,
  fields: { sessionId?: string | null; error?: string | null } = {},
) => {
  const now = new Date().toISOString();
  const { meta } = await d1Query(
    `UPDATE research_jobs
     SET status = ?, session_id = ?, error = ?, claim_token = NULL,
         lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND claim_token = ?`,
    [
      status,
      fields.sessionId ?? null,
      fields.error ?? null,
      now,
      id,
      claimToken,
    ],
  );
  return (meta?.changes ?? 0) > 0;
};

export const completeOwnedJobWithPayload = async (
  id: string,
  userId: string,
  claimToken: string,
  payload: Record<string, unknown>,
) => {
  const now = new Date().toISOString();
  const { meta } = await d1Query(
    `UPDATE research_jobs
     SET status = 'complete', payload = ?, error = NULL, claim_token = NULL,
         lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND claim_token = ?`,
    [JSON.stringify(payload), now, id, userId, claimToken],
  );
  return (meta?.changes ?? 0) > 0;
};
