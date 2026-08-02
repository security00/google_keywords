import "server-only";

import { createHash, randomUUID } from "crypto";

import { getCached, setCache } from "@/lib/cache";
import { d1Batch, d1Query } from "@/lib/d1";
import {
  BYOK_COMPARE_DATAFORSEO_ESTIMATE_USD,
  BYOK_COMPARE_ESTIMATED_COST_USD,
  executeByokCompare,
  executeByokCompareIntentRetry,
  getOwnedByokCompareResult,
  quoteByokCompare,
  quoteByokCompareIntentRetry,
  type ByokCompareData,
} from "@/lib/byok/compare";
import {
  executeByokExpand,
  getOwnedByokExpandResult,
  quoteByokExpand,
} from "@/lib/byok/expand";
import {
  BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD,
  executeByokSemanticFilter,
  getOwnedByokSemanticFilterResult,
} from "@/lib/byok/semantic-filter";
import { getByokSpendControls } from "@/lib/byok/spend-controls";
import { loadPipelineConnections } from "@/lib/byok/pipeline-access";
import { summarizeResults } from "@/lib/compare";
import { flattenOrganizedCandidates, organizeCandidates } from "@/lib/expand";
import { loadProviderCredentialDecryptionKeys } from "@/lib/provider-connections/keyring";
import type { Candidate, CompareResponse, ExpandResponse } from "@/lib/types";

const QUOTE_TTL_MS = 10 * 60 * 1000;
const MAX_SEEDS = 20;
const MAX_COMPARE_KEYWORDS = 50;
const COMPARE_CHUNK_SIZE = 4;
const SEMANTIC_CHUNK_SIZE = 20;
const MAX_CANDIDATES_PER_SEED = 100;

export type PipelineOperation = "expand" | "compare";
type PipelineStatus = "processing" | "complete" | "partial" | "failed";

export type PipelineExpandInput = Readonly<{
  keywords: readonly string[];
  days?: number;
  dateFrom?: string;
  dateTo?: string;
  filterTerms?: readonly string[];
  filterPrompt?: string;
}>;
export type PipelineCompareInput = Readonly<{
  keywords: readonly string[];
  benchmark: string;
  days?: number;
  dateFrom?: string;
  dateTo?: string;
}>;

type ExpandChildQuote = Readonly<{
  kind: "expand";
  seed: string;
  quoteId: string;
  request: { keyword: string; dateFrom: string; dateTo: string };
  requestHash: string;
  estimatedCostUsd: number;
  connectionVersion: number;
  chargeable?: boolean;
  retryAttempt?: string;
  checkpointJobId?: string;
}>;
type CompareChildQuote = Readonly<{
  kind: "compare";
  index: number;
  quoteId: string;
  request: { keywords: string[]; benchmark: string; dateFrom: string; dateTo: string };
  requestHash: string;
  estimatedCostUsd: number;
  dataForSeoConnectionVersion: number;
  openRouterConnectionVersion: number;
  chargeable?: boolean;
  retryAttempt?: string;
  checkpointJobId?: string;
}>;
type CompareIntentChildQuote = Readonly<{
  kind: "compare-intent";
  index: number;
  quoteId: string;
  request: { baseJobId: string; retryToken: string };
  requestHash: string;
  estimatedCostUsd: number;
  openRouterConnectionVersion: number;
  chargeable?: boolean;
  checkpointJobId?: string;
}>;
type ChildQuote = ExpandChildQuote | CompareChildQuote | CompareIntentChildQuote;

type PipelineQuoteRow = {
  quote_id: string;
  owner_id: string;
  operation: PipelineOperation;
  request_hash: string;
  idempotency_key: string;
  request_json: string;
  child_quotes_json: string;
  estimated_cost_micro_usd: number;
  status: "quoted" | "executing" | "complete" | "partial" | "failed";
  expires_at: string;
  parent_job_id: string | null;
  retry_of_job_id: string | null;
  created_at: string;
  updated_at: string;
};
type PipelineRunRow = {
  job_id: string;
  owner_id: string;
  operation: PipelineOperation;
  quote_id: string;
  request_hash: string;
  execute_idempotency_key: string;
  execute_request_hash: string;
  status: PipelineStatus;
  total_steps: number;
  completed_steps: number;
  result_cache_key: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  retry_of_job_id?: string | null;
};
type PipelineStepRow = {
  parent_job_id: string;
  step_key: string;
  stage: string;
  status: "pending" | "processing" | "complete" | "failed";
  child_job_id: string | null;
  error_code: string | null;
};

export class ByokPipelineError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.name = "ByokPipelineError";
    this.code = code;
    this.status = status;
  }
}
const fail = (code: string, status = 400): never => {
  throw new ByokPipelineError(code, status);
};

