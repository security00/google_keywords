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
import { getComparisonResultsFromTasks } from "@/lib/compare/compare-client";
import { summarizeResults } from "@/lib/compare";
import {
  decryptProviderCredential,
  type ProviderCredentialDecryptionKeys,
} from "@/lib/provider-connections/credential-crypto";
import { loadProviderConnection } from "@/lib/provider-connections/store";
import { recordPipelineCostEvent } from "@/lib/pipelines/cost-ledger";
import { extractChatResponseText, extractJsonObject } from "@/lib/providers/chat-response";
import {
  createDataForSeoClient,
  DATAFORSEO_ENDPOINTS,
  type DataForSeoClient,
} from "@/lib/providers/dataforseo";
import type { ChatCompletionClient } from "@/lib/providers/llm";
import { createOpenRouterClient } from "@/lib/providers/openrouter";
import {
  claimOwnedByokJob,
  completeOwnedByokJob,
  createOrGetOwnedByokJob,
  failOwnedByokJob,
  getOwnedByokJobByIdempotency,
  getOwnedJob,
  type ResearchJob,
} from "@/lib/research-jobs";
import type { CompareResponse, ComparisonIntent, ComparisonResult } from "@/lib/types";

const CAPABILITY_VERSION = 1;
export const BYOK_COMPARE_MODEL = "google/gemini-2.5-flash-lite";
export const BYOK_COMPARE_DATAFORSEO_ESTIMATE_USD = 0.011;
// Conservative cap for a bounded four-keyword intent prompt. Current official
// model prices checked 2026-07-21: $0.10/M input and $0.40/M output.
// https://openrouter.ai/google/gemini-2.5-flash-lite/
export const BYOK_COMPARE_OPENROUTER_ESTIMATE_USD = 0.001;
export const BYOK_COMPARE_ESTIMATED_COST_USD = 0.012;
const MAX_KEYWORDS = 4;
const MAX_TERM_LENGTH = 100;
const MIN_DAYS = 7;
const MAX_DAYS = 365 * 5;
const INTENT_LABELS = [
  "AI Tools", "AI News", "Games", "Game Info", "Utility Tools", "Commerce / Services", "Other",
] as const;

export type ByokCompareRequest = Readonly<{
  keywords: readonly string[];
  benchmark: string;
  dateFrom: string;
  dateTo: string;
}>;
export type ByokCompareData = Readonly<{
  phase: "complete" | "partial";
  partialSuccess: boolean;
  comparison: CompareResponse;
  stages: Readonly<{
    dataforseo: Readonly<{ status: "complete"; actualCostUsd: number | null }>;
    intent: Readonly<{
      status: "complete" | "failed";
      model: string;
      errorCode?: "PROVIDER_FAILED" | "PROVIDER_RESPONSE_INVALID";
    }>;
  }>;
  cost: Readonly<{
    estimatedCostUsd: number;
    dataForSeoActualCostUsd: number | null;
    openRouterActualCostUsd: number | null;
  }>;
}>;
export type ByokCompareResult = Readonly<{
  jobId: string;
  status: "pending" | "complete" | "failed";
  providerRequestState: ResearchJob["provider_request_state"];
  data?: ByokCompareData;
  errorCode?: string;
}>;
export type ByokCompareErrorCode =
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

export class ByokCompareError extends Error {
  readonly code: ByokCompareErrorCode;
  constructor(code: ByokCompareErrorCode) {
    super(code);
    this.name = "ByokCompareError";
    this.code = code;
  }
}
const fail = (code: ByokCompareErrorCode): never => { throw new ByokCompareError(code); };
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

const normalizeTerm = (value: string) => {
  if (typeof value !== "string") return fail("INVALID_INPUT");
  const term = value.trim().replace(/\s+/g, " ");
  if (!term || term.length > MAX_TERM_LENGTH || /[\u0000-\u001F\u007F]/.test(term)) {
    return fail("INVALID_INPUT");
  }
  return term;
};

