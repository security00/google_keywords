import { beforeEach, describe, expect, test, vi } from "vitest";

import { getCached, setCache } from "@/lib/cache";
import {
  commitByokCostReservation,
  createByokCostQuote,
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
import {
  claimOwnedByokJob,
  completeOwnedByokJob,
  createOrGetOwnedByokJob,
  getOwnedByokJobByIdempotency,
} from "@/lib/research-jobs";
import {
  BYOK_TRENDS_ESTIMATED_COST_USD,
  buildByokTrendsRequestHash,
  executeByokTrends,
  quoteByokTrends,
} from "./trends";

vi.mock("@/lib/cache", () => ({ getCached: vi.fn(), setCache: vi.fn() }));
vi.mock("@/lib/byok/spend-controls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/byok/spend-controls")>();
  return {
    ...actual,
    commitByokCostReservation: vi.fn(),
    createByokCostQuote: vi.fn(),
    releaseByokCostReservation: vi.fn(),
    reserveConfirmedByokCostQuote: vi.fn(),
  };
});
vi.mock("@/lib/provider-connections/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/provider-connections/store")>();
  return { ...actual, loadProviderConnection: vi.fn() };
});
vi.mock("@/lib/pipelines/cost-ledger", () => ({ recordPipelineCostEvent: vi.fn() }));
vi.mock("@/lib/providers/dataforseo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/dataforseo")>()),
  getPlatformDataForSeoClient: vi.fn(),
}));
vi.mock("@/lib/research-jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/research-jobs")>();
  return {
    ...actual,
    claimOwnedByokJob: vi.fn(),
    completeOwnedByokJob: vi.fn(),
    createOrGetOwnedByokJob: vi.fn(),
    failOwnedByokJob: vi.fn(),
    getOwnedByokJobByIdempotency: vi.fn(),
    getOwnedJob: vi.fn(),
  };
});

const mockLoad = vi.mocked(loadProviderConnection);
const mockQuote = vi.mocked(createByokCostQuote);
const mockReserve = vi.mocked(reserveConfirmedByokCostQuote);
const mockCommitReservation = vi.mocked(commitByokCostReservation);
const mockExisting = vi.mocked(getOwnedByokJobByIdempotency);
const mockCreateJob = vi.mocked(createOrGetOwnedByokJob);
const mockClaim = vi.mocked(claimOwnedByokJob);
const mockComplete = vi.mocked(completeOwnedByokJob);
const mockCost = vi.mocked(recordPipelineCostEvent);
const mockPlatformClient = vi.mocked(getPlatformDataForSeoClient);
const mockSetCache = vi.mocked(setCache);
const mockGetCache = vi.mocked(getCached);

const keyBundle = async (): Promise<{
  encryption: ProviderCredentialEncryptionKeys;
  decryption: ProviderCredentialDecryptionKeys;
}> => {
  const kek = await crypto.subtle.generateKey(
    { name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"],
  );
  const fingerprintKey = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"],
  );
  return {
    encryption: {
      kekVersion: "v1", kek, fingerprintKeyVersion: "v1", fingerprintKey,
    },
    decryption: {
      resolveKek: (version) => version === "v1" ? kek : undefined,
      resolveFingerprintKey: (version) => version === "v1" ? fingerprintKey : undefined,
    },
  };
};

const connectionContext = {
  ownerId: "owner-1",
  connectionId: "connection-1",
  provider: "dataforseo" as const,
};

const storedConnection = async () => {
  const keys = await keyBundle();
  const envelope = await encryptProviderCredential(
    connectionContext,
    { login: "owner@example.com", password: "sensitive-password" },
    keys.encryption,
  );
  return {
    keys,
    connection: {
      ...connectionContext,
      label: "DataForSEO",
      credentialVersion: 1,
      maskedHint: "DataForSEO credential saved",
      verificationStatus: "valid" as const,
      verifiedAt: "2026-07-21T00:00:00.000Z",
      lastVerificationCode: "VERIFIED",
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
      envelope,
    },
  };
};

const request = {
  keyword: "ai resume builder",
  benchmark: "gpts",
  dateFrom: "2026-04-22",
  dateTo: "2026-07-21",
};

const job = (idempotencyKey: string) => ({
  id: "job-1",
  user_id: "owner-1",
  job_type: "trends" as const,
  status: "pending" as const,
  task_ids: [],
  payload: { request },
  session_id: null,
  error: null,
  execution_mode: "byok" as const,
  credential_source: "user" as const,
  idempotency_key: idempotencyKey,
  claim_token: null,
  lease_expires_at: null,
  attempt_count: 0,
  provider_connection_id: "connection-1",
  provider_connection_version: 1,
  provider_request_state: "not_started" as const,
  result_cache_key: null,
  created_at: "2026-07-21T00:00:00.000Z",
  updated_at: "2026-07-21T00:00:00.000Z",
});