const normalizeTerms = (values: readonly string[], max: number) => {
  if (!Array.isArray(values)) return fail("INVALID_REQUEST");
  const unique = new Map<string, string>();
  for (const raw of values) {
    if (typeof raw !== "string") return fail("INVALID_REQUEST");
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value || value.length > 120) return fail("INVALID_REQUEST");
    const key = value.toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, value);
  }
  const result = [...unique.values()];
  if (!result.length || result.length > max) return fail("INVALID_REQUEST");
  return result;
};
const stableHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const usd = (micro: number) => Number((Number(micro) / 1_000_000).toFixed(6));
const normalizeDateRange = (input: Readonly<{ days?: number; dateFrom?: string; dateTo?: string }>) => {
  if (input.dateFrom !== undefined || input.dateTo !== undefined) {
    if (input.days !== undefined || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom ?? "")
      || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateTo ?? "")) return fail("INVALID_REQUEST");
    const from = Date.parse(`${input.dateFrom}T00:00:00.000Z`);
    const to = Date.parse(`${input.dateTo}T00:00:00.000Z`);
    const days = Math.round((to - from) / 86_400_000);
    if (!Number.isFinite(from) || !Number.isFinite(to) || days < 7 || days > 1825) {
      return fail("INVALID_REQUEST");
    }
    return { dateFrom: input.dateFrom!, dateTo: input.dateTo! };
  }
  const days = input.days ?? 90;
  if (!Number.isInteger(days) || days < 7 || days > 1825) return fail("INVALID_REQUEST");
  return { days };
};
const quotePublic = (row: PipelineQuoteRow) => {
  const children = JSON.parse(row.child_quotes_json) as ChildQuote[];
  const total = usd(row.estimated_cost_micro_usd);
  const chargeable = children.filter((child) => child.chargeable !== false);
  const dataForSeo = row.operation === "expand"
    ? Number(chargeable.reduce((sum, child) => sum + (child.kind === "expand" ? child.estimatedCostUsd : 0), 0).toFixed(6))
    : Number(chargeable.reduce((sum, child) => sum
      + (child.kind === "compare" ? BYOK_COMPARE_DATAFORSEO_ESTIMATE_USD : 0), 0).toFixed(6));
  const openRouter = row.operation === "expand"
    ? Number(Math.max(0, total - dataForSeo).toFixed(6))
    : Number(Math.max(0, total - dataForSeo).toFixed(6));
  return {
    quoteId: row.quote_id,
    operation: row.operation,
    estimatedCostUsd: total,
    expiresAt: row.expires_at,
    requestHash: row.request_hash,
    batchCount: row.operation === "expand"
      ? chargeable.length + Math.ceil(openRouter / BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD)
      : chargeable.length,
    costSummary: {
      providers: { dataforseo: dataForSeo, openrouter: openRouter },
      stages: row.operation === "expand"
        ? { expand: dataForSeo, semanticFilter: openRouter }
        : { compare: total },
    },
  };
};

const loadQuote = async (ownerId: string, quoteId: string) => {
  const { rows } = await d1Query<PipelineQuoteRow>(
    `SELECT * FROM byok_pipeline_quotes WHERE quote_id = ? AND owner_id = ? LIMIT 1`,
    [quoteId, ownerId],
  );
  return rows[0] ?? null;
};

const saveQuote = async (input: Readonly<{
  ownerId: string;
  operation: PipelineOperation;
  idempotencyKey: string;
  request: PipelineExpandInput | PipelineCompareInput;
  children: readonly ChildQuote[];
  estimatedCostUsd: number;
  retryOfJobId?: string;
}>) => {
  const requestHash = stableHash({
    operation: input.operation,
    request: input.request,
    ...(input.retryOfJobId ? { retryOfJobId: input.retryOfJobId } : {}),
  });
  const now = new Date();
  const nowIso = now.toISOString();
  const quoteId = randomUUID();
  await d1Query(
    `INSERT OR IGNORE INTO byok_pipeline_quotes
     (quote_id, owner_id, operation, request_hash, idempotency_key, request_json,
      child_quotes_json, estimated_cost_micro_usd, status, expires_at,
      parent_job_id, retry_of_job_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'quoted', ?, NULL, ?, ?, ?)`,
    [
      quoteId, input.ownerId, input.operation, requestHash, input.idempotencyKey,
      JSON.stringify(input.request), JSON.stringify(input.children),
      Math.round(input.estimatedCostUsd * 1_000_000),
      new Date(now.getTime() + QUOTE_TTL_MS).toISOString(), input.retryOfJobId ?? null, nowIso, nowIso,
    ],
  );
  const { rows } = await d1Query<PipelineQuoteRow>(
    `SELECT * FROM byok_pipeline_quotes
     WHERE owner_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1`,
    [input.ownerId, input.operation, input.idempotencyKey],
  );
  const row = rows[0];
  if (!row) return fail("PERSISTENCE_ERROR", 503);
  if (row.request_hash !== requestHash) return fail("IDEMPOTENCY_CONFLICT", 409);
  return quotePublic(row);
};

