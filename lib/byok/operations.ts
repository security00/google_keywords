import "server-only";

import { d1Batch, d1Query } from "@/lib/d1";

type SummaryRow = {
  connection_count: number;
  verified_connection_count: number;
  byok_jobs_24h: number;
  completed_jobs_24h: number;
  partial_compare_jobs_24h: number;
  failed_jobs_24h: number;
  stale_started_jobs: number;
  committed_estimate_usd_24h: number | null;
  accounted_cost_usd_24h: number | null;
};
type StaleJobRow = {
  job_id: string;
  owner_id: string;
  job_type: string;
  provider_connection_id: string | null;
  provider_connection_version: number | null;
  status: string;
  provider_request_state: string;
  updated_at: string;
  cost_event_count: number;
  accounted_cost_usd: number | null;
};
type ReconciliationRow = {
  quote_id: string;
  owner_id: string;
  capability: string;
  estimated_cost_usd: number;
  research_job_id: string | null;
  job_status: string | null;
  provider_request_state: string | null;
  event_count: number;
  accounted_cost_usd: number | null;
  created_at: string;
};
type ViolationRow = {
  attribution_mismatch_count: number;
  shared_cache_violation_count: number;
  orphan_committed_quote_count: number;
  missing_cost_event_count: number;
  missing_event_key_count: number;
};

export type ByokReconciliationAction = "complete_from_private_cache" | "mark_uncertain";
export type ByokReconciliationErrorCode =
  | "JOB_NOT_FOUND"
  | "JOB_NOT_STALE"
  | "JOB_STATE_CONFLICT"
  | "PRIVATE_CACHE_NOT_FOUND"
  | "COST_EVIDENCE_NOT_FOUND"
  | "UNSUPPORTED_JOB_TYPE"
  | "PERSISTENCE_ERROR";

export class ByokReconciliationError extends Error {
  readonly code: ByokReconciliationErrorCode;
  constructor(code: ByokReconciliationErrorCode) {
    super(code);
    this.name = "ByokReconciliationError";
    this.code = code;
  }
}
const reconciliationFail = (code: ByokReconciliationErrorCode): never => {
  throw new ByokReconciliationError(code);
};

export type ByokReconciliationStatus =
  | "accounted"
  | "under_estimate"
  | "over_estimate"
  | "missing_cost_event"
  | "orphan_quote"
  | "provider_outcome_uncertain";

export const classifyByokReconciliation = (row: ReconciliationRow): ByokReconciliationStatus => {
  if (!row.research_job_id || !row.job_status) return "orphan_quote";
  if (row.job_status === "processing" && row.provider_request_state === "started") {
    return "provider_outcome_uncertain";
  }
  if (Number(row.event_count) === 0) return "missing_cost_event";
  const accounted = Number(row.accounted_cost_usd ?? 0);
  const estimated = Number(row.estimated_cost_usd);
  if (accounted > estimated + 0.000001) return "over_estimate";
  if (accounted + 0.000001 < estimated) return "under_estimate";
  return "accounted";
};

