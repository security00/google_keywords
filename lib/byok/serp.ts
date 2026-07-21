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
  buildSerpTask,
  parseSerpSummariesResponse,
  type SerpSummary,
} from "@/lib/serp";
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
// Official Google Organic Live price for one 10-result SERP, checked 2026-07-21:
// https://dataforseo.com/pricing/google-serp/google-organic-serp-api
export const BYOK_SERP_ESTIMATED_COST_USD = 0.002;
const MAX_KEYWORD_LENGTH = 160;

export type ByokSerpRequest = Readonly<{ keyword: string }>;
export type ByokSerpData = Readonly<{
  keyword: string;
  summary: SerpSummary;
  cost: Readonly<{ estimatedCostUsd: number; actualCostUsd: number | null }>;
}>;
export type ByokSerpResult = Readonly<{
  jobId: string;
  status: "pending" | "complete" | "failed";
  providerRequestState: ResearchJob["provider_request_state"];
  data?: ByokSerpData;
  errorCode?: string;
}>;

export type ByokSerpErrorCode =
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

export class ByokSerpError extends Error {
  readonly code: ByokSerpErrorCode;
  constructor(code: ByokSerpErrorCode) {
    super(code);
    this.name = "ByokSerpError";
    this.code = code;
  }
}

const fail = (code: ByokSerpErrorCode): never => { throw new ByokSerpError(code); };

export const normalizeByokSerpRequest = (
  input: Readonly<{ keyword: string }>,
): ByokSerpRequest => {
  if (typeof input.keyword !== "string") return fail("INVALID_INPUT");
  const keyword = input.keyword.trim().replace(/\s+/g, " ");
  if (!keyword || keyword.length > MAX_KEYWORD_LENGTH
    || /[\u0000-\u001F\u007F]/.test(keyword)) {
    return fail("INVALID_INPUT");
  }
  return { keyword };
};

export const buildByokSerpRequestHash = (input: Readonly<{
  ownerId: string;
  connectionId: string;
  connectionVersion: number;
  request: ByokSerpRequest;
}>) => createHash("sha256").update(JSON.stringify({
  capability: "serp",
  version: CAPABILITY_VERSION,
  ownerId: input.ownerId,
  connectionId: input.connectionId,
  connectionVersion: input.connectionVersion,
  keyword: input.request.keyword.toLocaleLowerCase("en-US"),
  config: { locationCode: 2840, languageCode: "en", device: "desktop", os: "windows", depth: 10 },
})).digest("hex");

const loadConnection = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedConnectionVersion: number;
}>) => {
  if (!input.ownerId || !input.connectionId
    || !Number.isInteger(input.expectedConnectionVersion)
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

export const quoteByokSerp = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedConnectionVersion: number;
  clientRequestId: string;
  keyword: string;
  now?: Date;
}>): Promise<Readonly<{ quote: ByokCostQuote; request: ByokSerpRequest; requestHash: string }>> => {
  await loadConnection(input);
  const request = normalizeByokSerpRequest(input);
  const requestHash = buildByokSerpRequestHash({
    ownerId: input.ownerId,
    connectionId: input.connectionId,
    connectionVersion: input.expectedConnectionVersion,
    request,
  });
  const quote = await createByokCostQuote({
    ownerId: input.ownerId,
    capability: "serp",
    requestHash,
    idempotencyKey: `serp:${input.clientRequestId}`,
    estimatedCostUsd: BYOK_SERP_ESTIMATED_COST_USD,
    now: input.now,
  });
  return { quote, request, requestHash };
};

