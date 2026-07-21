import { beforeEach, describe, expect, test, vi } from "vitest";

import { getCached, setCache } from "@/lib/cache";
import {
  commitByokCostReservation, createByokCostQuote, releaseByokCostReservation,
  reserveConfirmedByokCostQuote,
} from "@/lib/byok/spend-controls";
import {
  encryptProviderCredential,
  type ProviderCredentialDecryptionKeys,
  type ProviderCredentialEncryptionKeys,
} from "@/lib/provider-connections/credential-crypto";
import { loadProviderConnection } from "@/lib/provider-connections/store";
import { recordPipelineCostEvent } from "@/lib/pipelines/cost-ledger";
import { getPlatformDataForSeoClient } from "@/lib/providers/dataforseo";
import { getPlatformOpenRouterClient } from "@/lib/providers/openrouter";
import {
  claimOwnedByokJob, completeOwnedByokJob, createOrGetOwnedByokJob,
  getOwnedByokJobByIdempotency, getOwnedJob,
} from "@/lib/research-jobs";
import {
  buildByokCompareRequestHash, executeByokCompare, executeByokCompareIntentRetry,
  getOwnedByokCompareResult, quoteByokCompare, quoteByokCompareIntentRetry,
} from "./compare";

vi.mock("@/lib/cache", () => ({ getCached: vi.fn(), setCache: vi.fn() }));
vi.mock("@/lib/byok/spend-controls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/spend-controls")>()),
  commitByokCostReservation: vi.fn(), createByokCostQuote: vi.fn(),
  releaseByokCostReservation: vi.fn(), reserveConfirmedByokCostQuote: vi.fn(),
}));
vi.mock("@/lib/provider-connections/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-connections/store")>()),
  loadProviderConnection: vi.fn(),
}));
vi.mock("@/lib/pipelines/cost-ledger", () => ({ recordPipelineCostEvent: vi.fn() }));
vi.mock("@/lib/providers/dataforseo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/dataforseo")>()),
  getPlatformDataForSeoClient: vi.fn(),
}));
vi.mock("@/lib/providers/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/openrouter")>()),
  getPlatformOpenRouterClient: vi.fn(),
}));
vi.mock("@/lib/research-jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/research-jobs")>()),
  claimOwnedByokJob: vi.fn(), completeOwnedByokJob: vi.fn(),
  createOrGetOwnedByokJob: vi.fn(), failOwnedByokJob: vi.fn(),
  getOwnedByokJobByIdempotency: vi.fn(), getOwnedJob: vi.fn(),
}));

const mockLoad = vi.mocked(loadProviderConnection);
const mockQuote = vi.mocked(createByokCostQuote);
const mockReserve = vi.mocked(reserveConfirmedByokCostQuote);
const mockCommit = vi.mocked(commitByokCostReservation);
const mockRelease = vi.mocked(releaseByokCostReservation);
const mockExisting = vi.mocked(getOwnedByokJobByIdempotency);
const mockCreate = vi.mocked(createOrGetOwnedByokJob);
const mockClaim = vi.mocked(claimOwnedByokJob);
const mockComplete = vi.mocked(completeOwnedByokJob);
const mockCost = vi.mocked(recordPipelineCostEvent);
const mockCache = vi.mocked(setCache);
const mockGetCached = vi.mocked(getCached);
const mockGetJob = vi.mocked(getOwnedJob);
const mockPlatformDataForSeo = vi.mocked(getPlatformDataForSeoClient);
const mockPlatformOpenRouter = vi.mocked(getPlatformOpenRouterClient);

const keys = async (): Promise<{
  encryption: ProviderCredentialEncryptionKeys;
  decryption: ProviderCredentialDecryptionKeys;
}> => {
  const kek = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
  const fingerprintKey = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"],
  );
  return {
    encryption: { kekVersion: "v1", kek, fingerprintKeyVersion: "v1", fingerprintKey },
    decryption: {
      resolveKek: (version) => version === "v1" ? kek : undefined,
      resolveFingerprintKey: (version) => version === "v1" ? fingerprintKey : undefined,
    },
  };
};