export const loadByokOperationsHealth = async (now = new Date()) => {
  const nowIso = now.toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const [summary, stale, reconciliation, violations] = await Promise.all([
    d1Query<SummaryRow>(
      `SELECT
         (SELECT COUNT(*) FROM provider_connections) AS connection_count,
         (SELECT COUNT(*) FROM provider_connections WHERE verification_status = 'valid') AS verified_connection_count,
         (SELECT COUNT(*) FROM research_jobs WHERE execution_mode = 'byok' AND created_at >= ?) AS byok_jobs_24h,
         (SELECT COUNT(*) FROM research_jobs WHERE execution_mode = 'byok' AND status = 'complete' AND created_at >= ?) AS completed_jobs_24h,
         (SELECT COUNT(*) FROM research_jobs j JOIN query_cache c ON c.cache_key = j.result_cache_key
            WHERE j.execution_mode = 'byok' AND j.job_type = 'compare' AND j.status = 'complete'
              AND c.cache_scope = 'private' AND c.owner_id = j.user_id
              AND json_extract(c.response_data, '$.partialSuccess') = 1 AND j.created_at >= ?) AS partial_compare_jobs_24h,
         (SELECT COUNT(*) FROM research_jobs WHERE execution_mode = 'byok' AND status = 'failed' AND created_at >= ?) AS failed_jobs_24h,
         (SELECT COUNT(*) FROM research_jobs WHERE execution_mode = 'byok' AND status = 'processing'
            AND provider_request_state = 'started' AND updated_at < ?) AS stale_started_jobs,
         (SELECT SUM(estimated_cost_micro_usd) / 1000000.0 FROM byok_cost_quotes
            WHERE status = 'committed' AND created_at >= ?) AS committed_estimate_usd_24h,
         (SELECT SUM(COALESCE(actual_cost_usd, estimated_cost_usd)) FROM pipeline_cost_events
            WHERE credential_source = 'user' AND execution_mode = 'byok' AND created_at >= ?) AS accounted_cost_usd_24h`,
      [dayAgo, dayAgo, dayAgo, dayAgo, staleBefore, dayAgo, dayAgo],
    ),
    d1Query<StaleJobRow>(
      `SELECT j.id AS job_id, j.user_id AS owner_id, j.job_type,
              j.provider_connection_id, j.provider_connection_version,
              j.status, j.provider_request_state, j.updated_at,
              COUNT(e.id) AS cost_event_count,
              SUM(COALESCE(e.actual_cost_usd, e.estimated_cost_usd)) AS accounted_cost_usd
       FROM research_jobs j
       LEFT JOIN pipeline_cost_events e ON e.research_job_id = j.id
       WHERE j.execution_mode = 'byok' AND j.credential_source = 'user'
         AND j.status = 'processing' AND j.provider_request_state = 'started'
         AND j.updated_at < ?
       GROUP BY j.id
       ORDER BY j.updated_at ASC
       LIMIT 100`,
      [staleBefore],
    ),
    d1Query<ReconciliationRow>(
      `SELECT q.quote_id, q.owner_id, q.capability,
              q.estimated_cost_micro_usd / 1000000.0 AS estimated_cost_usd,
              q.research_job_id, j.status AS job_status,
              j.provider_request_state, COUNT(e.id) AS event_count,
              SUM(COALESCE(e.actual_cost_usd, e.estimated_cost_usd)) AS accounted_cost_usd,
              q.created_at
       FROM byok_cost_quotes q
       LEFT JOIN research_jobs j ON j.id = q.research_job_id AND j.user_id = q.owner_id
       LEFT JOIN pipeline_cost_events e ON e.research_job_id = q.research_job_id
         AND e.owner_id = q.owner_id AND e.credential_source = 'user' AND e.execution_mode = 'byok'
       WHERE q.status = 'committed' AND q.created_at >= ?
       GROUP BY q.quote_id
       ORDER BY q.created_at DESC
       LIMIT 200`,
      [weekAgo],
    ),
    d1Query<ViolationRow>(
      `SELECT
         (SELECT COUNT(*) FROM pipeline_cost_events e
            JOIN research_jobs j ON j.id = e.research_job_id
            WHERE j.execution_mode = 'byok' AND (
              e.credential_source <> 'user' OR e.execution_mode <> 'byok'
              OR e.owner_id IS NULL OR e.owner_id <> j.user_id
            )) AS attribution_mismatch_count,
         (SELECT COUNT(*) FROM research_jobs j JOIN query_cache c ON c.cache_key = j.result_cache_key
            WHERE j.execution_mode = 'byok' AND (
              c.cache_scope <> 'private' OR c.owner_id <> j.user_id OR c.namespace NOT LIKE 'byok-%'
            )) AS shared_cache_violation_count,
         (SELECT COUNT(*) FROM byok_cost_quotes q LEFT JOIN research_jobs j
            ON j.id = q.research_job_id AND j.user_id = q.owner_id
            WHERE q.status = 'committed' AND j.id IS NULL) AS orphan_committed_quote_count,
         (SELECT COUNT(*) FROM research_jobs j WHERE j.execution_mode = 'byok'
            AND (j.status = 'complete' OR (j.status = 'failed' AND j.error IN (
              'PROVIDER_FAILED', 'PROVIDER_RESPONSE_INVALID', 'COST_LEDGER_WRITE_FAILED',
              'PRIVATE_CACHE_WRITE_FAILED'
            )))
            AND NOT EXISTS (SELECT 1 FROM pipeline_cost_events e WHERE e.research_job_id = j.id)) AS missing_cost_event_count,
         (SELECT COUNT(*) FROM pipeline_cost_events
            WHERE credential_source = 'user' AND execution_mode = 'byok' AND event_key IS NULL) AS missing_event_key_count`,
    ),
  ]);
  return {
    generatedAt: nowIso,
    window: { summaryFrom: dayAgo, reconciliationFrom: weekAgo, staleBefore },
    summary: summary.rows[0] ?? null,
    staleJobs: stale.rows,
    reconciliation: reconciliation.rows.map((row) => ({
      ...row,
      status: classifyByokReconciliation(row),
      varianceUsd: Number((Number(row.estimated_cost_usd) - Number(row.accounted_cost_usd ?? 0)).toFixed(6)),
    })),
    violations: violations.rows[0] ?? null,
  };
};

