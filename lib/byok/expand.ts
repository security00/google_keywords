import "server-only";

import { createHash } from "crypto";

import { getCached, setCache } from "@/lib/cache";
import {
  ByokSpendControlError,
  commitByokCostReservation,
  createByokCostQuote,
  releaseByokCostReservation,
  reserveConfirmedByokCostQuote,
  type ByokCostQuote,
} from "@/lib/byok/spend-controls";
import { getExpansionResultsFromTasks } from "@/lib/expand/expand-client";
import {
  decryptProviderCredential,
  type ProviderCredentialDecryptionKeys,
} from "@/lib/provider-connections/credential-crypto";
import { loadProviderConnection } from "@/lib/provider-connections/store";
import { recordPipelineCostEvent } from "@/lib/pipelines/cost-ledger";
import {
  DATAFORSEO_ENDPOINTS,
  type DataForSeoClient,
} from "@/lib/providers/dataforseo";
import { createByokDataForSeoClient } from "@/lib/byok/provider-clients";
import {
  claimOwnedByokJob,
  completeOwnedByokJob,
  createOrGetOwnedByokJob,
  failOwnedByokJob,
  getOwnedByokJobByIdempotency,
  getOwnedJob,
  type ResearchJob,
} from "@/lib/research-jobs";
import type { Candidate } from "@/lib/types";

const CAPABILITY_VERSION = 1;
// Official Google Trends Live price per task checked on 2026-07-21:
// https://dataforseo.com/pricing/keywords-data/google-trends
export const BYOK_EXPAND_ESTIMATED_COST_USD = 0.011;
const EXPAND_PROVIDER_TIMEOUT_MS = 60_000;
const MIN_DAYS = 7;
const MAX_DAYS = 365 * 5;
const MAX_SEED_LENGTH = 100;

export type ByokExpandRequest = Readonly<{
  keyword: string;
  dateFrom: string;
  dateTo: string;
}>;
export type ByokExpandData = Readonly<{
  keyword: string;
  dateFrom: string;
  dateTo: string;
  candidates: readonly Candidate[];
  cost: Readonly<{ estimatedCostUsd: number; actualCostUsd: number | null }>;
}>;
export type ByokExpandResult = Readonly<{
  jobId: string;
  status: "pending" | "complete" | "failed";
  providerRequestState: ResearchJob["provider_request_state"];
  data?: ByokExpandData;
  errorCode?: string;
}>;
export type ByokExpandErrorCode =
  | "INVALID_INPUT"
  | "CONNECTION_NOT_FOUND"
  | "CONNECTION_VERSION_CONFLICT"
  | "CONNECTION_NOT_VERIFIED"
  | "CREDENTIAL_UNAVAILABLE"
  | "JOB_PERSISTENCE_ERROR"
  | "PROVIDER_FAILED"
  | "PROVIDER_RESPONSE_INVALID"
  | "COST_LEDGER_WRITE_FAILED"
  | "PRIVATE_CACHE_WRITE_FAILED"
  | "SPEND_RESERVATION_FAILED";

export class ByokExpandError extends Error {
  readonly code: ByokExpandErrorCode;
  constructor(code: ByokExpandErrorCode) {
    super(code);
    this.name = "ByokExpandError";
    this.code = code;
  }
}