const stored = async () => {
  const bundle = await keys();
  const base = {
    ownerId: "owner-1", credentialVersion: 1, verificationStatus: "valid" as const,
    verifiedAt: "now", lastVerificationCode: "VERIFIED", createdAt: "now", updatedAt: "now",
  };
  const dataForSeoContext = {
    ownerId: "owner-1", connectionId: "dataforseo-1", provider: "dataforseo" as const,
  };
  const openRouterContext = {
    ownerId: "owner-1", connectionId: "openrouter-1", provider: "openrouter" as const,
  };
  return {
    bundle,
    dataForSeo: {
      ...base, ...dataForSeoContext, label: "DataForSEO", maskedHint: "DataForSEO credential saved",
      envelope: await encryptProviderCredential(
        dataForSeoContext, { login: "owner@example.com", password: "secret" }, bundle.encryption,
      ),
    },
    openRouter: {
      ...base, ...openRouterContext, label: "OpenRouter", maskedHint: "sk-or-...",
      envelope: await encryptProviderCredential(
        openRouterContext, { apiKey: "sk-or-user" }, bundle.encryption,
      ),
    },
  };
};

const comparisonResponse = () => ({
  status_code: 20000,
  cost: 0.011,
  tasks: [{
    status_code: 20000,
    result: [{
      keywords: ["ai resume builder", "gpts"],
      items: [{
        type: "google_trends_graph",
        data: Array.from({ length: 12 }, (_, index) => ({
          timestamp: 1_700_000_000 + index * 86_400,
          values: [index * 7 + 10, 40],
        })),
      }],
    }],
  }],
});

