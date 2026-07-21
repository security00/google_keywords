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
import {
  decryptProviderCredential,
  type ProviderCredentialDecryptionKeys,
} from "@/lib/provider-connections/credential-crypto";
import { loadProviderConnection } from "@/lib/provider-connections/store";
import { recordPipelineCostEvent } from "@/lib/pipelines/cost-ledger";
import {
  createDataForSeoClient,
  DATAFORSEO_ENDPOINTS,
  type DataForSeoClient,
} from "@/lib/providers/dataforseo";
import {
  extractRootCost,
  parseLiveTrendsResponse,
  type TrendPoint,
} from "@/lib/providers/dataforseo-parsers";
import {
  claimOwnedByokJob,
  completeOwnedByokJob,
  createOrGetOwnedByokJob,
  failOwnedByokJob,
  getOwnedByokJobByIdempotency,
  getOwnedJob,
  type ResearchJob,
} from "@/lib/research-jobs";

const CAPABILITY_VERSION = 1;
// Official Google Trends Live price per task checked on 2026-07-21:
// https://dataforseo.com/pricing/keywords-data/google-trends
export const BYOK_TRENDS_ESTIMATED_COST_USD = 0.011;
const MAX_TERM_LENGTH = 120;
const MIN_DAYS = 7;
const MAX_DAYS = 365 * 5;

export type ByokTrendsRequest = Readonly<{
  keyword: string;
  benchmark: string;
  dateFrom: string;
  dateTo: string;
}>;

export type ByokTrendsData = Readonly<{
  keyword: string;
  benchmark: string;
  dateFrom: string;
  dateTo: string;
  series: readonly TrendPoint[];
  benchmarkSeries: readonly TrendPoint[];
  cost: Readonly<{
    estimatedCostUsd: number;
    actualCostUsd: number | null;
  }>;
}>;

export type ByokTrendsResult = Readonly<{
  jobId: string;
  status: "pending" | "complete" | "failed";
  providerRequestState: ResearchJob["provider_request_state"];
  data?: ByokTrendsData;
  errorCode?: string;
}>;

export type ByokTrendsErrorCode =
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

export class ByokTrendsError extends Error {
  readonly code: ByokTrendsErrorCode;

  constructor(code: ByokTrendsErrorCode) {
    super(code);
    this.name = "ByokTrendsError";
    this.code = code;
  }
}

const fail = (code: ByokTrendsErrorCode): never => {
  throw new ByokTrendsError(code);
};

