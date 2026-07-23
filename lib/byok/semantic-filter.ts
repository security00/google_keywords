import "server-only";

import { createHash } from "crypto";

import { getCached, setCache } from "@/lib/cache";
import {
  decryptProviderCredential,
  type ProviderCredentialDecryptionKeys,
} from "@/lib/provider-connections/credential-crypto";
import { loadProviderConnection } from "@/lib/provider-connections/store";
import { recordPipelineCostEvent } from "@/lib/pipelines/cost-ledger";
import { createByokOpenRouterClient } from "@/lib/byok/provider-clients";
import { extractChatResponseText, extractJsonObject } from "@/lib/providers/chat-response";
import type { ChatCompletionClient } from "@/lib/providers/llm";
import {
  claimOwnedByokJob,
  completeOwnedByokJob,
  createOrGetOwnedByokJob,
  failOwnedByokJob,
  getOwnedJob,
  type ResearchJob,
} from "@/lib/research-jobs";

const CAPABILITY_VERSION = 1;
export const BYOK_SEMANTIC_FILTER_MODEL = "google/gemini-2.5-flash-lite";
// Conservative fallback for one bounded request of at most 20 keywords. When
// OpenRouter returns usage.cost, the ledger records that actual value instead.
export const BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD = 0.001;
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 120;

export type SemanticFilterDecision = Readonly<{
  keyword: string;
  decision: "keep" | "block";
  reason: string;
}>;

export type ByokSemanticFilterResult = Readonly<{
  jobId: string;
  status: "pending" | "complete" | "failed";
  providerRequestState: ResearchJob["provider_request_state"];
  results?: readonly SemanticFilterDecision[];
  errorCode?: string;
}>;

export type ByokSemanticFilterErrorCode =
  | "INVALID_INPUT"
  | "CONNECTION_NOT_FOUND"
  | "CONNECTION_VERSION_CONFLICT"
  | "CONNECTION_NOT_VERIFIED"
  | "CREDENTIAL_UNAVAILABLE"
  | "JOB_PERSISTENCE_ERROR"
  | "PROVIDER_FAILED"
  | "PROVIDER_RESPONSE_INVALID"
  | "COST_LEDGER_WRITE_FAILED"
  | "PRIVATE_CACHE_WRITE_FAILED";

export class ByokSemanticFilterError extends Error {
  readonly code: ByokSemanticFilterErrorCode;

  constructor(code: ByokSemanticFilterErrorCode) {
    super(code);
    this.name = "ByokSemanticFilterError";
    this.code = code;
  }
}

const fail = (code: ByokSemanticFilterErrorCode): never => {
  throw new ByokSemanticFilterError(code);
};

const normalizeKeywords = (input: readonly string[]) => {
  if (!Array.isArray(input)) fail("INVALID_INPUT");
  const unique = new Map<string, string>();
  for (const raw of input) {
    if (typeof raw !== "string") fail("INVALID_INPUT");
    const keyword = raw.trim().replace(/\s+/g, " ");
    if (!keyword || keyword.length > MAX_KEYWORD_LENGTH) fail("INVALID_INPUT");
    const key = keyword.toLocaleLowerCase("en-US");
    if (!unique.has(key)) unique.set(key, keyword);
  }
  const keywords = [...unique.values()];
  if (keywords.length === 0 || keywords.length > MAX_KEYWORDS) fail("INVALID_INPUT");
  return keywords;
};

const requestKey = (input: Readonly<{
  ownerId: string;
  connectionId: string;
  connectionVersion: number;
  keywords: readonly string[];
}>) => createHash("sha256").update(JSON.stringify({
  capability: "semantic-filter",
  version: CAPABILITY_VERSION,
  ownerId: input.ownerId,
  connectionId: input.connectionId,
  connectionVersion: input.connectionVersion,
  keywords: input.keywords.map((value) => value.toLocaleLowerCase("en-US")).sort(),
})).digest("hex");

const cacheKeyForJob = (jobId: string) => `byok-semantic-filter:v1:${jobId}`;

const parseDecisions = (
  response: unknown,
  keywords: readonly string[],
): SemanticFilterDecision[] => {
  const parsed = extractJsonObject(extractChatResponseText(response));
  const items = Array.isArray(parsed?.items) ? parsed.items : null;
  if (!items) return fail("PROVIDER_RESPONSE_INVALID");
  const expected = new Map(
    keywords.map((keyword) => [keyword.toLocaleLowerCase("en-US"), keyword]),
  );
  const decisions = new Map<string, SemanticFilterDecision>();
  for (const item of items) {
    const keyword = typeof item?.keyword === "string" ? item.keyword.trim() : "";
    const key = keyword.toLocaleLowerCase("en-US");
    const original = expected.get(key);
    if (
      !original
      || decisions.has(key)
      || (item?.decision !== "keep" && item?.decision !== "block")
      || typeof item?.reason !== "string"
      || !item.reason.trim()
      || item.reason.length > 240
    ) {
      return fail("PROVIDER_RESPONSE_INVALID");
    }
    decisions.set(key, {
      keyword: original,
      decision: item.decision,
      reason: item.reason.trim(),
    });
  }
  if (decisions.size !== expected.size) return fail("PROVIDER_RESPONSE_INVALID");
  return keywords.map((keyword) => decisions.get(
    keyword.toLocaleLowerCase("en-US"),
  ) as SemanticFilterDecision);
};