type ReconcileJobRow = {
  id: string;
  user_id: string;
  job_type: string;
  status: string;
  provider_request_state: string;
  updated_at: string;
  result_cache_key: string | null;
  payload: string | null;
};

const cacheIdentityForJob = async (job: ReconcileJobRow) => {
  const direct = new Map<string, { namespace: string; cacheKey: string }>([
    ["semantic_filter", { namespace: "byok-semantic-filter", cacheKey: `byok-semantic-filter:v1:${job.id}` }],
    ["trends", { namespace: "byok-trends", cacheKey: `byok-trends:v1:${job.id}` }],
    ["serp", { namespace: "byok-serp", cacheKey: `byok-serp:v1:${job.id}` }],
    ["expand", { namespace: "byok-expand", cacheKey: `byok-expand:v1:${job.id}` }],
    ["compare", { namespace: "byok-compare", cacheKey: `byok-compare:v1:${job.id}` }],
  ]);
  const identity = direct.get(job.job_type);
  if (identity) return identity;
  if (job.job_type !== "compare_intent") return reconciliationFail("UNSUPPORTED_JOB_TYPE");
  let baseJobId = "";
  try {
    const payload = JSON.parse(job.payload ?? "{}") as { request?: { baseJobId?: unknown } };
    baseJobId = typeof payload.request?.baseJobId === "string" ? payload.request.baseJobId : "";
  } catch {
    return reconciliationFail("PERSISTENCE_ERROR");
  }
  if (!baseJobId) return reconciliationFail("PERSISTENCE_ERROR");
  const base = await d1Query<{ result_cache_key: string | null }>(
    `SELECT result_cache_key FROM research_jobs
     WHERE id = ? AND user_id = ? AND job_type = 'compare' AND execution_mode = 'byok'
     LIMIT 1`,
    [baseJobId, job.user_id],
  );
  const cacheKey = base.rows[0]?.result_cache_key;
  if (!cacheKey) return reconciliationFail("PRIVATE_CACHE_NOT_FOUND");
  return { namespace: "byok-compare", cacheKey };
};

