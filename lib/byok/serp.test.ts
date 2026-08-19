import { beforeEach, describe, expect, test, vi } from "vitest";

import { setCache } from "@/lib/cache";
import {
  commitByokCostReservation,
  createByokCostQuote,
  releaseByokCostReservation,
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
  buildByokSerpRequestHash,
  executeByokSerp,
  quoteByokSerp,
} from "./serp";

vi.mock("@/lib/cache", () => ({ getCached: vi.fn(), setCache: vi.fn() }));
vi.mock("@/lib/byok/spend-controls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/spend-controls")>()),
  commitByokCostReservation: vi.fn(),
  createByokCostQuote: vi.fn(),
  releaseByokCostReservation: vi.fn(),
  reserveConfirmedByokCostQuote: vi.fn(),
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
vi.mock("@/lib/research-jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/research-jobs")>()),
  claimOwnedByokJob: vi.fn(),
  completeOwnedByokJob: vi.fn(),
  createOrGetOwnedByokJob: vi.fn(),
  failOwnedByokJob: vi.fn(),
  getOwnedByokJobByIdempotency: vi.fn(),
  getOwnedJob: vi.fn(),
  reclaimTimedOutOwnedByokJob: vi.fn(),
}));

const mockLoad = vi.mocked(loadProviderConnection);
const mockQuote = vi.mocked(createByokCostQuote);
const mockReserve = vi.mocked(reserveConfirmedByokCostQuote);
const mockCommit = vi.mocked(commitByokCostReservation);
const mockRelease = vi.mocked(releaseByokCostReservation);
const mockExisting = vi.mocked(getOwnedByokJobByIdempotency);
const mockCreateJob = vi.mocked(createOrGetOwnedByokJob);
const mockClaim = vi.mocked(claimOwnedByokJob);
const mockComplete = vi.mocked(completeOwnedByokJob);
const mockCost = vi.mocked(recordPipelineCostEvent);
const mockCache = vi.mocked(setCache);
const mockPlatform = vi.mocked(getPlatformDataForSeoClient);

const keys = async (): Promise<{
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
    encryption: { kekVersion: "v1", kek, fingerprintKeyVersion: "v1", fingerprintKey },
    decryption: {
      resolveKek: (version) => version === "v1" ? kek : undefined,
      resolveFingerprintKey: (version) => version === "v1" ? fingerprintKey : undefined,
    },
  };
};