export const quotePipelineExpand = async (
  ownerId: string,
  idempotencyKey: string,
  input: PipelineExpandInput,
) => {
  const connections = await loadPipelineConnections(ownerId);
  const keywords = normalizeTerms(input.keywords, MAX_SEEDS);
  if (input.filterTerms !== undefined && !Array.isArray(input.filterTerms)) return fail("INVALID_REQUEST");
  if (input.filterTerms?.some((term) => typeof term !== "string")) return fail("INVALID_REQUEST");
  const range = normalizeDateRange(input);
  if (input.filterPrompt !== undefined && typeof input.filterPrompt !== "string") return fail("INVALID_REQUEST");
  const filterTerms = (input.filterTerms ?? []).map((term) => String(term).trim()).filter(Boolean).slice(0, 100);
  const request = { keywords, ...range, filterTerms, filterPrompt: String(input.filterPrompt ?? "").slice(0, 1000) };
  const children: ExpandChildQuote[] = [];
  for (let index = 0; index < keywords.length; index += 1) {
    const quoted = await quoteByokExpand({
      ownerId,
      connectionId: connections.dataforseo.connectionId,
      expectedConnectionVersion: connections.dataforseo.credentialVersion,
      clientRequestId: `pipe-expand-${idempotencyKey}-${index}`,
      keyword: keywords[index],
      ...range,
    });
    children.push({
      kind: "expand", seed: keywords[index], quoteId: quoted.quote.quoteId,
      request: quoted.request, requestHash: quoted.requestHash,
      estimatedCostUsd: quoted.quote.estimatedCostUsd,
      connectionVersion: connections.dataforseo.credentialVersion,
    });
  }
  const maxSemanticChunks = Math.ceil((keywords.length * MAX_CANDIDATES_PER_SEED) / SEMANTIC_CHUNK_SIZE);
  const estimate = children.reduce((sum, child) => sum + child.estimatedCostUsd, 0)
    + maxSemanticChunks * BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD;
  return saveQuote({ ownerId, operation: "expand", idempotencyKey, request, children, estimatedCostUsd: estimate });
};

export const quotePipelineCompare = async (
  ownerId: string,
  idempotencyKey: string,
  input: PipelineCompareInput,
) => {
  const connections = await loadPipelineConnections(ownerId);
  const keywords = normalizeTerms(input.keywords, MAX_COMPARE_KEYWORDS);
  const range = normalizeDateRange(input);
  const benchmark = normalizeTerms([input.benchmark], 1)[0];
  const request = { keywords, benchmark, ...range };
  const children: CompareChildQuote[] = [];
  for (let index = 0; index < keywords.length; index += COMPARE_CHUNK_SIZE) {
    const chunk = keywords.slice(index, index + COMPARE_CHUNK_SIZE);
    const quoted = await quoteByokCompare({
      ownerId,
      dataForSeoConnectionId: connections.dataforseo.connectionId,
      dataForSeoConnectionVersion: connections.dataforseo.credentialVersion,
      openRouterConnectionId: connections.openrouter.connectionId,
      openRouterConnectionVersion: connections.openrouter.credentialVersion,
      clientRequestId: `pipe-compare-${idempotencyKey}-${index / COMPARE_CHUNK_SIZE}`,
      keywords: chunk,
      benchmark,
      ...range,
    });
    children.push({
      kind: "compare", index: index / COMPARE_CHUNK_SIZE, quoteId: quoted.quote.quoteId,
      request: { ...quoted.request, keywords: [...quoted.request.keywords] },
      requestHash: quoted.requestHash, estimatedCostUsd: quoted.quote.estimatedCostUsd,
      dataForSeoConnectionVersion: connections.dataforseo.credentialVersion,
      openRouterConnectionVersion: connections.openrouter.credentialVersion,
    });
  }
  return saveQuote({
    ownerId, operation: "compare", idempotencyKey, request, children,
    estimatedCostUsd: children.length * BYOK_COMPARE_ESTIMATED_COST_USD,
  });
};

const retryToken = (idempotencyKey: string, stepKey: string) =>
  `retry-${stableHash({ idempotencyKey, stepKey }).slice(0, 32)}`;