const promptFor = (keywords: readonly string[]) => ({
  temperature: 0,
  max_tokens: 900,
  messages: [
    {
      role: "system" as const,
      content: [
        "You classify keyword ideas for an overseas product-opportunity workflow.",
        "Keep durable, buildable tool/SaaS/utility demand.",
        "Block short-lived news, celebrity, sports, piracy, gambling, navigation and non-product noise.",
        "Return strict JSON only and classify every supplied keyword exactly once.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        keywords,
        output: {
          items: [{ keyword: "", decision: "keep|block", reason: "" }],
        },
      }),
    },
  ],
});

const openRouterCost = (response: unknown) => {
  if (!response || typeof response !== "object") return null;
  const usage = (response as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const cost = (usage as { cost?: unknown }).cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? cost
    : null;
};

const publicJobResult = async (
  ownerId: string,
  job: ResearchJob,
): Promise<ByokSemanticFilterResult> => {
  if (job.status === "complete" && job.result_cache_key) {
    const cached = await getCached<readonly SemanticFilterDecision[]>(
      job.result_cache_key,
      {
        namespace: "byok-semantic-filter",
        scope: { type: "private", ownerId },
        allowLegacyRead: false,
      },
    );
    if (!cached) return fail("PRIVATE_CACHE_WRITE_FAILED");
    return {
      jobId: job.id,
      status: "complete",
      providerRequestState: job.provider_request_state,
      results: cached,
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
  errorCode: ByokSemanticFilterErrorCode,
) => {
  try {
    await failOwnedByokJob({
      id: job.id,
      userId: job.user_id,
      claimToken,
      errorCode,
    });
  } catch {
    // The irreversible `started` checkpoint still prevents an automatic re-call.
  }
};

export const executeByokSemanticFilter = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedConnectionVersion: number;
  keywords: readonly string[];
  decryptionKeys: ProviderCredentialDecryptionKeys;
  clientFactory?: (apiKey: string) => ChatCompletionClient;
}>): Promise<ByokSemanticFilterResult> => {
  if (
    !input.ownerId
    || !input.connectionId
    || !Number.isInteger(input.expectedConnectionVersion)
    || input.expectedConnectionVersion < 1
  ) {
    return fail("INVALID_INPUT");
  }
  const keywords = normalizeKeywords(input.keywords);
  const connection = await loadProviderConnection(input.ownerId, input.connectionId)
    .catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!connection || connection.provider !== "openrouter") {
    return fail("CONNECTION_NOT_FOUND");
  }
  if (connection.credentialVersion !== input.expectedConnectionVersion) {
    return fail("CONNECTION_VERSION_CONFLICT");
  }
  if (connection.verificationStatus !== "valid") {
    return fail("CONNECTION_NOT_VERIFIED");
  }

  let jobRecord;
  try {
    jobRecord = await createOrGetOwnedByokJob({
      userId: input.ownerId,
      jobType: "semantic_filter",
      payload: { keywords, capabilityVersion: CAPABILITY_VERSION },
      idempotencyKey: requestKey({
        ownerId: input.ownerId,
        connectionId: input.connectionId,
        connectionVersion: input.expectedConnectionVersion,
        keywords,
      }),
      providerConnectionId: input.connectionId,
      providerConnectionVersion: input.expectedConnectionVersion,
    });
  } catch {
    return fail("JOB_PERSISTENCE_ERROR");
  }
  if (jobRecord.job.status !== "pending") {
    return publicJobResult(input.ownerId, jobRecord.job);
  }

  const claim = await claimOwnedByokJob({
    id: jobRecord.job.id,
    userId: input.ownerId,
    jobType: "semantic_filter",
    providerConnectionId: input.connectionId,
    providerConnectionVersion: input.expectedConnectionVersion,
  }).catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!claim) {
    const current = await getOwnedJob(jobRecord.job.id, input.ownerId, "semantic_filter")
      .catch(() => fail("JOB_PERSISTENCE_ERROR"));
    return current
      ? publicJobResult(input.ownerId, current)
      : fail("JOB_PERSISTENCE_ERROR");
  }

  let apiKey: string;
  try {
    const credential = await decryptProviderCredential(
      {
        ownerId: input.ownerId,
        connectionId: input.connectionId,
        provider: "openrouter",
      },
      connection.envelope,
      input.decryptionKeys,
    );
    if (Object.keys(credential).length !== 1 || !credential.apiKey) {
      throw new Error("credential shape");
    }
    apiKey = credential.apiKey;
  } catch {
    await markFailed(jobRecord.job, claim.token, "CREDENTIAL_UNAVAILABLE");
    return fail("CREDENTIAL_UNAVAILABLE");
  }

  const client = (input.clientFactory ?? ((key) => createByokOpenRouterClient(
    { apiKey: key },
    { model: BYOK_SEMANTIC_FILTER_MODEL },
  )))(apiKey);
  let response: unknown;
  try {
    response = await client.complete(promptFor(keywords), {
      maxRetries: 0,
      timeoutMs: 15_000,
    });
  } catch {
    try {
      await recordPipelineCostEvent({
        runId: jobRecord.job.id,
        pipeline: "byok-semantic-filter",
        provider: "openrouter",
        endpoint: "chat/completions",
        unitType: "request_attempt",
        unitCount: 1,
        unitPriceUsd: BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD,
        researchJobId: jobRecord.job.id,
        eventKey: `byok:${jobRecord.job.id}:openrouter:semantic-filter:v1`,
        idempotencyKey: jobRecord.job.idempotency_key,
        credentialSource: "user",
        executionMode: "byok",
        ownerId: input.ownerId,
        metadata: {
          outcome: "provider_error",
          model: client.model,
          connectionVersion: input.expectedConnectionVersion,
        },
      });
    } catch {
      await markFailed(jobRecord.job, claim.token, "COST_LEDGER_WRITE_FAILED");
      return fail("COST_LEDGER_WRITE_FAILED");
    }
    await markFailed(jobRecord.job, claim.token, "PROVIDER_FAILED");
    return fail("PROVIDER_FAILED");
  }

  let results: SemanticFilterDecision[];
  try {
    results = parseDecisions(response, keywords);
  } catch {
    try {
      await recordPipelineCostEvent({
        runId: jobRecord.job.id,
        pipeline: "byok-semantic-filter",
        provider: "openrouter",
        endpoint: "chat/completions",
        unitType: "request",
        unitCount: 1,
        unitPriceUsd: BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD,
        actualCostUsd: openRouterCost(response),
        researchJobId: jobRecord.job.id,
        eventKey: `byok:${jobRecord.job.id}:openrouter:semantic-filter:v1`,
        idempotencyKey: jobRecord.job.idempotency_key,
        credentialSource: "user",
        executionMode: "byok",
        ownerId: input.ownerId,
        metadata: { outcome: "invalid_response", model: client.model },
      });
    } catch {
      await markFailed(jobRecord.job, claim.token, "COST_LEDGER_WRITE_FAILED");
      return fail("COST_LEDGER_WRITE_FAILED");
    }
    await markFailed(jobRecord.job, claim.token, "PROVIDER_RESPONSE_INVALID");
    return fail("PROVIDER_RESPONSE_INVALID");
  }

  try {
    await recordPipelineCostEvent({
      runId: jobRecord.job.id,
      pipeline: "byok-semantic-filter",
      provider: "openrouter",
      endpoint: "chat/completions",
      unitType: "request",
      unitCount: 1,
      unitPriceUsd: BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD,
      actualCostUsd: openRouterCost(response),
      researchJobId: jobRecord.job.id,
      eventKey: `byok:${jobRecord.job.id}:openrouter:semantic-filter:v1`,
      idempotencyKey: jobRecord.job.idempotency_key,
      credentialSource: "user",
      executionMode: "byok",
      ownerId: input.ownerId,
      metadata: {
        outcome: "success",
        model: client.model,
        connectionVersion: input.expectedConnectionVersion,
      },
    });
  } catch {
    await markFailed(jobRecord.job, claim.token, "COST_LEDGER_WRITE_FAILED");
    return fail("COST_LEDGER_WRITE_FAILED");
  }

  const resultCacheKey = cacheKeyForJob(jobRecord.job.id);
  try {
    await setCache(resultCacheKey, results, {
      namespace: "byok-semantic-filter",
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
    results,
  };
};

export const getOwnedByokSemanticFilterResult = async (
  ownerId: string,
  jobId: string,
) => {
  if (!ownerId || !jobId) return fail("INVALID_INPUT");
  const job = await getOwnedJob(jobId, ownerId, "semantic_filter")
    .catch(() => fail("JOB_PERSISTENCE_ERROR"));
  if (!job || job.execution_mode !== "byok" || job.credential_source !== "user") {
    return fail("CONNECTION_NOT_FOUND");
  }
  return publicJobResult(ownerId, job);
};