const stored = async () => {
  const bundle = await keys();
  const context = { ownerId: "owner-1", connectionId: "connection-1", provider: "dataforseo" as const };
  const envelope = await encryptProviderCredential(
    context,
    { login: "owner@example.com", password: "sensitive-password" },
    bundle.encryption,
  );
  return {
    bundle,
    connection: {
      ...context,
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

describe("BYOK SERP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExisting.mockResolvedValue(null);
    mockReserve.mockResolvedValue({
      quoteId: "quote-1", capability: "serp", estimatedCostUsd: 0.002,
      status: "reserved", expiresAt: "later", reservationExpiresAt: "later",
    });
    mockCommit.mockResolvedValue(true);
    mockRelease.mockResolvedValue(true);
    mockClaim.mockResolvedValue({ token: "claim-1", leaseExpiresAt: "now" });
    mockComplete.mockResolvedValue(true);
    mockCost.mockResolvedValue({ inserted: true });
    mockCache.mockResolvedValue();
  });

  test("quotes a fixed one-page Live SERP without Provider execution", async () => {
    const { connection } = await stored();
    mockLoad.mockResolvedValue(connection);
    mockQuote.mockResolvedValue({
      quoteId: "quote-1", capability: "serp", estimatedCostUsd: 0.002,
      status: "quoted", expiresAt: "later", reservationExpiresAt: null,
    });

    const result = await quoteByokSerp({
      ownerId: "owner-1", connectionId: "connection-1", expectedConnectionVersion: 1,
      clientRequestId: "request-1234", keyword: "ai resume builder",
    });

    expect(result.quote.estimatedCostUsd).toBe(0.002);
    expect(mockQuote).toHaveBeenCalledWith(expect.objectContaining({ capability: "serp" }));
    expect(mockPlatform).not.toHaveBeenCalled();
  });

  test("uses only owner credentials and saves a sanitized private summary", async () => {
    const { bundle, connection } = await stored();
    mockLoad.mockResolvedValue(connection);
    const request = { keyword: "ai resume builder" };
    const requestHash = buildByokSerpRequestHash({
      ownerId: "owner-1", connectionId: "connection-1", connectionVersion: 1, request,
    });
    const job = {
      id: "job-1", user_id: "owner-1", job_type: "serp" as const,
      status: "pending" as const, task_ids: [], payload: { request }, session_id: null,
      error: null, execution_mode: "byok" as const, credential_source: "user" as const,
      idempotency_key: requestHash, claim_token: null, lease_expires_at: null,
      attempt_count: 0, provider_connection_id: "connection-1",
      provider_connection_version: 1, provider_request_state: "not_started" as const,
      result_cache_key: null, created_at: "now", updated_at: "now",
    };
    mockCreateJob.mockResolvedValue({ job, created: true });
    const providerRequest = vi.fn().mockResolvedValue({
      status_code: 20000,
      cost: 0.002,
      tasks: [{
        status_code: 20000,
        result: [{
          keyword: "ai resume builder",
          item_types: ["organic"],
          items: [{
            type: "organic", title: "AI Resume Builder", url: "https://example.com",
            domain: "example.com", description: "Create a resume",
          }],
        }],
      }],
    });
    const clientFactory = vi.fn().mockReturnValue({ provider: "dataforseo", request: providerRequest });

    const result = await executeByokSerp({
      ownerId: "owner-1", connectionId: "connection-1", expectedConnectionVersion: 1,
      request, quoteId: "quote-1", requestHash, confirmedEstimatedCostUsd: 0.002,
      confirmation: "CONFIRM", decryptionKeys: bundle.decryption, clientFactory,
    });

    expect(result.status).toBe("complete");
    expect(mockPlatform).not.toHaveBeenCalled();
    expect(providerRequest).toHaveBeenCalledWith(
      "post", "/serp/google/organic/live/advanced", expect.any(Object), 0, 20_000,
    );
    expect(mockCost).toHaveBeenCalledWith(expect.objectContaining({
      credentialSource: "user", executionMode: "byok", actualCostUsd: 0.002,
    }));
    expect(mockCache).toHaveBeenCalledWith(
      "byok-serp:v1:job-1",
      expect.objectContaining({ summary: expect.objectContaining({ keyword: "ai resume builder" }) }),
      expect.objectContaining({
        namespace: "byok-serp",
        scope: { type: "private", ownerId: "owner-1" },
        allowLegacyRead: false,
      }),
    );
  });

  test("releases the reservation when it cannot be committed to the job", async () => {
    const { bundle, connection } = await stored();
    mockLoad.mockResolvedValue(connection);
    const request = { keyword: "ai resume builder" };
    const requestHash = buildByokSerpRequestHash({
      ownerId: "owner-1", connectionId: "connection-1", connectionVersion: 1, request,
    });
    mockCreateJob.mockResolvedValue({
      created: true,
      job: {
        id: "job-1", user_id: "owner-1", job_type: "serp", status: "pending",
        task_ids: [], payload: { request }, session_id: null, error: null,
        execution_mode: "byok", credential_source: "user", idempotency_key: requestHash,
        claim_token: null, lease_expires_at: null, attempt_count: 0,
        provider_connection_id: "connection-1", provider_connection_version: 1,
        provider_request_state: "not_started", result_cache_key: null,
        created_at: "now", updated_at: "now",
      },
    });
    mockCommit.mockResolvedValue(false);

    await expect(executeByokSerp({
      ownerId: "owner-1", connectionId: "connection-1", expectedConnectionVersion: 1,
      request, quoteId: "quote-1", requestHash, confirmedEstimatedCostUsd: 0.002,
      confirmation: "CONFIRM", decryptionKeys: bundle.decryption,
    })).rejects.toMatchObject({ code: "SPEND_RESERVATION_FAILED" });

    expect(mockRelease).toHaveBeenCalledWith({ ownerId: "owner-1", quoteId: "quote-1" });
    expect(mockClaim).not.toHaveBeenCalled();
  });
});