export const quotePipelineRetry = async (
  ownerId: string,
  parentJobId: string,
  idempotencyKey: string,
) => {
  const { rows: runs } = await d1Query<PipelineRunRow>(
    `SELECT * FROM byok_pipeline_runs WHERE job_id = ? AND owner_id = ? LIMIT 1`,
    [parentJobId, ownerId],
  );
  const run = runs[0];
  if (!run) return fail("JOB_NOT_FOUND", 404);
  if (run.status !== "partial") return fail("JOB_NOT_RETRYABLE", 409);
  const sourceQuote = await loadQuote(ownerId, run.quote_id);
  if (!sourceQuote) return fail("QUOTE_NOT_FOUND", 404);
  const { rows: sourceSteps } = await d1Query<PipelineStepRow>(
    `SELECT parent_job_id, step_key, stage, status, child_job_id, error_code
     FROM byok_pipeline_steps WHERE parent_job_id = ?
     ORDER BY step_key`,
    [parentJobId],
  );
  const failedSteps = sourceSteps.filter((step) => step.status === "failed");
  if (!failedSteps.length) return fail("NO_RETRYABLE_STEPS", 409);

  const connections = await loadPipelineConnections(ownerId);
  const sourceChildren = JSON.parse(sourceQuote.child_quotes_json) as ChildQuote[];
  const sourceStepByKey = new Map(sourceSteps.map((step) => [step.step_key, step]));
  const children: ChildQuote[] = sourceChildren.map((child, index) => {
    const stage = child.kind === "expand" ? "expand" : "compare";
    const checkpoint = sourceStepByKey.get(`${stage}:${index}`);
    return {
      ...child,
      chargeable: false,
      ...(checkpoint?.status === "complete" && checkpoint.child_job_id
        ? { checkpointJobId: checkpoint.child_job_id }
        : {}),
    };
  });
  let semanticRetryCost = 0;
  let replacementCost = 0;

  for (const step of failedSteps) {
    if (step.stage === "semantic_filter") {
      semanticRetryCost += BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD;
      continue;
    }
    const index = Number(step.step_key.split(":").at(-1));
    if (!Number.isInteger(index) || index < 0 || index >= children.length) continue;
    const source = sourceChildren[index];
    const attempt = retryToken(idempotencyKey, step.step_key);
    if (source.kind === "expand") {
      const quoted = await quoteByokExpand({
        ownerId,
        connectionId: connections.dataforseo.connectionId,
        expectedConnectionVersion: connections.dataforseo.credentialVersion,
        clientRequestId: attempt,
        keyword: source.request.keyword,
        dateFrom: source.request.dateFrom,
        dateTo: source.request.dateTo,
        retryAttempt: attempt,
      });
      children[index] = {
        kind: "expand", seed: source.seed, quoteId: quoted.quote.quoteId,
        request: quoted.request, requestHash: quoted.requestHash,
        estimatedCostUsd: quoted.quote.estimatedCostUsd, chargeable: true,
        connectionVersion: connections.dataforseo.credentialVersion,
        retryAttempt: attempt,
      };
      replacementCost += quoted.quote.estimatedCostUsd;
      // A retried seed can add up to 100 new candidates requiring semantic filtering.
      semanticRetryCost += 5 * BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD;
      continue;
    }
    if (source.kind === "compare-intent" || step.error_code === "PARTIAL_INTENT") {
      const baseJobId = source.kind === "compare-intent"
        ? source.request.baseJobId
        : step.child_job_id;
      if (!baseJobId) continue;
      const quoted = await quoteByokCompareIntentRetry({
        ownerId,
        baseJobId,
        openRouterConnectionId: connections.openrouter.connectionId,
        openRouterConnectionVersion: connections.openrouter.credentialVersion,
        clientRequestId: attempt,
      });
      children[index] = {
        kind: "compare-intent", index, quoteId: quoted.quote.quoteId,
        request: quoted.request, requestHash: quoted.requestHash,
        estimatedCostUsd: quoted.quote.estimatedCostUsd, chargeable: true,
        openRouterConnectionVersion: connections.openrouter.credentialVersion,
      };
      replacementCost += quoted.quote.estimatedCostUsd;
      continue;
    }
    if (source.kind === "compare") {
      const quoted = await quoteByokCompare({
        ownerId,
        dataForSeoConnectionId: connections.dataforseo.connectionId,
        dataForSeoConnectionVersion: connections.dataforseo.credentialVersion,
        openRouterConnectionId: connections.openrouter.connectionId,
        openRouterConnectionVersion: connections.openrouter.credentialVersion,
        clientRequestId: attempt,
        keywords: source.request.keywords,
        benchmark: source.request.benchmark,
        dateFrom: source.request.dateFrom,
        dateTo: source.request.dateTo,
        retryAttempt: attempt,
      });
      children[index] = {
        kind: "compare", index, quoteId: quoted.quote.quoteId,
        request: { ...quoted.request, keywords: [...quoted.request.keywords] },
        requestHash: quoted.requestHash,
        estimatedCostUsd: quoted.quote.estimatedCostUsd, chargeable: true,
        dataForSeoConnectionVersion: connections.dataforseo.credentialVersion,
        openRouterConnectionVersion: connections.openrouter.credentialVersion,
        retryAttempt: attempt,
      };
      replacementCost += quoted.quote.estimatedCostUsd;
    }
  }
  const estimatedCostUsd = Number((replacementCost + semanticRetryCost).toFixed(6));
  if (estimatedCostUsd <= 0) return fail("NO_RETRYABLE_STEPS", 409);
  return saveQuote({
    ownerId,
    operation: run.operation,
    idempotencyKey,
    request: JSON.parse(sourceQuote.request_json) as PipelineExpandInput | PipelineCompareInput,
    children,
    estimatedCostUsd,
    retryOfJobId: parentJobId,
  });
};