export const reconcileStaleByokJob = async (input: Readonly<{
  actorId: string;
  ownerId: string;
  jobId: string;
  expectedUpdatedAt: string;
  action: ByokReconciliationAction;
  now?: Date;
}>) => {
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const loaded = await d1Query<ReconcileJobRow>(
    `SELECT id, user_id, job_type, status, provider_request_state, updated_at,
            result_cache_key, payload
     FROM research_jobs
     WHERE id = ? AND user_id = ? AND execution_mode = 'byok'
       AND credential_source = 'user' LIMIT 1`,
    [input.jobId, input.ownerId],
  ).catch(() => reconciliationFail("PERSISTENCE_ERROR"));
  const job = loaded.rows[0];
  if (!job) return reconciliationFail("JOB_NOT_FOUND");
  if (job.updated_at !== input.expectedUpdatedAt || job.status !== "processing"
    || job.provider_request_state !== "started") return reconciliationFail("JOB_STATE_CONFLICT");
  if (job.updated_at >= staleBefore) return reconciliationFail("JOB_NOT_STALE");

  const nowIso = now.toISOString();
  const auditId = crypto.randomUUID();
  if (input.action === "mark_uncertain") {
    const [updated] = await d1Batch([
      {
        sql: `UPDATE research_jobs
              SET status = 'failed', provider_request_state = 'failed',
                  error = 'PROVIDER_OUTCOME_UNCERTAIN', claim_token = NULL,
                  lease_expires_at = NULL, updated_at = ?
              WHERE id = ? AND user_id = ? AND status = 'processing'
                AND provider_request_state = 'started' AND updated_at = ?
                AND execution_mode = 'byok' AND credential_source = 'user'`,
        params: [nowIso, job.id, job.user_id, input.expectedUpdatedAt],
      },
      {
        sql: `INSERT INTO byok_reconciliation_audit_events (
                id, actor_id, owner_id, research_job_id, action,
                previous_updated_at, resulting_status, created_at
              )
              SELECT ?, ?, ?, ?, 'mark_uncertain', ?, 'failed', ?
              WHERE changes() = 1`,
        params: [auditId, input.actorId, job.user_id, job.id, input.expectedUpdatedAt, nowIso],
      },
    ]).catch(() => reconciliationFail("PERSISTENCE_ERROR"));
    if ((updated?.meta?.changes ?? 0) !== 1) return reconciliationFail("JOB_STATE_CONFLICT");
    return { jobId: job.id, ownerId: job.user_id, action: input.action, status: "failed" as const };
  }

  const identity = await cacheIdentityForJob(job);
  const cache = await d1Query<{ id: string }>(
    `SELECT id FROM query_cache
     WHERE cache_key = ? AND namespace = ? AND cache_scope = 'private'
       AND owner_id = ? AND (expires_at IS NULL OR expires_at > ?)
     LIMIT 1`,
    [identity.cacheKey, identity.namespace, job.user_id, nowIso],
  ).catch(() => reconciliationFail("PERSISTENCE_ERROR"));
  if (!cache.rows[0]) return reconciliationFail("PRIVATE_CACHE_NOT_FOUND");
  const evidence = await d1Query<{ event_count: number }>(
    `SELECT COUNT(*) AS event_count FROM pipeline_cost_events
     WHERE research_job_id = ? AND owner_id = ?
       AND credential_source = 'user' AND execution_mode = 'byok'
       AND event_key IS NOT NULL`,
    [job.id, job.user_id],
  ).catch(() => reconciliationFail("PERSISTENCE_ERROR"));
  if (Number(evidence.rows[0]?.event_count ?? 0) < 1) {
    return reconciliationFail("COST_EVIDENCE_NOT_FOUND");
  }
  const [updated] = await d1Batch([
    {
      sql: `UPDATE research_jobs
            SET status = 'complete', provider_request_state = 'completed',
                result_cache_key = ?, error = NULL, claim_token = NULL,
                lease_expires_at = NULL, updated_at = ?
            WHERE id = ? AND user_id = ? AND status = 'processing'
              AND provider_request_state = 'started' AND updated_at = ?
              AND execution_mode = 'byok' AND credential_source = 'user'`,
      params: [identity.cacheKey, nowIso, job.id, job.user_id, input.expectedUpdatedAt],
    },
    {
      sql: `INSERT INTO byok_reconciliation_audit_events (
              id, actor_id, owner_id, research_job_id, action,
              previous_updated_at, resulting_status, created_at
            )
            SELECT ?, ?, ?, ?, 'complete_from_private_cache', ?, 'complete', ?
            WHERE changes() = 1`,
      params: [auditId, input.actorId, job.user_id, job.id, input.expectedUpdatedAt, nowIso],
    },
  ]).catch(() => reconciliationFail("PERSISTENCE_ERROR"));
  if ((updated?.meta?.changes ?? 0) !== 1) return reconciliationFail("JOB_STATE_CONFLICT");
  return { jobId: job.id, ownerId: job.user_id, action: input.action, status: "complete" as const };
};
