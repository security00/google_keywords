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
  buildByokExpandRequestHash,
  executeByokExpand,
  quoteByokExpand,
} from "./expand";
import {
  claimOwnedByokJob,
  completeOwnedByokJob,
  createOrGetOwnedByokJob,
  getOwnedByokJobByIdempotency,
} from "@/lib/research-jobs";

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
const mockPlatform = vi.mocked(getPlatformDataForSeoClient);

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
  const context = { ownerId: "owner-1", connectionId: "connection-1", provider: "dataforseo" as const };
  const envelope = await encryptProviderCredential(
    context, { login: "owner@example.com", password: "secret" }, bundle.encryption,
  );
  return {
    bundle,
    connection: {
      ...context, label: "DataForSEO", credentialVersion: 1,
      maskedHint: "DataForSEO credential saved", verificationStatus: "valid" as const,
      verifiedAt: "now", lastVerificationCode: "VERIFIED", createdAt: "now", updatedAt: "now", envelope,
    },
  };
};

describe("BYOK Expand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExisting.mockResolvedValue(null);
    mockReserve.mockResolvedValue({
      quoteId: "quote-1", capability: "expand", estimatedCostUsd: 0.011,
      status: "reserved", expiresAt: "later", reservationExpiresAt: "later",
    });
    mockCommit.mockResolvedValue(true);
    mockRelease.mockResolvedValue(true);
    mockClaim.mockResolvedValue({ token: "claim-1", leaseExpiresAt: "later" });
    mockComplete.mockResolvedValue(true);
    mockCost.mockResolvedValue({ inserted: true });
    mockCache.mockResolvedValue();
  });

  test("quotes one fixed Related Queries task without Provider execution", async () => {
    const { connection } = await stored();
    mockLoad.mockResolvedValue(connection);
    mockQuote.mockResolvedValue({
      quoteId: "quote-1", capability: "expand", estimatedCostUsd: 0.011,
      status: "quoted", expiresAt: "later", reservationExpiresAt: null,
    });
    const result = await quoteByokExpand({
      ownerId: "owner-1", connectionId: "connection-1", expectedConnectionVersion: 1,
      clientRequestId: "request-1", keyword: "ai resume builder", days: 90,
      now: new Date("2026-07-21T00:00:00.000Z"),
    });
    expect(result.quote.estimatedCostUsd).toBe(0.011);
    expect(result.request).toEqual({
      keyword: "ai resume builder", dateFrom: "2026-04-22", dateTo: "2026-07-21",
    });
    expect(mockPlatform).not.toHaveBeenCalled();
  });

  test("uses owner credentials and stores only private sanitized candidates", async () => {
    const { bundle, connection } = await stored();
    mockLoad.mockResolvedValue(connection);
    const request = { keyword: "ai resume builder", dateFrom: "2026-04-22", dateTo: "2026-07-21" };
    const requestHash = buildByokExpandRequestHash({
      ownerId: "owner-1", connectionId: "connection-1", connectionVersion: 1, request,
    });
    const job = {
      id: "job-1", user_id: "owner-1", job_type: "expand" as const, status: "pending" as const,
      task_ids: [], payload: { request }, session_id: null, error: null,
      execution_mode: "byok" as const, credential_source: "user" as const,
      idempotency_key: requestHash, claim_token: null, lease_expires_at: null, attempt_count: 0,
      provider_connection_id: "connection-1", provider_connection_version: 1,
      provider_request_state: "not_started" as const, result_cache_key: null,
      created_at: "now", updated_at: "now",
    };
    mockCreate.mockResolvedValue({ job, created: true });
    const providerRequest = vi.fn().mockResolvedValue({
      status_code: 20000, cost: 0.011,
      tasks: [{
        status_code: 20000,
        result: [{ keywords: ["ai resume builder"], items: [{
          type: "google_trends_queries_list",
          data: {
            top: [{ query: "resume ai", value: 100 }],
            rising: [{ query: "new resume ai", value: 500 }],
          },
        }] }],
      }],
    });
    const result = await executeByokExpand({
      ownerId: "owner-1", connectionId: "connection-1", expectedConnectionVersion: 1,
      request, quoteId: "quote-1", requestHash, confirmedEstimatedCostUsd: 0.011,
      confirmation: "CONFIRM", decryptionKeys: bundle.decryption,
      clientFactory: vi.fn().mockReturnValue({ provider: "dataforseo", request: providerRequest }),
    });
    expect(result.data?.candidates).toEqual([
      { keyword: "resume ai", value: 100, type: "top", source: "ai resume builder" },
      { keyword: "new resume ai", value: 500, type: "rising", source: "ai resume builder" },
    ]);
    expect(providerRequest).toHaveBeenCalledWith(
      "post", "/keywords_data/google_trends/explore/live",
      expect.objectContaining({ body: expect.stringContaining("google_trends_queries_list") }), 0, 40_000,
    );
    expect(mockCache).toHaveBeenCalledWith(
      "byok-expand:v1:job-1", expect.any(Object), expect.objectContaining({
        namespace: "byok-expand", scope: { type: "private", ownerId: "owner-1" }, allowLegacyRead: false,
      }),
    );
    expect(mockCost).toHaveBeenCalledWith(expect.objectContaining({
      credentialSource: "user", executionMode: "byok", ownerId: "owner-1", actualCostUsd: 0.011,
    }));
    expect(mockPlatform).not.toHaveBeenCalled();
  });
});