const preflightAggregateSpend = async (ownerId: string, amount: number) => {
  const [controls, usage] = await Promise.all([
    getByokSpendControls(ownerId),
    d1Query<{ spent: number; active: number }>(
      `SELECT
        (SELECT COALESCE(SUM(estimated_cost_micro_usd), 0) / 1000000.0
         FROM byok_cost_quotes WHERE owner_id = ?
          AND updated_at >= datetime('now', 'start of day')
          AND status IN ('reserved', 'committed')) AS spent,
        ((SELECT COUNT(*) FROM byok_pipeline_runs
          WHERE owner_id = ? AND status = 'processing')
         + (SELECT COUNT(*) FROM research_jobs
          WHERE user_id = ? AND execution_mode = 'byok'
            AND status IN ('pending', 'processing'))) AS active`,
      [ownerId, ownerId, ownerId],
    ),
  ]);
  const current = usage.rows[0] ?? { spent: 0, active: 0 };
  if (Number(current.active) >= controls.maxConcurrentJobs) return fail("CONCURRENCY_LIMIT_REACHED", 409);
  if (Number(current.spent) + amount > controls.dailyBudgetUsd + 0.000001) {
    return fail("DAILY_BUDGET_EXCEEDED", 409);
  }
};

export const startPipelineExecution = async (input: Readonly<{
  ownerId: string;
  operation: PipelineOperation;
  quoteId: string;
  requestHash: string;
  confirmedEstimatedCostUsd: number;
  executeIdempotencyKey: string;
}>) => {
  const executeRequestHash = stableHash({
    quoteId: input.quoteId,
    requestHash: input.requestHash,
    confirmedEstimatedCostUsd: input.confirmedEstimatedCostUsd,
  });
  const existingByKey = await d1Query<PipelineRunRow>(
    `SELECT * FROM byok_pipeline_runs
     WHERE owner_id = ? AND operation = ? AND execute_idempotency_key = ? LIMIT 1`,
    [input.ownerId, input.operation, input.executeIdempotencyKey],
  );
  if (existingByKey.rows[0]) {
    if (existingByKey.rows[0].execute_request_hash !== executeRequestHash) {
      return fail("IDEMPOTENCY_CONFLICT", 409);
    }
    return getPipelineJob(input.ownerId, existingByKey.rows[0].job_id, false);
  }
  const quote = await loadQuote(input.ownerId, input.quoteId);
  if (!quote || quote.operation !== input.operation) return fail("QUOTE_NOT_FOUND", 404);
  if (quote.request_hash !== input.requestHash
    || Math.round(input.confirmedEstimatedCostUsd * 1_000_000) !== Number(quote.estimated_cost_micro_usd)) {
    return fail("COST_CONFIRMATION_MISMATCH", 409);
  }
  if (quote.expires_at <= new Date().toISOString()) return fail("QUOTE_EXPIRED", 409);
  if (quote.parent_job_id) return getPipelineJob(input.ownerId, quote.parent_job_id, false);
  await preflightAggregateSpend(input.ownerId, input.confirmedEstimatedCostUsd);
  const jobId = randomUUID();
  const children = JSON.parse(quote.child_quotes_json) as ChildQuote[];
  const now = new Date().toISOString();
  await d1Batch([
    {
      sql: `UPDATE byok_pipeline_quotes SET status = 'executing', parent_job_id = ?, updated_at = ?
            WHERE quote_id = ? AND owner_id = ? AND status = 'quoted' AND parent_job_id IS NULL`,
      params: [jobId, now, quote.quote_id, input.ownerId],
    },
    {
      sql: `INSERT INTO byok_pipeline_runs
            (job_id, owner_id, operation, quote_id, request_hash,
             execute_idempotency_key, execute_request_hash, status, total_steps,
             completed_steps, result_cache_key, error_code, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, 'processing', ?, 0, NULL, NULL, ?, ?
            FROM byok_pipeline_quotes
            WHERE quote_id = ? AND owner_id = ? AND parent_job_id = ?`,
      params: [
        jobId, input.ownerId, input.operation, quote.quote_id, quote.request_hash,
        input.executeIdempotencyKey, executeRequestHash, children.length, now, now,
        quote.quote_id, input.ownerId, jobId,
      ],
    },
  ]);
  const current = await loadQuote(input.ownerId, input.quoteId);
  if (!current?.parent_job_id) return fail("QUOTE_ALREADY_USED", 409);
  if (current.parent_job_id !== jobId) return getPipelineJob(input.ownerId, current.parent_job_id, false);
  return getPipelineJob(input.ownerId, jobId, false);
};