export const normalizeByokCompareRequest = (
  input: Readonly<{
    keywords: readonly string[];
    benchmark?: string;
    days?: number;
    dateFrom?: string;
    dateTo?: string;
  }>,
  now = new Date(),
): ByokCompareRequest => {
  if (!Array.isArray(input.keywords)) return fail("INVALID_INPUT");
  const unique = new Map<string, string>();
  for (const raw of input.keywords) {
    const keyword = normalizeTerm(raw);
    const key = keyword.toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, keyword);
  }
  const benchmark = normalizeTerm(input.benchmark ?? "gpts");
  unique.delete(benchmark.toLocaleLowerCase("en-US"));
  const keywords = [...unique.values()];
  if (keywords.length === 0 || keywords.length > MAX_KEYWORDS) return fail("INVALID_INPUT");
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
    return { keywords, benchmark, dateFrom: input.dateFrom!, dateTo: input.dateTo! };
  }
  const days = input.days ?? 90;
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) return fail("INVALID_INPUT");
  const dateTo = now.toISOString().slice(0, 10);
  const from = new Date(`${dateTo}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - days);
  return { keywords, benchmark, dateFrom: from.toISOString().slice(0, 10), dateTo };
};

export const buildByokCompareRequestHash = (input: Readonly<{
  ownerId: string;
  dataForSeoConnectionId: string;
  dataForSeoConnectionVersion: number;
  openRouterConnectionId: string;
  openRouterConnectionVersion: number;
  request: ByokCompareRequest;
}>) => createHash("sha256").update(JSON.stringify({
  capability: "compare",
  version: CAPABILITY_VERSION,
  ownerId: input.ownerId,
  dataForSeo: [input.dataForSeoConnectionId, input.dataForSeoConnectionVersion],
  openRouter: [input.openRouterConnectionId, input.openRouterConnectionVersion],
  request: {
    ...input.request,
    keywords: input.request.keywords.map((value) => value.toLocaleLowerCase("en-US")).sort(),
    benchmark: input.request.benchmark.toLocaleLowerCase("en-US"),
  },
  config: {
    trendsEndpoint: DATAFORSEO_ENDPOINTS.trendsLive,
    model: BYOK_COMPARE_MODEL,
    locationCode: 2840,
    languageCode: "en",
    type: "web",
    maxOutputTokens: 700,
  },
})).digest("hex");

const loadConnection = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedVersion: number;
  provider: "dataforseo" | "openrouter";
}>) => {
  if (!input.ownerId || !input.connectionId || !Number.isInteger(input.expectedVersion)
    || input.expectedVersion < 1) return fail("INVALID_INPUT");
  const connection = await loadProviderConnection(input.ownerId, input.connectionId)
    .catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!connection || connection.provider !== input.provider) return fail("CONNECTION_NOT_FOUND");
  if (connection.credentialVersion !== input.expectedVersion) return fail("CONNECTION_VERSION_CONFLICT");
  if (connection.verificationStatus !== "valid") return fail("CONNECTION_NOT_VERIFIED");
  return connection;
};

export const quoteByokCompare = async (input: Readonly<{
  ownerId: string;
  dataForSeoConnectionId: string;
  dataForSeoConnectionVersion: number;
  openRouterConnectionId: string;
  openRouterConnectionVersion: number;
  clientRequestId: string;
  keywords: readonly string[];
  benchmark?: string;
  days?: number;
  now?: Date;
}>): Promise<Readonly<{ quote: ByokCostQuote; request: ByokCompareRequest; requestHash: string }>> => {
  await Promise.all([
    loadConnection({
      ownerId: input.ownerId, connectionId: input.dataForSeoConnectionId,
      expectedVersion: input.dataForSeoConnectionVersion, provider: "dataforseo",
    }),
    loadConnection({
      ownerId: input.ownerId, connectionId: input.openRouterConnectionId,
      expectedVersion: input.openRouterConnectionVersion, provider: "openrouter",
    }),
  ]);
  const request = normalizeByokCompareRequest(input, input.now);
  const requestHash = buildByokCompareRequestHash({ ...input, request });
  const quote = await createByokCostQuote({
    ownerId: input.ownerId,
    capability: "compare",
    requestHash,
    idempotencyKey: `compare:${input.clientRequestId}`,
    estimatedCostUsd: BYOK_COMPARE_ESTIMATED_COST_USD,
    now: input.now,
  });
  return { quote, request, requestHash };
};

const cacheKeyForJob = (jobId: string) => `byok-compare:v1:${jobId}`;
const publicResult = async (ownerId: string, job: ResearchJob): Promise<ByokCompareResult> => {
  if (job.status === "complete" && job.result_cache_key) {
    const data = await getCached<ByokCompareData>(job.result_cache_key, {
      namespace: "byok-compare", scope: { type: "private", ownerId }, allowLegacyRead: false,
    });
    if (!data) return fail("PRIVATE_CACHE_WRITE_FAILED");
    return { jobId: job.id, status: "complete", providerRequestState: job.provider_request_state, data };
  }
  if (job.status === "failed") return {
    jobId: job.id, status: "failed", providerRequestState: job.provider_request_state,
    errorCode: job.error ?? "PROVIDER_FAILED",
  };
  return { jobId: job.id, status: "pending", providerRequestState: job.provider_request_state };
};
const responseTasks = (response: unknown): Array<Record<string, unknown>> => {
  const tasks = response && typeof response === "object" ? (response as { tasks?: unknown }).tasks : null;
  return Array.isArray(tasks)
    ? tasks.filter((task): task is Record<string, unknown> => Boolean(task) && typeof task === "object")
    : [];
};
const rootCost = (response: unknown) => {
  const cost = response && typeof response === "object" ? (response as { cost?: unknown }).cost : null;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : null;
};
const openRouterCost = (response: unknown) => {
  if (!response || typeof response !== "object") return null;
  const usage = (response as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const cost = (usage as { cost?: unknown }).cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : null;
};

const intentPrompt = (results: readonly ComparisonResult[]) => ({
  temperature: 0,
  max_tokens: 700,
  messages: [
    {
      role: "system" as const,
      content: "Classify keyword demand using only the supplied trend metrics. Return strict JSON only.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        categories: INTENT_LABELS,
        keywords: results.map((item) => ({
          keyword: item.keyword, verdict: item.verdict, ratio: item.ratio,
          ratioRecent: item.ratioRecent, slopeDiff: item.slopeDiff,
        })),
        output: { intents: [{ keyword: "", label: "", demand: "", reason: "", confidence: 0 }] },
      }),
    },
  ],
});

const enrichIntent = (response: unknown, results: readonly ComparisonResult[]): ComparisonResult[] => {
  const parsed = extractJsonObject(extractChatResponseText(response));
  const items = Array.isArray(parsed?.intents) ? parsed.intents : null;
  if (!items) return fail("PROVIDER_RESPONSE_INVALID");
  const expected = new Map(results.map((item) => [item.keyword.toLocaleLowerCase("en-US"), item.keyword]));
  const intents = new Map<string, ComparisonIntent>();
  for (const item of items) {
    const keyword = typeof item?.keyword === "string" ? item.keyword.trim() : "";
    const key = keyword.toLocaleLowerCase("en-US");
    const label = typeof item?.label === "string" ? item.label.trim() : "";
    const demand = typeof item?.demand === "string" ? item.demand.trim() : "";
    const reason = typeof item?.reason === "string" ? item.reason.trim() : "";
    if (!expected.has(key) || intents.has(key) || !INTENT_LABELS.includes(label as never)
      || !demand || demand.length > 240 || !reason || reason.length > 240) {
      return fail("PROVIDER_RESPONSE_INVALID");
    }
    const confidence = typeof item?.confidence === "number"
      ? Math.min(1, Math.max(0, item.confidence))
      : undefined;
    intents.set(key, { label, demand, reason, confidence });
  }
  if (intents.size !== expected.size) return fail("PROVIDER_RESPONSE_INVALID");
  return results.map((item) => ({
    ...item,
    intent: intents.get(item.keyword.toLocaleLowerCase("en-US")),
  }));
};

const recordEvent = (input: Readonly<{
  job: ResearchJob;
  ownerId: string;
  provider: "dataforseo" | "openrouter";
  endpoint: string;
  eventKey: string;
  unitPriceUsd: number;
  actualCostUsd: number | null;
  outcome: string;
  metadata: Record<string, unknown>;
}>) => recordPipelineCostEvent({
  runId: input.job.id,
  pipeline: "byok-compare",
  provider: input.provider,
  endpoint: input.endpoint,
  unitType: input.outcome === "provider_error" ? "request_attempt" : "request",
  unitCount: 1,
  unitPriceUsd: input.unitPriceUsd,
  actualCostUsd: input.actualCostUsd,
  researchJobId: input.job.id,
  eventKey: input.eventKey,
  idempotencyKey: input.job.idempotency_key,
  credentialSource: "user",
  executionMode: "byok",
  ownerId: input.ownerId,
  metadata: { outcome: input.outcome, ...input.metadata },
});

export const executeByokCompare = async (input: Readonly<{
  ownerId: string;
  dataForSeoConnectionId: string;
  dataForSeoConnectionVersion: number;
  openRouterConnectionId: string;
  openRouterConnectionVersion: number;
  request: ByokCompareRequest;
  quoteId: string;
  requestHash: string;
  confirmedEstimatedCostUsd: number;
  confirmation: "CONFIRM";
  decryptionKeys: ProviderCredentialDecryptionKeys;
  dataForSeoClientFactory?: (credentials: { login: string; password: string }) => DataForSeoClient;
  openRouterClientFactory?: (apiKey: string) => ChatCompletionClient;
}>): Promise<ByokCompareResult> => {
  const request = normalizeByokCompareRequest(input.request);
  const [dataForSeoConnection, openRouterConnection] = await Promise.all([
    loadConnection({
      ownerId: input.ownerId, connectionId: input.dataForSeoConnectionId,
      expectedVersion: input.dataForSeoConnectionVersion, provider: "dataforseo",
    }),
    loadConnection({
      ownerId: input.ownerId, connectionId: input.openRouterConnectionId,
      expectedVersion: input.openRouterConnectionVersion, provider: "openrouter",
    }),
  ]);
  const expectedHash = buildByokCompareRequestHash({ ...input, request });
  if (expectedHash !== input.requestHash) return fail("INVALID_INPUT");

  let dataForSeoCredentials: { login: string; password: string };
  let openRouterApiKey: string;
  try {
    const [dataForSeoValue, openRouterValue] = await Promise.all([
      decryptProviderCredential(
        { ownerId: input.ownerId, connectionId: input.dataForSeoConnectionId, provider: "dataforseo" },
        dataForSeoConnection.envelope, input.decryptionKeys,
      ),
      decryptProviderCredential(
        { ownerId: input.ownerId, connectionId: input.openRouterConnectionId, provider: "openrouter" },
        openRouterConnection.envelope, input.decryptionKeys,
      ),
    ]);
    if (Object.keys(dataForSeoValue).length !== 2 || !dataForSeoValue.login || !dataForSeoValue.password
      || Object.keys(openRouterValue).length !== 1 || !openRouterValue.apiKey) throw new Error("shape");
    dataForSeoCredentials = { login: dataForSeoValue.login, password: dataForSeoValue.password };
    openRouterApiKey = openRouterValue.apiKey;
  } catch {
    return fail("CREDENTIAL_UNAVAILABLE");
  }

  const existing = await getOwnedByokJobByIdempotency({
    userId: input.ownerId, jobType: "compare", idempotencyKey: expectedHash,
  }).catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (existing && existing.status !== "pending") return publicResult(input.ownerId, existing);
  try {
    await reserveConfirmedByokCostQuote({
      ownerId: input.ownerId, quoteId: input.quoteId, requestHash: expectedHash,
      confirmedEstimatedCostUsd: input.confirmedEstimatedCostUsd, confirmation: input.confirmation,
    });
  } catch (error) {
    if (error instanceof ByokSpendControlError) throw error;
    return fail("SPEND_RESERVATION_FAILED");
  }

  let record;
  try {
    record = await createOrGetOwnedByokJob({
      userId: input.ownerId, jobType: "compare",
      payload: {
        request, capabilityVersion: CAPABILITY_VERSION,
        openRouterConnectionId: input.openRouterConnectionId,
        openRouterConnectionVersion: input.openRouterConnectionVersion,
      },
      idempotencyKey: expectedHash,
      providerConnectionId: input.dataForSeoConnectionId,
      providerConnectionVersion: input.dataForSeoConnectionVersion,
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
    ownerId: input.ownerId, quoteId: input.quoteId, researchJobId: record.job.id,
  }).catch(() => false);
  if (!committed) {
    await releaseByokCostReservation({ ownerId: input.ownerId, quoteId: input.quoteId }).catch(() => undefined);
    return fail("SPEND_RESERVATION_FAILED");
  }
  const claim = await claimOwnedByokJob({
    id: record.job.id, userId: input.ownerId, jobType: "compare",
    providerConnectionId: input.dataForSeoConnectionId,
    providerConnectionVersion: input.dataForSeoConnectionVersion,
  }).catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!claim) {
    const current = await getOwnedJob(record.job.id, input.ownerId, "compare")
      .catch(() => fail("JOB_PERSISTENCE_ERROR"));
    return current ? publicResult(input.ownerId, current) : fail("JOB_PERSISTENCE_ERROR");
  }

  const failJob = async (code: ByokCompareErrorCode) => {
    await failOwnedByokJob({
      id: record.job.id, userId: input.ownerId, claimToken: claim.token, errorCode: code,
    }).catch(() => undefined);
    return fail(code);
  };
  const dataForSeoClient = (input.dataForSeoClientFactory ?? createDataForSeoClient)(dataForSeoCredentials);
  let dataForSeoResponse: unknown;
  try {
    dataForSeoResponse = await dataForSeoClient.request("post", DATAFORSEO_ENDPOINTS.trendsLive, {
      body: JSON.stringify([{
        keywords: [...request.keywords, request.benchmark],
        location_code: 2840, language_code: "en", type: "web",
        item_types: ["google_trends_graph"],
        date_from: request.dateFrom, date_to: request.dateTo,
      }]),
    }, 0, 40_000);
  } catch {
    try {
      await recordEvent({
        job: record.job, ownerId: input.ownerId, provider: "dataforseo",
        endpoint: DATAFORSEO_ENDPOINTS.trendsLive,
        eventKey: `byok:${record.job.id}:dataforseo:compare:v1`,
        unitPriceUsd: BYOK_COMPARE_DATAFORSEO_ESTIMATE_USD, actualCostUsd: null,
        outcome: "provider_error", metadata: { connectionVersion: input.dataForSeoConnectionVersion },
      });
    } catch { return failJob("COST_LEDGER_WRITE_FAILED"); }
    return failJob("PROVIDER_FAILED");
  }

  const dataForSeoActualCostUsd = rootCost(dataForSeoResponse);
  const results = await getComparisonResultsFromTasks(
    responseTasks(dataForSeoResponse), request.benchmark, {},
    { enableIntentLlm: false, llmClient: null },
  );
  try {
    await recordEvent({
      job: record.job, ownerId: input.ownerId, provider: "dataforseo",
      endpoint: DATAFORSEO_ENDPOINTS.trendsLive,
      eventKey: `byok:${record.job.id}:dataforseo:compare:v1`,
      unitPriceUsd: BYOK_COMPARE_DATAFORSEO_ESTIMATE_USD,
      actualCostUsd: dataForSeoActualCostUsd,
      outcome: results.length ? "success" : "invalid_response",
      metadata: { connectionVersion: input.dataForSeoConnectionVersion },
    });
  } catch { return failJob("COST_LEDGER_WRITE_FAILED"); }
  if (!results.length) return failJob("PROVIDER_RESPONSE_INVALID");

  const baseComparison: CompareResponse = {
    benchmark: request.benchmark,
    dateFrom: request.dateFrom,
    dateTo: request.dateTo,
    results,
    summary: summarizeResults(results),
  };
  const cacheKey = cacheKeyForJob(record.job.id);
  const baseData: ByokCompareData = {
    phase: "partial",
    partialSuccess: true,
    comparison: baseComparison,
    stages: {
      dataforseo: { status: "complete", actualCostUsd: dataForSeoActualCostUsd },
      intent: { status: "failed", model: BYOK_COMPARE_MODEL, errorCode: "PROVIDER_FAILED" },
    },
    cost: {
      estimatedCostUsd: BYOK_COMPARE_ESTIMATED_COST_USD,
      dataForSeoActualCostUsd,
      openRouterActualCostUsd: null,
    },
  };
  try {
    await setCache(cacheKey, baseData, {
      namespace: "byok-compare", scope: { type: "private", ownerId: input.ownerId },
      ttlHours: 24, allowLegacyRead: false,
    });
  } catch { return failJob("PRIVATE_CACHE_WRITE_FAILED"); }

  const openRouterClient = (input.openRouterClientFactory ?? ((apiKey) => createOpenRouterClient(
    { apiKey }, { model: BYOK_COMPARE_MODEL },
  )))(openRouterApiKey);
  let openRouterResponse: unknown;
  let intentError: "PROVIDER_FAILED" | "PROVIDER_RESPONSE_INVALID" | null = null;
  let enrichedResults: ComparisonResult[] = results;
  try {
    openRouterResponse = await openRouterClient.complete(intentPrompt(results), {
      maxRetries: 0, timeoutMs: 15_000,
    });
    try {
      enrichedResults = enrichIntent(openRouterResponse, results);
    } catch {
      intentError = "PROVIDER_RESPONSE_INVALID";
    }
  } catch {
    openRouterResponse = null;
    intentError = "PROVIDER_FAILED";
  }
  const openRouterActualCostUsd = openRouterCost(openRouterResponse);
  try {
    await recordEvent({
      job: record.job, ownerId: input.ownerId, provider: "openrouter",
      endpoint: "chat/completions",
      eventKey: `byok:${record.job.id}:openrouter:compare-intent:v1`,
      unitPriceUsd: BYOK_COMPARE_OPENROUTER_ESTIMATE_USD,
      actualCostUsd: openRouterActualCostUsd,
      outcome: intentError === "PROVIDER_FAILED" ? "provider_error"
        : intentError === "PROVIDER_RESPONSE_INVALID" ? "invalid_response" : "success",
      metadata: { model: BYOK_COMPARE_MODEL, connectionVersion: input.openRouterConnectionVersion },
    });
  } catch { return failJob("COST_LEDGER_WRITE_FAILED"); }

  const finalData: ByokCompareData = intentError ? {
    ...baseData,
    stages: {
      ...baseData.stages,
      intent: { status: "failed", model: BYOK_COMPARE_MODEL, errorCode: intentError },
    },
    cost: { ...baseData.cost, openRouterActualCostUsd },
  } : {
    phase: "complete",
    partialSuccess: false,
    comparison: { ...baseComparison, results: enrichedResults },
    stages: {
      dataforseo: { status: "complete", actualCostUsd: dataForSeoActualCostUsd },
      intent: { status: "complete", model: BYOK_COMPARE_MODEL },
    },
    cost: {
      estimatedCostUsd: BYOK_COMPARE_ESTIMATED_COST_USD,
      dataForSeoActualCostUsd,
      openRouterActualCostUsd,
    },
  };
  try {
    await setCache(cacheKey, finalData, {
      namespace: "byok-compare", scope: { type: "private", ownerId: input.ownerId },
      ttlHours: 24, allowLegacyRead: false,
    });
  } catch { return failJob("PRIVATE_CACHE_WRITE_FAILED"); }
  const completed = await completeOwnedByokJob({
    id: record.job.id, userId: input.ownerId, claimToken: claim.token, resultCacheKey: cacheKey,
  }).catch(() => false);
  if (!completed) return fail("JOB_PERSISTENCE_ERROR");
  return { jobId: record.job.id, status: "complete", providerRequestState: "completed", data: finalData };
};

export const getOwnedByokCompareResult = async (ownerId: string, jobId: string) => {
  if (!ownerId || !jobId) return fail("INVALID_INPUT");
  const job = await getOwnedJob(jobId, ownerId, "compare").catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!job) return fail("JOB_PERSISTENCE_ERROR");
  return publicResult(ownerId, job);
};

const loadPartialBase = async (ownerId: string, baseJobId: string) => {
  const job = await getOwnedJob(baseJobId, ownerId, "compare")
    .catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!job || job.execution_mode !== "byok" || job.credential_source !== "user"
    || job.status !== "complete" || !job.result_cache_key) return fail("CONNECTION_NOT_FOUND");
  const data = await getCached<ByokCompareData>(job.result_cache_key, {
    namespace: "byok-compare", scope: { type: "private", ownerId }, allowLegacyRead: false,
  }).catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!data || !data.partialSuccess || data.stages.dataforseo.status !== "complete"
    || data.stages.intent.status !== "failed") return fail("INVALID_INPUT");
  return { job, data };
};

export type ByokCompareIntentRetryRequest = Readonly<{
  baseJobId: string;
  retryToken: string;
}>;

const buildIntentRetryHash = (input: Readonly<{
  ownerId: string;
  openRouterConnectionId: string;
  openRouterConnectionVersion: number;
  request: ByokCompareIntentRetryRequest;
  baseData: ByokCompareData;
}>) => createHash("sha256").update(JSON.stringify({
  capability: "compare-intent-retry",
  version: CAPABILITY_VERSION,
  ownerId: input.ownerId,
  openRouter: [input.openRouterConnectionId, input.openRouterConnectionVersion],
  request: input.request,
  baseDigest: createHash("sha256").update(JSON.stringify(input.baseData.comparison)).digest("hex"),
  model: BYOK_COMPARE_MODEL,
})).digest("hex");

export const quoteByokCompareIntentRetry = async (input: Readonly<{
  ownerId: string;
  baseJobId: string;
  openRouterConnectionId: string;
  openRouterConnectionVersion: number;
  clientRequestId: string;
  now?: Date;
}>) => {
  await loadConnection({
    ownerId: input.ownerId, connectionId: input.openRouterConnectionId,
    expectedVersion: input.openRouterConnectionVersion, provider: "openrouter",
  });
  const base = await loadPartialBase(input.ownerId, input.baseJobId);
  if (!input.clientRequestId || input.clientRequestId.length > 120) return fail("INVALID_INPUT");
  const request: ByokCompareIntentRetryRequest = {
    baseJobId: input.baseJobId,
    retryToken: input.clientRequestId,
  };
  const requestHash = buildIntentRetryHash({ ...input, request, baseData: base.data });
  const quote = await createByokCostQuote({
    ownerId: input.ownerId,
    capability: "compare",
    requestHash,
    idempotencyKey: `compare-intent:${input.clientRequestId}`,
    estimatedCostUsd: BYOK_COMPARE_OPENROUTER_ESTIMATE_USD,
    now: input.now,
  });
  return { quote, request, requestHash };
};

export const executeByokCompareIntentRetry = async (input: Readonly<{
  ownerId: string;
  openRouterConnectionId: string;
  openRouterConnectionVersion: number;
  request: ByokCompareIntentRetryRequest;
  quoteId: string;
  requestHash: string;
  confirmedEstimatedCostUsd: number;
  confirmation: "CONFIRM";
  decryptionKeys: ProviderCredentialDecryptionKeys;
  openRouterClientFactory?: (apiKey: string) => ChatCompletionClient;
}>): Promise<ByokCompareResult> => {
  if (!input.request.baseJobId || !input.request.retryToken) return fail("INVALID_INPUT");
  const connection = await loadConnection({
    ownerId: input.ownerId, connectionId: input.openRouterConnectionId,
    expectedVersion: input.openRouterConnectionVersion, provider: "openrouter",
  });
  const base = await loadPartialBase(input.ownerId, input.request.baseJobId);
  const expectedHash = buildIntentRetryHash({ ...input, baseData: base.data });
  if (expectedHash !== input.requestHash) return fail("INVALID_INPUT");

  let apiKey: string;
  try {
    const value = await decryptProviderCredential(
      { ownerId: input.ownerId, connectionId: input.openRouterConnectionId, provider: "openrouter" },
      connection.envelope, input.decryptionKeys,
    );
    if (Object.keys(value).length !== 1 || !value.apiKey) throw new Error("shape");
    apiKey = value.apiKey;
  } catch { return fail("CREDENTIAL_UNAVAILABLE"); }

  const existing = await getOwnedByokJobByIdempotency({
    userId: input.ownerId, jobType: "compare_intent", idempotencyKey: expectedHash,
  }).catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (existing && existing.status !== "pending") return publicResult(input.ownerId, existing);
  try {
    await reserveConfirmedByokCostQuote({
      ownerId: input.ownerId, quoteId: input.quoteId, requestHash: expectedHash,
      confirmedEstimatedCostUsd: input.confirmedEstimatedCostUsd, confirmation: input.confirmation,
    });
  } catch (error) {
    if (error instanceof ByokSpendControlError) throw error;
    return fail("SPEND_RESERVATION_FAILED");
  }
  let record;
  try {
    record = await createOrGetOwnedByokJob({
      userId: input.ownerId, jobType: "compare_intent",
      payload: { request: input.request, capabilityVersion: CAPABILITY_VERSION },
      idempotencyKey: expectedHash,
      providerConnectionId: input.openRouterConnectionId,
      providerConnectionVersion: input.openRouterConnectionVersion,
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
    ownerId: input.ownerId, quoteId: input.quoteId, researchJobId: record.job.id,
  }).catch(() => false);
  if (!committed) {
    await releaseByokCostReservation({ ownerId: input.ownerId, quoteId: input.quoteId }).catch(() => undefined);
    return fail("SPEND_RESERVATION_FAILED");
  }
  const claim = await claimOwnedByokJob({
    id: record.job.id, userId: input.ownerId, jobType: "compare_intent",
    providerConnectionId: input.openRouterConnectionId,
    providerConnectionVersion: input.openRouterConnectionVersion,
  }).catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!claim) return fail("JOB_PERSISTENCE_ERROR");
  const failRetry = async (code: ByokCompareErrorCode) => {
    await failOwnedByokJob({
      id: record.job.id, userId: input.ownerId, claimToken: claim.token, errorCode: code,
    }).catch(() => undefined);
    return fail(code);
  };

  const client = (input.openRouterClientFactory ?? ((key) => createOpenRouterClient(
    { apiKey: key }, { model: BYOK_COMPARE_MODEL },
  )))(apiKey);
  let response: unknown;
  try {
    response = await client.complete(intentPrompt(base.data.comparison.results), {
      maxRetries: 0, timeoutMs: 15_000,
    });
  } catch {
    try {
      await recordEvent({
        job: record.job, ownerId: input.ownerId, provider: "openrouter",
        endpoint: "chat/completions",
        eventKey: `byok:${record.job.id}:openrouter:compare-intent-retry:v1`,
        unitPriceUsd: BYOK_COMPARE_OPENROUTER_ESTIMATE_USD, actualCostUsd: null,
        outcome: "provider_error", metadata: {
          model: BYOK_COMPARE_MODEL, baseJobId: base.job.id,
          connectionVersion: input.openRouterConnectionVersion,
        },
      });
    } catch { return failRetry("COST_LEDGER_WRITE_FAILED"); }
    return failRetry("PROVIDER_FAILED");
  }
  let enriched: ComparisonResult[];
  try { enriched = enrichIntent(response, base.data.comparison.results); }
  catch {
    try {
      await recordEvent({
        job: record.job, ownerId: input.ownerId, provider: "openrouter",
        endpoint: "chat/completions",
        eventKey: `byok:${record.job.id}:openrouter:compare-intent-retry:v1`,
        unitPriceUsd: BYOK_COMPARE_OPENROUTER_ESTIMATE_USD,
        actualCostUsd: openRouterCost(response), outcome: "invalid_response",
        metadata: { model: BYOK_COMPARE_MODEL, baseJobId: base.job.id },
      });
    } catch { return failRetry("COST_LEDGER_WRITE_FAILED"); }
    return failRetry("PROVIDER_RESPONSE_INVALID");
  }
  const actualCostUsd = openRouterCost(response);
  try {
    await recordEvent({
      job: record.job, ownerId: input.ownerId, provider: "openrouter",
      endpoint: "chat/completions",
      eventKey: `byok:${record.job.id}:openrouter:compare-intent-retry:v1`,
      unitPriceUsd: BYOK_COMPARE_OPENROUTER_ESTIMATE_USD,
      actualCostUsd, outcome: "success",
      metadata: { model: BYOK_COMPARE_MODEL, baseJobId: base.job.id },
    });
  } catch { return failRetry("COST_LEDGER_WRITE_FAILED"); }
  const finalData: ByokCompareData = {
    ...base.data,
    phase: "complete",
    partialSuccess: false,
    comparison: { ...base.data.comparison, results: enriched },
    stages: {
      ...base.data.stages,
      intent: { status: "complete", model: BYOK_COMPARE_MODEL },
    },
    cost: { ...base.data.cost, openRouterActualCostUsd: actualCostUsd },
  };
  try {
    await setCache(base.job.result_cache_key!, finalData, {
      namespace: "byok-compare", scope: { type: "private", ownerId: input.ownerId },
      ttlHours: 24, allowLegacyRead: false,
    });
  } catch { return failRetry("PRIVATE_CACHE_WRITE_FAILED"); }
  const completed = await completeOwnedByokJob({
    id: record.job.id, userId: input.ownerId, claimToken: claim.token,
    resultCacheKey: base.job.result_cache_key!,
  }).catch(() => false);
  if (!completed) return fail("JOB_PERSISTENCE_ERROR");
  return { jobId: record.job.id, status: "complete", providerRequestState: "completed", data: finalData };
};