const fail = (code: ByokExpandErrorCode): never => { throw new ByokExpandError(code); };
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const normalizeByokExpandRequest = (
  input: Readonly<{ keyword: string; days?: number; dateFrom?: string; dateTo?: string }>,
  now = new Date(),
): ByokExpandRequest => {
  if (typeof input.keyword !== "string") return fail("INVALID_INPUT");
  const keyword = input.keyword.trim().replace(/\s+/g, " ");
  if (!keyword || keyword.length > MAX_SEED_LENGTH
    || /[<>|\\"\-+=~!:*()[\]{}]/.test(keyword)
    || /[\u0000-\u001F\u007F]/.test(keyword)) return fail("INVALID_INPUT");
  if (input.dateFrom !== undefined || input.dateTo !== undefined) {
    if (!isoDate.test(input.dateFrom ?? "") || !isoDate.test(input.dateTo ?? "")) {
      return fail("INVALID_INPUT");
    }
    const from = Date.parse(`${input.dateFrom}T00:00:00.000Z`);
    const to = Date.parse(`${input.dateTo}T00:00:00.000Z`);
    const days = Math.round((to - from) / 86_400_000);
    if (!Number.isFinite(from) || !Number.isFinite(to) || days < MIN_DAYS || days > MAX_DAYS) {
      return fail("INVALID_INPUT");
    }
    return { keyword, dateFrom: input.dateFrom!, dateTo: input.dateTo! };
  }
  const days = input.days ?? 90;
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) return fail("INVALID_INPUT");
  const dateTo = now.toISOString().slice(0, 10);
  const from = new Date(`${dateTo}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - days);
  return { keyword, dateFrom: from.toISOString().slice(0, 10), dateTo };
};

export const buildByokExpandRequestHash = (input: Readonly<{
  ownerId: string;
  connectionId: string;
  connectionVersion: number;
  request: ByokExpandRequest;
}>) => createHash("sha256").update(JSON.stringify({
  capability: "expand",
  version: CAPABILITY_VERSION,
  ownerId: input.ownerId,
  connectionId: input.connectionId,
  connectionVersion: input.connectionVersion,
  request: { ...input.request, keyword: input.request.keyword.toLocaleLowerCase("en-US") },
  config: {
    endpoint: DATAFORSEO_ENDPOINTS.trendsLive,
    locationCode: 2840,
    languageCode: "en",
    type: "web",
    itemType: "google_trends_queries_list",
  },
})).digest("hex");

const loadConnection = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedConnectionVersion: number;
}>) => {
  if (!input.ownerId || !input.connectionId || !Number.isInteger(input.expectedConnectionVersion)
    || input.expectedConnectionVersion < 1) return fail("INVALID_INPUT");
  const connection = await loadProviderConnection(input.ownerId, input.connectionId)
    .catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!connection || connection.provider !== "dataforseo") return fail("CONNECTION_NOT_FOUND");
  if (connection.credentialVersion !== input.expectedConnectionVersion) {
    return fail("CONNECTION_VERSION_CONFLICT");
  }
  if (connection.verificationStatus !== "valid") return fail("CONNECTION_NOT_VERIFIED");
  return connection;
};

export const quoteByokExpand = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedConnectionVersion: number;
  clientRequestId: string;
  keyword: string;
  days?: number;
  now?: Date;
}>): Promise<Readonly<{ quote: ByokCostQuote; request: ByokExpandRequest; requestHash: string }>> => {
  await loadConnection(input);
  const request = normalizeByokExpandRequest(input, input.now);
  const requestHash = buildByokExpandRequestHash({
    ownerId: input.ownerId,
    connectionId: input.connectionId,
    connectionVersion: input.expectedConnectionVersion,
    request,
  });
  const quote = await createByokCostQuote({
    ownerId: input.ownerId,
    capability: "expand",
    requestHash,
    idempotencyKey: `expand:${input.clientRequestId}`,
    estimatedCostUsd: BYOK_EXPAND_ESTIMATED_COST_USD,
    now: input.now,
  });
  return { quote, request, requestHash };
};

const cacheKeyForJob = (jobId: string) => `byok-expand:v1:${jobId}`;
const publicResult = async (ownerId: string, job: ResearchJob): Promise<ByokExpandResult> => {
  if (job.status === "complete" && job.result_cache_key) {
    const data = await getCached<ByokExpandData>(job.result_cache_key, {
      namespace: "byok-expand",
      scope: { type: "private", ownerId },
      allowLegacyRead: false,
    });
    if (!data) return fail("PRIVATE_CACHE_WRITE_FAILED");
    return { jobId: job.id, status: "complete", providerRequestState: job.provider_request_state, data };
  }
  if (job.status === "failed") {
    return {
      jobId: job.id,
      status: "failed",
      providerRequestState: job.provider_request_state,
      errorCode: job.error ?? "PROVIDER_FAILED",
    };
  }
  return { jobId: job.id, status: "pending", providerRequestState: job.provider_request_state };
};

const rootCost = (response: unknown) => {
  const cost = response && typeof response === "object" ? (response as { cost?: unknown }).cost : null;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : null;
};
const responseTasks = (response: unknown): Array<Record<string, unknown>> => {
  if (!response || typeof response !== "object") return [];
  const tasks = (response as { tasks?: unknown }).tasks;
  return Array.isArray(tasks)
    ? tasks.filter((task): task is Record<string, unknown> => Boolean(task) && typeof task === "object")
    : [];
};
const isSuccessfulProviderResponse = (
  response: unknown,
  tasks: Array<Record<string, unknown>>,
) => Boolean(
  response
  && typeof response === "object"
  && Number((response as { status_code?: unknown }).status_code) === 20000
  && tasks.some((task) => Number(task.status_code) === 20000),
);
const sanitizeCandidates = (candidates: Candidate[], seed: string): Candidate[] => {
  const seen = new Set<string>();
  const sanitized: Candidate[] = [];
  for (const candidate of candidates) {
    const keyword = typeof candidate.keyword === "string"
      ? candidate.keyword.trim().replace(/\s+/g, " ")
      : "";
    const key = keyword.toLocaleLowerCase("en-US");
    if (!keyword || keyword.length > 200 || seen.has(key)) continue;
    seen.add(key);
    sanitized.push({
      keyword,
      value: Number.isFinite(candidate.value) ? candidate.value : 0,
      type: candidate.type === "rising" ? "rising" : "top",
      source: seed,
    });
    if (sanitized.length >= 100) break;
  }
  return sanitized;
};

export const executeByokExpand = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedConnectionVersion: number;
  request: ByokExpandRequest;
  quoteId: string;
  requestHash: string;
  confirmedEstimatedCostUsd: number;
  confirmation: "CONFIRM";
  decryptionKeys: ProviderCredentialDecryptionKeys;
  clientFactory?: (credentials: { login: string; password: string }) => DataForSeoClient;
}>): Promise<ByokExpandResult> => {
  const request = normalizeByokExpandRequest(input.request);
  const connection = await loadConnection(input);
  const expectedHash = buildByokExpandRequestHash({
    ownerId: input.ownerId,
    connectionId: input.connectionId,
    connectionVersion: input.expectedConnectionVersion,
    request,
  });
  if (expectedHash !== input.requestHash) return fail("INVALID_INPUT");

  let credentials: { login: string; password: string };
  try {
    const value = await decryptProviderCredential(
      { ownerId: input.ownerId, connectionId: input.connectionId, provider: "dataforseo" },
      connection.envelope,
      input.decryptionKeys,
    );
    if (Object.keys(value).length !== 2 || !value.login || !value.password) throw new Error("shape");
    credentials = { login: value.login, password: value.password };
  } catch {
    return fail("CREDENTIAL_UNAVAILABLE");
  }

  const existing = await getOwnedByokJobByIdempotency({
    userId: input.ownerId,
    jobType: "expand",
    idempotencyKey: expectedHash,
  }).catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (existing && existing.status !== "pending") return publicResult(input.ownerId, existing);

  try {
    await reserveConfirmedByokCostQuote({
      ownerId: input.ownerId,
      quoteId: input.quoteId,
      requestHash: expectedHash,
      confirmedEstimatedCostUsd: input.confirmedEstimatedCostUsd,
      confirmation: input.confirmation,
    });
  } catch (error) {
    if (error instanceof ByokSpendControlError) throw error;
    return fail("SPEND_RESERVATION_FAILED");
  }

  let record;
  try {
    record = await createOrGetOwnedByokJob({
      userId: input.ownerId,
      jobType: "expand",
      payload: { request, capabilityVersion: CAPABILITY_VERSION },
      idempotencyKey: expectedHash,
      providerConnectionId: input.connectionId,
      providerConnectionVersion: input.expectedConnectionVersion,
    });
  } catch {
    await releaseByokCostReservation({ ownerId: input.ownerId, quoteId: input.quoteId }).catch(() => undefined);
    return fail("JOB_PERSISTENCE_ERROR");
  }
  if (record.job.status !== "pending") {
    await releaseByokCostReservation({ ownerId: input.ownerId, quoteId: input.quoteId }).catch(() => undefined);
    return publicResult(input.ownerId, record.job);
  }
  const committed = await commitByokCostReservation({
    ownerId: input.ownerId,
    quoteId: input.quoteId,
    researchJobId: record.job.id,
  }).catch(() => false);
  if (!committed) {
    await releaseByokCostReservation({ ownerId: input.ownerId, quoteId: input.quoteId }).catch(() => undefined);
    return fail("SPEND_RESERVATION_FAILED");
  }
  const claim = await claimOwnedByokJob({
    id: record.job.id,
    userId: input.ownerId,
    jobType: "expand",
    providerConnectionId: input.connectionId,
    providerConnectionVersion: input.expectedConnectionVersion,
  }).catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!claim) {
    const current = await getOwnedJob(record.job.id, input.ownerId, "expand")
      .catch(() => fail("JOB_PERSISTENCE_ERROR"));
    return current ? publicResult(input.ownerId, current) : fail("JOB_PERSISTENCE_ERROR");
  }

  const client = (input.clientFactory ?? createByokDataForSeoClient)(credentials);
  let response: unknown;
  let outcome: "success" | "provider_error" | "invalid_response" = "success";
  try {
    response = await client.request("post", DATAFORSEO_ENDPOINTS.trendsLive, {
      body: JSON.stringify([{
        keywords: [request.keyword],
        location_code: 2840,
        language_code: "en",
        type: "web",
        item_types: ["google_trends_queries_list"],
        date_from: request.dateFrom,
        date_to: request.dateTo,
      }]),
    }, 0, EXPAND_PROVIDER_TIMEOUT_MS);
  } catch {
    outcome = "provider_error";
    response = null;
  }

  const tasks = responseTasks(response);
  const candidates = sanitizeCandidates(
    getExpansionResultsFromTasks(tasks),
    request.keyword,
  );
  if (outcome === "success" && !isSuccessfulProviderResponse(response, tasks)) {
    outcome = "invalid_response";
  }
  const actualCostUsd = rootCost(response);
  try {
    await recordPipelineCostEvent({
      runId: record.job.id,
      pipeline: "byok-expand",
      provider: "dataforseo",
      endpoint: DATAFORSEO_ENDPOINTS.trendsLive,
      unitType: outcome === "provider_error" ? "request_attempt" : "request",
      unitCount: 1,
      unitPriceUsd: BYOK_EXPAND_ESTIMATED_COST_USD,
      actualCostUsd,
      researchJobId: record.job.id,
      eventKey: `byok:${record.job.id}:dataforseo:expand:v1`,
      idempotencyKey: expectedHash,
      credentialSource: "user",
      executionMode: "byok",
      ownerId: input.ownerId,
      metadata: { outcome, connectionVersion: input.expectedConnectionVersion },
    });
  } catch {
    await failOwnedByokJob({
      id: record.job.id,
      userId: input.ownerId,
      claimToken: claim.token,
      errorCode: "COST_LEDGER_WRITE_FAILED",
    }).catch(() => undefined);
    return fail("COST_LEDGER_WRITE_FAILED");
  }
  if (outcome !== "success") {
    const code = outcome === "provider_error" ? "PROVIDER_FAILED" : "PROVIDER_RESPONSE_INVALID";
    await failOwnedByokJob({
      id: record.job.id,
      userId: input.ownerId,
      claimToken: claim.token,
      errorCode: code,
    }).catch(() => undefined);
    return fail(code);
  }

  const data: ByokExpandData = {
    keyword: request.keyword,
    dateFrom: request.dateFrom,
    dateTo: request.dateTo,
    candidates,
    cost: { estimatedCostUsd: BYOK_EXPAND_ESTIMATED_COST_USD, actualCostUsd },
  };
  const cacheKey = cacheKeyForJob(record.job.id);
  try {
    await setCache(cacheKey, data, {
      namespace: "byok-expand",
      scope: { type: "private", ownerId: input.ownerId },
      ttlHours: 24,
      allowLegacyRead: false,
    });
  } catch {
    await failOwnedByokJob({
      id: record.job.id,
      userId: input.ownerId,
      claimToken: claim.token,
      errorCode: "PRIVATE_CACHE_WRITE_FAILED",
    }).catch(() => undefined);
    return fail("PRIVATE_CACHE_WRITE_FAILED");
  }
  const completed = await completeOwnedByokJob({
    id: record.job.id,
    userId: input.ownerId,
    claimToken: claim.token,
    resultCacheKey: cacheKey,
  }).catch(() => false);
  if (!completed) return fail("JOB_PERSISTENCE_ERROR");
  return { jobId: record.job.id, status: "complete", providerRequestState: "completed", data };
};

export const getOwnedByokExpandResult = async (ownerId: string, jobId: string) => {
  if (!ownerId || !jobId) return fail("INVALID_INPUT");
  const job = await getOwnedJob(jobId, ownerId, "expand").catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!job) return fail("JOB_PERSISTENCE_ERROR");
  return publicResult(ownerId, job);
};