const markStep = async (jobId: string, stepKey: string, stage: string, status: string, childJobId?: string, errorCode?: string) => {
  const now = new Date().toISOString();
  await d1Query(
    `INSERT INTO byok_pipeline_steps
     (parent_job_id, step_key, stage, status, child_job_id, error_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(parent_job_id, step_key) DO UPDATE SET
       status = excluded.status, child_job_id = excluded.child_job_id,
       error_code = excluded.error_code, updated_at = excluded.updated_at`,
    [jobId, stepKey, stage, status, childJobId ?? null, errorCode ?? null, now, now],
  );
  await d1Query(
    `UPDATE byok_pipeline_runs SET
       completed_steps = (SELECT COUNT(*) FROM byok_pipeline_steps
         WHERE parent_job_id = ? AND status IN ('complete', 'failed')),
       total_steps = MAX(total_steps, (SELECT COUNT(*) FROM byok_pipeline_steps WHERE parent_job_id = ?)),
       updated_at = ? WHERE job_id = ?`,
    [jobId, jobId, now, jobId],
  );
};

const finishRun = async (run: PipelineRunRow, status: Exclude<PipelineStatus, "processing">, result: ExpandResponse | CompareResponse | null, errorCode?: string) => {
  let cacheKey: string | null = null;
  if (result) {
    cacheKey = `byok-pipeline-${run.operation}:v1:${run.job_id}`;
    await setCache(cacheKey, result, {
      namespace: `byok-pipeline-${run.operation}`,
      scope: { type: "private", ownerId: run.owner_id },
      ttlHours: 24,
      allowLegacyRead: false,
    });
  }
  const now = new Date().toISOString();
  await d1Query(
    `UPDATE byok_pipeline_runs SET status = ?, result_cache_key = ?, error_code = ?, updated_at = ?
     WHERE job_id = ? AND owner_id = ?`,
    [status, cacheKey, errorCode ?? null, now, run.job_id, run.owner_id],
  );
  await d1Query(
    `UPDATE byok_pipeline_quotes SET status = ?, updated_at = ? WHERE quote_id = ? AND owner_id = ?`,
    [status, now, run.quote_id, run.owner_id],
  );
};

const loadCompletedSemanticDecisions = async (ownerId: string, parentJobId: string | null) => {
  const decisions = new Map<string, "keep" | "block">();
  if (!parentJobId) return decisions;
  const { rows } = await d1Query<PipelineStepRow>(
    `SELECT parent_job_id, step_key, stage, status, child_job_id, error_code
     FROM byok_pipeline_steps
     WHERE parent_job_id = ? AND stage = 'semantic_filter'
       AND status = 'complete' AND child_job_id IS NOT NULL`,
    [parentJobId],
  );
  for (const step of rows) {
    const checkpoint = await getOwnedByokSemanticFilterResult(ownerId, step.child_job_id!);
    if (checkpoint.status !== "complete" || !checkpoint.results) {
      return fail("CHECKPOINT_UNAVAILABLE", 409);
    }
    for (const decision of checkpoint.results) {
      decisions.set(decision.keyword.toLocaleLowerCase("en-US"), decision.decision);
    }
  }
  return decisions;
};