const cacheKeyForJob = (jobId: string) => `byok-serp:v1:${jobId}`;
const publicResult = async (ownerId: string, job: ResearchJob): Promise<ByokSerpResult> => {
  if (job.status === "complete" && job.result_cache_key) {
    const data = await getCached<ByokSerpData>(job.result_cache_key, {
      namespace: "byok-serp",
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

const markFailed = async (job: ResearchJob, token: string, code: ByokSerpErrorCode) => {
  await failOwnedByokJob({ id: job.id, userId: job.user_id, claimToken: token, errorCode: code })
    .catch(() => undefined);
};

const rootCost = (response: unknown) => {
  const value = response && typeof response === "object"
    ? (response as { cost?: unknown }).cost
    : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export const executeByokSerp = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedConnectionVersion: number;
  request: ByokSerpRequest;
  quoteId: string;
  requestHash: string;
  confirmedEstimatedCostUsd: number;
  confirmation: "CONFIRM";
  decryptionKeys: ProviderCredentialDecryptionKeys;
  clientFactory?: (credentials: { login: string; password: string }) => DataForSeoClient;
}>): Promise<ByokSerpResult> => {
  const request = normalizeByokSerpRequest(input.request);
  const connection = await loadConnection(input);
  const expectedHash = buildByokSerpRequestHash({
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
    jobType: "serp",
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

  let record;
  try {
    record = await createOrGetOwnedByokJob({
      userId: input.ownerId,
      jobType: "serp",
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
    await releaseByokCostReservation({ ownerId: input.ownerId, quoteId: input.quoteId })
      .catch(() => undefined);
    return fail("SPEND_RESERVATION_FAILED");
  }

  const claim = await claimOwnedByokJob({
    id: record.job.id,
    userId: input.ownerId,
    jobType: "serp",
    providerConnectionId: input.connectionId,
    providerConnectionVersion: input.expectedConnectionVersion,
  }).catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!claim) {
    const current = await getOwnedJob(record.job.id, input.ownerId, "serp")
      .catch(() => fail("JOB_PERSISTENCE_ERROR"));
    return current ? publicResult(input.ownerId, current) : fail("JOB_PERSISTENCE_ERROR");
  }

  const client = (input.clientFactory ?? createDataForSeoClient)(credentials);
  let response: unknown;
  try {
    response = await client.request("post", DATAFORSEO_ENDPOINTS.serpLiveAdvanced, {
      body: JSON.stringify([buildSerpTask(request.keyword, {
        locationCode: 2840,
        locationName: "United States",
        languageCode: "en",
        device: "desktop",
        os: "windows",
        depth: 10,
      })]),
    }, 0, 20_000);
  } catch {
    try {
      await recordPipelineCostEvent({
        runId: record.job.id,
        pipeline: "byok-serp",
        provider: "dataforseo",
        endpoint: DATAFORSEO_ENDPOINTS.serpLiveAdvanced,
        unitType: "request_attempt",
        unitCount: 1,
        unitPriceUsd: BYOK_SERP_ESTIMATED_COST_USD,
        researchJobId: record.job.id,
        eventKey: `byok:${record.job.id}:dataforseo:serp:v1`,
        idempotencyKey: expectedHash,
        credentialSource: "user",
        executionMode: "byok",
        ownerId: input.ownerId,
        metadata: { outcome: "provider_error", connectionVersion: input.expectedConnectionVersion },
      });
    } catch {
      await markFailed(record.job, claim.token, "COST_LEDGER_WRITE_FAILED");
      return fail("COST_LEDGER_WRITE_FAILED");
    }
    await markFailed(record.job, claim.token, "PROVIDER_FAILED");
    return fail("PROVIDER_FAILED");
  }

  const summary = parseSerpSummariesResponse(response).get(
    request.keyword.toLocaleLowerCase("en-US"),
  );
  const actualCostUsd = rootCost(response);
  try {
    await recordPipelineCostEvent({
      runId: record.job.id,
      pipeline: "byok-serp",
      provider: "dataforseo",
      endpoint: DATAFORSEO_ENDPOINTS.serpLiveAdvanced,
      unitType: "request",
      unitCount: 1,
      unitPriceUsd: BYOK_SERP_ESTIMATED_COST_USD,
      actualCostUsd,
      researchJobId: record.job.id,
      eventKey: `byok:${record.job.id}:dataforseo:serp:v1`,
      idempotencyKey: expectedHash,
      credentialSource: "user",
      executionMode: "byok",
      ownerId: input.ownerId,
      metadata: {
        outcome: summary ? "success" : "invalid_response",
        connectionVersion: input.expectedConnectionVersion,
      },
    });
  } catch {
    await markFailed(record.job, claim.token, "COST_LEDGER_WRITE_FAILED");
    return fail("COST_LEDGER_WRITE_FAILED");
  }
  if (!summary) {
    await markFailed(record.job, claim.token, "PROVIDER_RESPONSE_INVALID");
    return fail("PROVIDER_RESPONSE_INVALID");
  }
  const data: ByokSerpData = {
    keyword: request.keyword,
    summary,
    cost: { estimatedCostUsd: BYOK_SERP_ESTIMATED_COST_USD, actualCostUsd },
  };
  const cacheKey = cacheKeyForJob(record.job.id);
  try {
    await setCache(cacheKey, data, {
      namespace: "byok-serp",
      scope: { type: "private", ownerId: input.ownerId },
      ttlHours: 24,
      allowLegacyRead: false,
    });
  } catch {
    await markFailed(record.job, claim.token, "PRIVATE_CACHE_WRITE_FAILED");
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

export const getOwnedByokSerpResult = async (ownerId: string, jobId: string) => {
  if (!ownerId || !jobId) return fail("INVALID_INPUT");
  const job = await getOwnedJob(jobId, ownerId, "serp")
    .catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!job || job.execution_mode !== "byok" || job.credential_source !== "user") {
    return fail("CONNECTION_NOT_FOUND");
  }
  return publicResult(ownerId, job);
};