describe("BYOK Trends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExisting.mockResolvedValue(null);
    mockReserve.mockResolvedValue({
      quoteId: "quote-1",
      capability: "trends",
      estimatedCostUsd: BYOK_TRENDS_ESTIMATED_COST_USD,
      status: "reserved",
      expiresAt: "2026-07-21T08:10:00.000Z",
      reservationExpiresAt: "2026-07-21T08:15:00.000Z",
    });
    mockCommitReservation.mockResolvedValue(true);
    mockClaim.mockResolvedValue({ token: "claim-1", leaseExpiresAt: "now" });
    mockComplete.mockResolvedValue(true);
    mockCost.mockResolvedValue({ inserted: true });
    mockSetCache.mockResolvedValue();
  });

  test("quotes the fixed official live-task price and binds owner connection version", async () => {
    const { connection } = await storedConnection();
    mockLoad.mockResolvedValue(connection);
    mockQuote.mockResolvedValue({
      quoteId: "quote-1",
      capability: "trends",
      estimatedCostUsd: BYOK_TRENDS_ESTIMATED_COST_USD,
      status: "quoted",
      expiresAt: "2026-07-21T08:10:00.000Z",
      reservationExpiresAt: null,
    });

    const result = await quoteByokTrends({
      ownerId: "owner-1",
      connectionId: "connection-1",
      expectedConnectionVersion: 1,
      clientRequestId: "request-1234",
      keyword: "ai resume builder",
      days: 90,
      now: new Date("2026-07-21T08:00:00.000Z"),
    });

    expect(result.request).toEqual(request);
    expect(mockQuote).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-1",
      capability: "trends",
      estimatedCostUsd: 0.011,
    }));
  });

  test("executes with only the decrypted user client and writes private/cache cost attribution", async () => {
    const { keys, connection } = await storedConnection();
    mockLoad.mockResolvedValue(connection);
    const requestHash = buildByokTrendsRequestHash({
      ownerId: "owner-1",
      connectionId: "connection-1",
      connectionVersion: 1,
      request,
    });
    mockCreateJob.mockResolvedValue({ job: job(requestHash), created: true });
    const providerRequest = vi.fn().mockResolvedValue({
      cost: 0.011,
      tasks: [{ result: [{ items: [{
        type: "google_trends_graph",
        keywords: ["ai resume builder", "gpts"],
        data: [{ date_from: "2026-07-20", values: [80, 40] }],
      }] }] }],
    });
    const clientFactory = vi.fn().mockReturnValue({
      provider: "dataforseo",
      request: providerRequest,
    });

    const result = await executeByokTrends({
      ownerId: "owner-1",
      connectionId: "connection-1",
      expectedConnectionVersion: 1,
      request,
      quoteId: "quote-1",
      requestHash,
      confirmedEstimatedCostUsd: 0.011,
      confirmation: "CONFIRM",
      decryptionKeys: keys.decryption,
      clientFactory,
    });

    expect(result.status).toBe("complete");
    expect(clientFactory).toHaveBeenCalledWith({
      login: "owner@example.com",
      password: "sensitive-password",
    });
    expect(mockPlatformClient).not.toHaveBeenCalled();
    expect(providerRequest).toHaveBeenCalledWith(
      "post",
      "/keywords_data/google_trends/explore/live",
      expect.any(Object),
      0,
      40_000,
    );
    expect(mockReserve).toHaveBeenCalledWith(expect.objectContaining({
      confirmation: "CONFIRM",
      confirmedEstimatedCostUsd: 0.011,
    }));
    expect(mockCost).toHaveBeenCalledWith(expect.objectContaining({
      credentialSource: "user",
      executionMode: "byok",
      ownerId: "owner-1",
      actualCostUsd: 0.011,
    }));
    expect(mockSetCache).toHaveBeenCalledWith(
      "byok-trends:v1:job-1",
      expect.any(Object),
      expect.objectContaining({
        namespace: "byok-trends",
        scope: { type: "private", ownerId: "owner-1" },
        allowLegacyRead: false,
      }),
    );
  });

  test("returns an existing private result without reserving or calling Provider again", async () => {
    const { keys, connection } = await storedConnection();
    mockLoad.mockResolvedValue(connection);
    const requestHash = buildByokTrendsRequestHash({
      ownerId: "owner-1", connectionId: "connection-1", connectionVersion: 1, request,
    });
    mockExisting.mockResolvedValue({
      ...job(requestHash),
      status: "complete",
      provider_request_state: "completed",
      result_cache_key: "byok-trends:v1:job-1",
    });
    mockGetCache.mockResolvedValue({
      ...request,
      series: [{ date: "2026-07-20", value: 80 }],
      benchmarkSeries: [{ date: "2026-07-20", value: 40 }],
      cost: { estimatedCostUsd: 0.011, actualCostUsd: 0.011 },
    });
    const clientFactory = vi.fn();

    const result = await executeByokTrends({
      ownerId: "owner-1", connectionId: "connection-1",
      expectedConnectionVersion: 1, request, quoteId: "quote-2", requestHash,
      confirmedEstimatedCostUsd: 0.011, confirmation: "CONFIRM",
      decryptionKeys: keys.decryption, clientFactory,
    });

    expect(result.status).toBe("complete");
    expect(mockReserve).not.toHaveBeenCalled();
    expect(clientFactory).not.toHaveBeenCalled();
  });
});