const runExpand = async (run: PipelineRunRow, quote: PipelineQuoteRow) => {
  const connections = await loadPipelineConnections(run.owner_id);
  const keys = await loadProviderCredentialDecryptionKeys();
  const children = JSON.parse(quote.child_quotes_json) as ExpandChildQuote[];
  const request = JSON.parse(quote.request_json) as Required<Pick<PipelineExpandInput, "keywords">> & PipelineExpandInput;
  const collected: Candidate[] = [];
  let failed = 0;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const stepKey = `expand:${index}`;
    await markStep(run.job_id, stepKey, "expand", "processing");
    try {
      const result = child.checkpointJobId
        ? await getOwnedByokExpandResult(run.owner_id, child.checkpointJobId)
        : await executeByokExpand({
        ownerId: run.owner_id,
        connectionId: connections.dataforseo.connectionId,
        expectedConnectionVersion: child.connectionVersion,
        request: child.request,
        quoteId: child.quoteId,
        requestHash: child.requestHash,
        confirmedEstimatedCostUsd: child.estimatedCostUsd,
        confirmation: "CONFIRM",
        decryptionKeys: keys,
          retryAttempt: child.retryAttempt,
        });
      if (result.status !== "complete" || !result.data) {
        throw new Error(result.errorCode ?? "PROVIDER_FAILED");
      }
      collected.push(...(result.data?.candidates ?? []));
      await markStep(run.job_id, stepKey, "expand", "complete", result.jobId);
    } catch (error) {
      failed += 1;
      await markStep(run.job_id, stepKey, "expand", "failed", undefined, error instanceof Error ? error.message : "PROVIDER_FAILED");
    }
  }
  if (!collected.length && failed > 0) {
    return finishRun(run, "failed", null, "PROVIDER_FAILED");
  }
  const filterTerms = new Set((request.filterTerms ?? []).map((term) => term.toLocaleLowerCase("en-US")));
  const unique = new Map<string, Candidate>();
  for (const candidate of collected) {
    const key = candidate.keyword.toLocaleLowerCase("en-US");
    if ([...filterTerms].some((term) => term && key.includes(term))) continue;
    const current = unique.get(key);
    if (!current || candidate.value > current.value) unique.set(key, candidate);
  }
  const candidates = [...unique.values()];
  const priorDecisions = await loadCompletedSemanticDecisions(run.owner_id, quote.retry_of_job_id);
  const kept = new Set<string>(
    [...priorDecisions.entries()].filter(([, decision]) => decision === "keep").map(([keyword]) => keyword),
  );
  const undecided = candidates.filter(
    (candidate) => !priorDecisions.has(candidate.keyword.toLocaleLowerCase("en-US")),
  );
  for (let index = 0; index < undecided.length; index += SEMANTIC_CHUNK_SIZE) {
    const chunk = undecided.slice(index, index + SEMANTIC_CHUNK_SIZE);
    const stepKey = `semantic:${index / SEMANTIC_CHUNK_SIZE}`;
    await markStep(run.job_id, stepKey, "semantic_filter", "processing");
    try {
      const result = await executeByokSemanticFilter({
        ownerId: run.owner_id,
        connectionId: connections.openrouter.connectionId,
        expectedConnectionVersion: connections.openrouter.credentialVersion,
        keywords: chunk.map((candidate) => candidate.keyword),
        filterPrompt: request.filterPrompt,
        decryptionKeys: keys,
        retryAttempt: quote.retry_of_job_id ? quote.quote_id : undefined,
      });
      if (result.status !== "complete" || !result.results) {
        throw new Error(result.errorCode ?? "PROVIDER_FAILED");
      }
      for (const decision of result.results ?? []) {
        if (decision.decision === "keep") kept.add(decision.keyword.toLocaleLowerCase("en-US"));
      }
      await markStep(run.job_id, stepKey, "semantic_filter", "complete", result.jobId);
    } catch (error) {
      failed += 1;
      chunk.forEach((candidate) => kept.add(candidate.keyword.toLocaleLowerCase("en-US")));
      await markStep(run.job_id, stepKey, "semantic_filter", "failed", undefined, error instanceof Error ? error.message : "PROVIDER_FAILED");
    }
  }
  const filtered = candidates.filter((candidate) => kept.has(candidate.keyword.toLocaleLowerCase("en-US")));
  const organized = organizeCandidates(filtered);
  const result: ExpandResponse = {
    keywords: [...request.keywords],
    dateFrom: children[0]?.request.dateFrom ?? "",
    dateTo: children[0]?.request.dateTo ?? "",
    candidates: filtered,
    organized,
    flatList: flattenOrganizedCandidates(organized),
    fromCache: false,
    filter: { enabled: true, total: candidates.length, removed: candidates.length - filtered.length, kept: filtered.length },
    filteredOut: candidates.filter((candidate) => !kept.has(candidate.keyword.toLocaleLowerCase("en-US"))),
  };
  await finishRun(run, failed ? "partial" : "complete", result, failed ? "PARTIAL_SUCCESS" : undefined);
};

const runCompare = async (run: PipelineRunRow, quote: PipelineQuoteRow) => {
  const connections = await loadPipelineConnections(run.owner_id);
  const keys = await loadProviderCredentialDecryptionKeys();
  const children = JSON.parse(quote.child_quotes_json) as Array<CompareChildQuote | CompareIntentChildQuote>;
  const results: CompareResponse["results"] = [];
  let failed = 0;
  let partial = 0;
  let resultDateFrom = "";
  let resultDateTo = "";
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const stepKey = `compare:${index}`;
    await markStep(run.job_id, stepKey, "compare", "processing");
    try {
      const response = child.checkpointJobId
        ? await getOwnedByokCompareResult(run.owner_id, child.checkpointJobId)
        : child.kind === "compare-intent"
        ? await executeByokCompareIntentRetry({
          ownerId: run.owner_id,
          openRouterConnectionId: connections.openrouter.connectionId,
          openRouterConnectionVersion: child.openRouterConnectionVersion,
          request: child.request,
          quoteId: child.quoteId,
          requestHash: child.requestHash,
          confirmedEstimatedCostUsd: child.estimatedCostUsd,
          confirmation: "CONFIRM",
          decryptionKeys: keys,
        })
        : await executeByokCompare({
          ownerId: run.owner_id,
          dataForSeoConnectionId: connections.dataforseo.connectionId,
          dataForSeoConnectionVersion: child.dataForSeoConnectionVersion,
          openRouterConnectionId: connections.openrouter.connectionId,
          openRouterConnectionVersion: child.openRouterConnectionVersion,
          request: child.request,
          quoteId: child.quoteId,
          requestHash: child.requestHash,
          confirmedEstimatedCostUsd: child.estimatedCostUsd,
          confirmation: "CONFIRM",
          decryptionKeys: keys,
          retryAttempt: child.retryAttempt,
        });
      if (response.status !== "complete" || !response.data) {
        throw new Error(response.errorCode ?? "PROVIDER_FAILED");
      }
      const data = response.data as ByokCompareData | undefined;
      results.push(...(data?.comparison.results ?? []));
      resultDateFrom ||= data?.comparison.dateFrom ?? "";
      resultDateTo ||= data?.comparison.dateTo ?? "";
      if (data?.partialSuccess) {
        partial += 1;
        await markStep(run.job_id, stepKey, "compare", "failed", response.jobId, "PARTIAL_INTENT");
      } else {
        await markStep(run.job_id, stepKey, "compare", "complete", response.jobId);
      }
    } catch (error) {
      failed += 1;
      await markStep(run.job_id, stepKey, "compare", "failed", undefined, error instanceof Error ? error.message : "PROVIDER_FAILED");
    }
  }
  const request = JSON.parse(quote.request_json) as PipelineCompareInput;
  if (!results.length) return finishRun(run, "failed", null, "PROVIDER_FAILED");
  const result: CompareResponse = {
    benchmark: request.benchmark,
    dateFrom: resultDateFrom,
    dateTo: resultDateTo,
    results,
    summary: summarizeResults(results),
  };
  const isPartial = failed > 0 || partial > 0;
  await finishRun(run, isPartial ? "partial" : "complete", result, isPartial ? "PARTIAL_SUCCESS" : undefined);
};