const normalizeTerm = (value: string) => {
  if (typeof value !== "string") return fail("INVALID_INPUT");
  const term = value.trim().replace(/\s+/g, " ");
  if (!term || term.length > MAX_TERM_LENGTH || /[\u0000-\u001F\u007F]/.test(term)) {
    return fail("INVALID_INPUT");
  }
  return term;
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const normalizeByokTrendsRequest = (
  input: Readonly<{
    keyword: string;
    benchmark?: string;
    days?: number;
    dateFrom?: string;
    dateTo?: string;
  }>,
  now = new Date(),
): ByokTrendsRequest => {
  const keyword = normalizeTerm(input.keyword);
  const benchmark = normalizeTerm(input.benchmark ?? "gpts");
  if (keyword.toLocaleLowerCase("en-US") === benchmark.toLocaleLowerCase("en-US")) {
    return fail("INVALID_INPUT");
  }
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
    return { keyword, benchmark, dateFrom: input.dateFrom!, dateTo: input.dateTo! };
  }
  const days = input.days ?? 90;
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    return fail("INVALID_INPUT");
  }
  const dateTo = now.toISOString().slice(0, 10);
  const from = new Date(`${dateTo}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - days);
  return { keyword, benchmark, dateFrom: from.toISOString().slice(0, 10), dateTo };
};

export const buildByokTrendsRequestHash = (input: Readonly<{
  ownerId: string;
  connectionId: string;
  connectionVersion: number;
  request: ByokTrendsRequest;
}>) => createHash("sha256").update(JSON.stringify({
  capability: "trends",
  version: CAPABILITY_VERSION,
  ownerId: input.ownerId,
  connectionId: input.connectionId,
  connectionVersion: input.connectionVersion,
  request: {
    ...input.request,
    keyword: input.request.keyword.toLocaleLowerCase("en-US"),
    benchmark: input.request.benchmark.toLocaleLowerCase("en-US"),
  },
})).digest("hex");

const loadVerifiedConnection = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedConnectionVersion: number;
}>) => {
  if (!input.ownerId || !input.connectionId
    || !Number.isInteger(input.expectedConnectionVersion)
    || input.expectedConnectionVersion < 1) {
    return fail("INVALID_INPUT");
  }
  const connection = await loadProviderConnection(input.ownerId, input.connectionId)
    .catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!connection || connection.provider !== "dataforseo") {
    return fail("CONNECTION_NOT_FOUND");
  }
  if (connection.credentialVersion !== input.expectedConnectionVersion) {
    return fail("CONNECTION_VERSION_CONFLICT");
  }
  if (connection.verificationStatus !== "valid") {
    return fail("CONNECTION_NOT_VERIFIED");
  }
  return connection;
};

export const quoteByokTrends = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedConnectionVersion: number;
  clientRequestId: string;
  keyword: string;
  benchmark?: string;
  days?: number;
  now?: Date;
}>): Promise<Readonly<{ quote: ByokCostQuote; request: ByokTrendsRequest; requestHash: string }>> => {
  await loadVerifiedConnection(input);
  const request = normalizeByokTrendsRequest(input, input.now);
  const requestHash = buildByokTrendsRequestHash({
    ownerId: input.ownerId,
    connectionId: input.connectionId,
    connectionVersion: input.expectedConnectionVersion,
    request,
  });
  const quote = await createByokCostQuote({
    ownerId: input.ownerId,
    capability: "trends",
    requestHash,
    idempotencyKey: `trends:${input.clientRequestId}`,
    estimatedCostUsd: BYOK_TRENDS_ESTIMATED_COST_USD,
    now: input.now,
  });
  return { quote, request, requestHash };
};

const cacheKeyForJob = (jobId: string) => `byok-trends:v1:${jobId}`;

const publicResult = async (ownerId: string, job: ResearchJob): Promise<ByokTrendsResult> => {
  if (job.status === "complete" && job.result_cache_key) {
    const data = await getCached<ByokTrendsData>(job.result_cache_key, {
      namespace: "byok-trends",
      scope: { type: "private", ownerId },
      allowLegacyRead: false,
    });
    if (!data) return fail("PRIVATE_CACHE_WRITE_FAILED");
    return {
      jobId: job.id,
      status: "complete",
      providerRequestState: job.provider_request_state,
      data,
    };
  }
  if (job.status === "failed") {
    return {
      jobId: job.id,
      status: "failed",
      providerRequestState: job.provider_request_state,
      errorCode: job.error ?? "PROVIDER_FAILED",
    };
  }
  return {
    jobId: job.id,
    status: "pending",
    providerRequestState: job.provider_request_state,
  };
};

const markFailed = async (
  job: ResearchJob,
  claimToken: string,
  errorCode: ByokTrendsErrorCode,
) => {
  await failOwnedByokJob({
    id: job.id,
    userId: job.user_id,
    claimToken,
    errorCode,
  }).catch(() => undefined);
};

export const executeByokTrends = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedConnectionVersion: number;
  request: ByokTrendsRequest;
  quoteId: string;
  requestHash: string;
  confirmedEstimatedCostUsd: number;
  confirmation: "CONFIRM";
  decryptionKeys: ProviderCredentialDecryptionKeys;
  clientFactory?: (credentials: { login: string; password: string }) => DataForSeoClient;
}>): Promise<ByokTrendsResult> => {
  const request = normalizeByokTrendsRequest(input.request);
  const connection = await loadVerifiedConnection(input);
  const expectedHash = buildByokTrendsRequestHash({
    ownerId: input.ownerId,
    connectionId: input.connectionId,
    connectionVersion: input.expectedConnectionVersion,
    request,
  });
  if (expectedHash !== input.requestHash) return fail("INVALID_INPUT");

  let credentials: { login: string; password: string };
  try {
    const decrypted = await decryptProviderCredential(
      {
        ownerId: input.ownerId,
        connectionId: input.connectionId,
        provider: "dataforseo",
      },
      connection.envelope,
      input.decryptionKeys,
    );
    if (Object.keys(decrypted).length !== 2 || !decrypted.login || !decrypted.password) {
      throw new Error("credential shape");
    }
    credentials = { login: decrypted.login, password: decrypted.password };
  } catch {
    return fail("CREDENTIAL_UNAVAILABLE");
  }

  const existing = await getOwnedByokJobByIdempotency({
    userId: input.ownerId,
    jobType: "trends",
    idempotencyKey: expectedHash,
  }).catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (existing) return publicResult(input.ownerId, existing);

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

  let jobRecord;
  try {
    jobRecord = await createOrGetOwnedByokJob({
      userId: input.ownerId,
      jobType: "trends",
      payload: { request, capabilityVersion: CAPABILITY_VERSION },
      idempotencyKey: expectedHash,
      providerConnectionId: input.connectionId,
      providerConnectionVersion: input.expectedConnectionVersion,
    });
  } catch {
    await releaseByokCostReservation({ ownerId: input.ownerId, quoteId: input.quoteId })
      .catch(() => undefined);
    return fail("JOB_PERSISTENCE_ERROR");
  }
  if (jobRecord.job.status !== "pending") {
    await releaseByokCostReservation({ ownerId: input.ownerId, quoteId: input.quoteId })
      .catch(() => undefined);
    return publicResult(input.ownerId, jobRecord.job);
  }
  const committed = await commitByokCostReservation({
    ownerId: input.ownerId,
    quoteId: input.quoteId,
    researchJobId: jobRecord.job.id,
  }).catch(() => false);
  if (!committed) {
    await releaseByokCostReservation({ ownerId: input.ownerId, quoteId: input.quoteId })
      .catch(() => undefined);
    return fail("SPEND_RESERVATION_FAILED");
  }

  const claim = await claimOwnedByokJob({
    id: jobRecord.job.id,
    userId: input.ownerId,
    jobType: "trends",
    providerConnectionId: input.connectionId,
    providerConnectionVersion: input.expectedConnectionVersion,
  }).catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!claim) {
    const current = await getOwnedJob(jobRecord.job.id, input.ownerId, "trends")
      .catch(() => fail("JOB_PERSISTENCE_ERROR"));
    return current ? publicResult(input.ownerId, current) : fail("JOB_PERSISTENCE_ERROR");
  }

  const client = (input.clientFactory ?? createDataForSeoClient)(credentials);
  let response: unknown;
  try {
    response = await client.request("post", DATAFORSEO_ENDPOINTS.trendsLive, {
      body: JSON.stringify([{
        keywords: [request.keyword, request.benchmark],
        location_code: 2840,
        language_code: "en",
        date_from: request.dateFrom,
        date_to: request.dateTo,
        type: "web",
      }]),
    }, 0, 40_000);
  } catch {
    try {
      await recordPipelineCostEvent({
        runId: jobRecord.job.id,
        pipeline: "byok-trends",
        provider: "dataforseo",
        endpoint: DATAFORSEO_ENDPOINTS.trendsLive,
        unitType: "request_attempt",
        unitCount: 1,
        unitPriceUsd: BYOK_TRENDS_ESTIMATED_COST_USD,
        researchJobId: jobRecord.job.id,
        eventKey: `byok:${jobRecord.job.id}:dataforseo:trends:v1`,
        idempotencyKey: expectedHash,
        credentialSource: "user",
        executionMode: "byok",
        ownerId: input.ownerId,
        metadata: { outcome: "provider_error", connectionVersion: input.expectedConnectionVersion },
      });
    } catch {
      await markFailed(jobRecord.job, claim.token, "COST_LEDGER_WRITE_FAILED");
      return fail("COST_LEDGER_WRITE_FAILED");
    }
    await markFailed(jobRecord.job, claim.token, "PROVIDER_FAILED");
    return fail("PROVIDER_FAILED");
  }

  const { keywordSeries, benchmarkSeries } = parseLiveTrendsResponse(
    response,
    request.keyword,
    request.benchmark,
  );
  const actualCostUsd = extractRootCost(response);
  try {
    await recordPipelineCostEvent({
      runId: jobRecord.job.id,
      pipeline: "byok-trends",
      provider: "dataforseo",
      endpoint: DATAFORSEO_ENDPOINTS.trendsLive,
      unitType: "request",
      unitCount: 1,
      unitPriceUsd: BYOK_TRENDS_ESTIMATED_COST_USD,
      actualCostUsd,
      researchJobId: jobRecord.job.id,
      eventKey: `byok:${jobRecord.job.id}:dataforseo:trends:v1`,
      idempotencyKey: expectedHash,
      credentialSource: "user",
      executionMode: "byok",
      ownerId: input.ownerId,
      metadata: {
        outcome: keywordSeries.length > 0 ? "success" : "invalid_response",
        connectionVersion: input.expectedConnectionVersion,
      },
    });
  } catch {
    await markFailed(jobRecord.job, claim.token, "COST_LEDGER_WRITE_FAILED");
    return fail("COST_LEDGER_WRITE_FAILED");
  }
  if (keywordSeries.length === 0) {
    await markFailed(jobRecord.job, claim.token, "PROVIDER_RESPONSE_INVALID");
    return fail("PROVIDER_RESPONSE_INVALID");
  }

  const data: ByokTrendsData = {
    ...request,
    series: keywordSeries,
    benchmarkSeries,
    cost: { estimatedCostUsd: BYOK_TRENDS_ESTIMATED_COST_USD, actualCostUsd },
  };
  const resultCacheKey = cacheKeyForJob(jobRecord.job.id);
  try {
    await setCache(resultCacheKey, data, {
      namespace: "byok-trends",
      scope: { type: "private", ownerId: input.ownerId },
      ttlHours: 24,
      allowLegacyRead: false,
    });
  } catch {
    await markFailed(jobRecord.job, claim.token, "PRIVATE_CACHE_WRITE_FAILED");
    return fail("PRIVATE_CACHE_WRITE_FAILED");
  }
  const completed = await completeOwnedByokJob({
    id: jobRecord.job.id,
    userId: input.ownerId,
    claimToken: claim.token,
    resultCacheKey,
  }).catch(() => false);
  if (!completed) return fail("JOB_PERSISTENCE_ERROR");
  return {
    jobId: jobRecord.job.id,
    status: "complete",
    providerRequestState: "completed",
    data,
  };
};

export const getOwnedByokTrendsResult = async (ownerId: string, jobId: string) => {
  if (!ownerId || !jobId) return fail("INVALID_INPUT");
  const job = await getOwnedJob(jobId, ownerId, "trends")
    .catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!job || job.execution_mode !== "byok" || job.credential_source !== "user") {
    return fail("CONNECTION_NOT_FOUND");
  }
  return publicResult(ownerId, job);
};