describe("BYOK Compare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExisting.mockResolvedValue(null);
    mockReserve.mockResolvedValue({
      quoteId: "quote-1", capability: "compare", estimatedCostUsd: 0.012,
      status: "reserved", expiresAt: "later", reservationExpiresAt: "later",
    });
    mockCommit.mockResolvedValue(true);
    mockRelease.mockResolvedValue(true);
    mockClaim.mockResolvedValue({ token: "claim-1", leaseExpiresAt: "later" });
    mockComplete.mockResolvedValue(true);
    mockCost.mockResolvedValue({ inserted: true });
    mockCache.mockResolvedValue();
  });

  test("quotes the bounded dual-provider request without decrypting or executing", async () => {
    const connections = await stored();
    mockLoad.mockImplementation(async (_ownerId, id) => id === "dataforseo-1"
      ? connections.dataForSeo : connections.openRouter);
    mockQuote.mockResolvedValue({
      quoteId: "quote-1", capability: "compare", estimatedCostUsd: 0.012,
      status: "quoted", expiresAt: "later", reservationExpiresAt: null,
    });
    const result = await quoteByokCompare({
      ownerId: "owner-1", dataForSeoConnectionId: "dataforseo-1",
      dataForSeoConnectionVersion: 1, openRouterConnectionId: "openrouter-1",
      openRouterConnectionVersion: 1, clientRequestId: "request-1",
      keywords: ["ai resume builder"], benchmark: "gpts", days: 90,
      now: new Date("2026-07-21T00:00:00.000Z"),
    });
    expect(result.quote.estimatedCostUsd).toBe(0.012);
    expect(mockPlatformDataForSeo).not.toHaveBeenCalled();
    expect(mockPlatformOpenRouter).not.toHaveBeenCalled();
  });

  test("returns durable Partial Success when LLM fails after paid Trends succeeds", async () => {
    const connections = await stored();
    mockLoad.mockImplementation(async (_ownerId, id) => id === "dataforseo-1"
      ? connections.dataForSeo : connections.openRouter);
    const request = {
      keywords: ["ai resume builder"], benchmark: "gpts",
      dateFrom: "2026-04-22", dateTo: "2026-07-21",
    };
    const requestHash = buildByokCompareRequestHash({
      ownerId: "owner-1", dataForSeoConnectionId: "dataforseo-1",
      dataForSeoConnectionVersion: 1, openRouterConnectionId: "openrouter-1",
      openRouterConnectionVersion: 1, request,
    });
    const job = {
      id: "job-1", user_id: "owner-1", job_type: "compare" as const, status: "pending" as const,
      task_ids: [], payload: { request }, session_id: null, error: null,
      execution_mode: "byok" as const, credential_source: "user" as const,
      idempotency_key: requestHash, claim_token: null, lease_expires_at: null, attempt_count: 0,
      provider_connection_id: "dataforseo-1", provider_connection_version: 1,
      provider_request_state: "not_started" as const, result_cache_key: null,
      created_at: "now", updated_at: "now",
    };
    mockCreate.mockResolvedValue({ job, created: true });
    const dataForSeoRequest = vi.fn().mockResolvedValue(comparisonResponse());
    const openRouterComplete = vi.fn().mockRejectedValue(new Error("temporary"));

    const result = await executeByokCompare({
      ownerId: "owner-1", dataForSeoConnectionId: "dataforseo-1",
      dataForSeoConnectionVersion: 1, openRouterConnectionId: "openrouter-1",
      openRouterConnectionVersion: 1, request, quoteId: "quote-1", requestHash,
      confirmedEstimatedCostUsd: 0.012, confirmation: "CONFIRM",
      decryptionKeys: connections.bundle.decryption,
      dataForSeoClientFactory: vi.fn().mockReturnValue({ provider: "dataforseo", request: dataForSeoRequest }),
      openRouterClientFactory: vi.fn().mockReturnValue({
        provider: "openrouter", model: "google/gemini-2.5-flash-lite", complete: openRouterComplete,
      }),
    });

    expect(result.status).toBe("complete");
    expect(result.data).toMatchObject({
      phase: "partial", partialSuccess: true,
      stages: { dataforseo: { status: "complete" }, intent: { status: "failed", errorCode: "PROVIDER_FAILED" } },
    });
    expect(dataForSeoRequest).toHaveBeenCalledTimes(1);
    expect(openRouterComplete).toHaveBeenCalledTimes(1);
    expect(mockCache).toHaveBeenCalledTimes(2);
    expect(mockCache).toHaveBeenNthCalledWith(
      1, "byok-compare:v1:job-1", expect.objectContaining({ partialSuccess: true }),
      expect.objectContaining({
        namespace: "byok-compare", scope: { type: "private", ownerId: "owner-1" }, allowLegacyRead: false,
      }),
    );
    expect(mockCost).toHaveBeenCalledTimes(2);
    expect(mockPlatformDataForSeo).not.toHaveBeenCalled();
    expect(mockPlatformOpenRouter).not.toHaveBeenCalled();
  });

  test("retries only the failed intent stage with a new explicit quote", async () => {
    const connections = await stored();
    mockLoad.mockResolvedValue(connections.openRouter);
    const comparisonResult = {
      keyword: "ai resume builder", avgValue: 40, benchmarkValue: 30, ratio: 1.33,
      ratioMean: 1.33, ratioRecent: 1.4, ratioCoverage: 0.7, ratioPeak: 1.5,
      slopeDiff: 2, volatility: 0.2, crossings: 1, verdict: "pass" as const,
    };
    const baseData = {
      phase: "partial" as const, partialSuccess: true,
      comparison: {
        benchmark: "gpts", dateFrom: "2026-04-22", dateTo: "2026-07-21",
        results: [comparisonResult], summary: { strong: 0, pass: 1, close: 0, watch: 0, fail: 0 },
      },
      stages: {
        dataforseo: { status: "complete" as const, actualCostUsd: 0.011 },
        intent: {
          status: "failed" as const, model: "google/gemini-2.5-flash-lite",
          errorCode: "PROVIDER_FAILED" as const,
        },
      },
      cost: {
        estimatedCostUsd: 0.012, dataForSeoActualCostUsd: 0.011,
        openRouterActualCostUsd: null,
      },
    };
    const baseJob = {
      id: "base-job", user_id: "owner-1", job_type: "compare" as const, status: "complete" as const,
      task_ids: [], payload: {}, session_id: null, error: null,
      execution_mode: "byok" as const, credential_source: "user" as const,
      idempotency_key: "base-hash", claim_token: null, lease_expires_at: null, attempt_count: 1,
      provider_connection_id: "dataforseo-1", provider_connection_version: 1,
      provider_request_state: "completed" as const, result_cache_key: "byok-compare:v1:base-job",
      created_at: "now", updated_at: "now",
    };
    mockGetJob.mockResolvedValue(baseJob);
    mockGetCached.mockResolvedValue(baseData);
    mockQuote.mockResolvedValue({
      quoteId: "retry-quote", capability: "compare", estimatedCostUsd: 0.001,
      status: "quoted", expiresAt: "later", reservationExpiresAt: null,
    });
    const quoted = await quoteByokCompareIntentRetry({
      ownerId: "owner-1", baseJobId: "base-job", openRouterConnectionId: "openrouter-1",
      openRouterConnectionVersion: 1, clientRequestId: "retry-1",
    });
    expect(quoted.quote.estimatedCostUsd).toBe(0.001);

    const retryJob = {
      ...baseJob, id: "retry-job", job_type: "compare_intent" as const,
      status: "pending" as const, provider_request_state: "not_started" as const,
      result_cache_key: null, idempotency_key: quoted.requestHash,
      provider_connection_id: "openrouter-1",
    };
    mockCreate.mockResolvedValue({ job: retryJob, created: true });
    const complete = vi.fn().mockResolvedValue({
      usage: { cost: 0.0002 },
      choices: [{ message: { content: JSON.stringify({ intents: [{
        keyword: "ai resume builder", label: "AI Tools", demand: "Create resumes with AI",
        reason: "The rising comparison indicates active tool demand", confidence: 0.9,
      }] }) } }],
    });
    const result = await executeByokCompareIntentRetry({
      ownerId: "owner-1", openRouterConnectionId: "openrouter-1", openRouterConnectionVersion: 1,
      request: quoted.request, quoteId: "retry-quote", requestHash: quoted.requestHash,
      confirmedEstimatedCostUsd: 0.001, confirmation: "CONFIRM",
      decryptionKeys: connections.bundle.decryption,
      openRouterClientFactory: vi.fn().mockReturnValue({
        provider: "openrouter", model: "google/gemini-2.5-flash-lite", complete,
      }),
    });
    expect(result.data).toMatchObject({
      phase: "complete", partialSuccess: false,
      stages: { dataforseo: { status: "complete" }, intent: { status: "complete" } },
    });
    expect(mockCache).toHaveBeenLastCalledWith(
      "byok-compare:v1:base-job", expect.objectContaining({ partialSuccess: false }),
      expect.objectContaining({ namespace: "byok-compare" }),
    );
    expect(mockCost).toHaveBeenLastCalledWith(expect.objectContaining({
      provider: "openrouter", eventKey: "byok:retry-job:openrouter:compare-intent-retry:v1",
    }));
    expect(mockPlatformDataForSeo).not.toHaveBeenCalled();
    expect(mockPlatformOpenRouter).not.toHaveBeenCalled();
  });

  test("polls an in-flight intent retry through the compare result endpoint", async () => {
    const retryJob = {
      id: "retry-job", user_id: "owner-1", job_type: "compare_intent" as const,
      status: "processing" as const, task_ids: [], payload: {}, session_id: null, error: null,
      execution_mode: "byok" as const, credential_source: "user" as const,
      idempotency_key: "retry-hash", claim_token: "claim-1", lease_expires_at: "later",
      attempt_count: 1, provider_connection_id: "openrouter-1", provider_connection_version: 1,
      provider_request_state: "started" as const, result_cache_key: null,
      created_at: "now", updated_at: "now",
    };
    mockGetJob.mockResolvedValueOnce(null).mockResolvedValueOnce(retryJob);

    const result = await getOwnedByokCompareResult("owner-1", "retry-job");

    expect(result).toMatchObject({
      jobId: "retry-job", status: "pending", providerRequestState: "started",
    });
    expect(mockGetJob).toHaveBeenNthCalledWith(1, "retry-job", "owner-1", "compare");
    expect(mockGetJob).toHaveBeenNthCalledWith(2, "retry-job", "owner-1", "compare_intent");
  });
});