export const executePipelineJob = async (ownerId: string, jobId: string) => {
  const { rows } = await d1Query<PipelineRunRow>(
    `SELECT * FROM byok_pipeline_runs WHERE job_id = ? AND owner_id = ? LIMIT 1`,
    [jobId, ownerId],
  );
  const run = rows[0];
  if (!run || run.status !== "processing") return;
  const quote = await loadQuote(ownerId, run.quote_id);
  if (!quote) return finishRun(run, "failed", null, "QUOTE_NOT_FOUND");
  try {
    if (run.operation === "expand") await runExpand(run, quote);
    else await runCompare(run, quote);
  } catch (error) {
    await finishRun(run, "failed", null, error instanceof Error ? error.message.slice(0, 64) : "PIPELINE_FAILED");
  }
};

export const getPipelineJob = async (ownerId: string, jobId: string, includeResult = true) => {
  const { rows } = await d1Query<PipelineRunRow>(
    `SELECT * FROM byok_pipeline_runs WHERE job_id = ? AND owner_id = ? LIMIT 1`,
    [jobId, ownerId],
  );
  const run = rows[0];
  if (!run) return fail("JOB_NOT_FOUND", 404);
  let result: ExpandResponse | CompareResponse | null = null;
  if (includeResult && run.result_cache_key) {
    result = await getCached<ExpandResponse | CompareResponse>(run.result_cache_key, {
      namespace: `byok-pipeline-${run.operation}`,
      scope: { type: "private", ownerId },
      allowLegacyRead: false,
    });
  }
  const failedStages = run.status === "partial" || run.status === "failed"
    ? (await d1Query<PipelineStepRow>(
      `SELECT parent_job_id, step_key, stage, status, child_job_id, error_code
       FROM byok_pipeline_steps WHERE parent_job_id = ? AND status = 'failed'
       ORDER BY step_key`,
      [run.job_id],
    )).rows.map((step) => ({
      step: step.step_key,
      stage: step.stage,
      errorCode: step.error_code ?? "PROVIDER_FAILED",
    }))
    : [];
  return {
    jobId: run.job_id,
    operation: run.operation,
    status: run.status,
    progress: { completed: Number(run.completed_steps), total: Number(run.total_steps) },
    errorCode: run.error_code,
    retryable: run.status === "partial" && failedStages.length > 0,
    failedStages,
    result,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
};

export const listPipelineHistory = async (ownerId: string, limit = 20, cursor?: string | null) => {
  const bounded = Math.min(100, Math.max(1, Math.floor(limit)));
  const { rows } = await d1Query<PipelineRunRow>(
    `SELECT r.*, q.retry_of_job_id
     FROM byok_pipeline_runs r
     JOIN byok_pipeline_quotes q
       ON q.quote_id = r.quote_id AND q.owner_id = r.owner_id
     WHERE r.owner_id = ?
       AND (? IS NULL OR r.created_at < ?)
     ORDER BY r.created_at DESC LIMIT ?`,
    [ownerId, cursor ?? null, cursor ?? null, bounded],
  );
  return {
    items: rows.map((run) => ({
      jobId: run.job_id, parentJobId: run.job_id, executionSource: "byok" as const,
      retryOfJobId: run.retry_of_job_id ?? null,
      operation: run.operation, status: run.status,
      progress: { completed: Number(run.completed_steps), total: Number(run.total_steps) },
      errorCode: run.error_code, createdAt: run.created_at, updatedAt: run.updated_at,
    })),
    nextCursor: rows.length === bounded ? rows[rows.length - 1].created_at : null,
  };
};
