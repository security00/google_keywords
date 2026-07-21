import { beforeEach, describe, expect, test, vi } from "vitest";

import { parseByokCompareBody, requireByokLiveOwner } from "@/lib/byok/api";
import {
  executeByokCompare,
  executeByokCompareIntentRetry,
  quoteByokCompare,
  quoteByokCompareIntentRetry,
} from "@/lib/byok/compare";
import { loadProviderCredentialDecryptionKeys } from "@/lib/provider-connections/keyring";
import { POST } from "./route";

vi.mock("@/lib/byok/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/api")>()),
  parseByokCompareBody: vi.fn(), requireByokLiveOwner: vi.fn(),
}));
vi.mock("@/lib/byok/compare", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/compare")>()),
  executeByokCompare: vi.fn(), getOwnedByokCompareResult: vi.fn(), quoteByokCompare: vi.fn(),
  executeByokCompareIntentRetry: vi.fn(), quoteByokCompareIntentRetry: vi.fn(),
}));
vi.mock("@/lib/provider-connections/keyring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-connections/keyring")>()),
  loadProviderCredentialDecryptionKeys: vi.fn(),
}));

const mockOwner = vi.mocked(requireByokLiveOwner);
const mockParse = vi.mocked(parseByokCompareBody);
const mockQuote = vi.mocked(quoteByokCompare);
const mockExecute = vi.mocked(executeByokCompare);
const mockRetryQuote = vi.mocked(quoteByokCompareIntentRetry);
const mockRetryExecute = vi.mocked(executeByokCompareIntentRetry);
const mockKeys = vi.mocked(loadProviderCredentialDecryptionKeys);
const request = new Request("https://app.test/api/research/byok/compare", {
  method: "POST", headers: { origin: "https://app.test" },
});

describe("BYOK Compare route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwner.mockResolvedValue({ ownerId: "owner-1" });
    mockKeys.mockResolvedValue({} as never);
  });

  test("quotes without loading decryption keys", async () => {
    mockParse.mockResolvedValue({
      action: "quote", dataForSeoConnectionId: "dataforseo-1", dataForSeoConnectionVersion: 1,
      openRouterConnectionId: "openrouter-1", openRouterConnectionVersion: 1,
      clientRequestId: "request-1", keywords: ["ai resume builder"], benchmark: "gpts", days: 90,
    });
    mockQuote.mockResolvedValue({
      quote: {
        quoteId: "quote-1", capability: "compare", estimatedCostUsd: 0.012,
        status: "quoted", expiresAt: "later", reservationExpiresAt: null,
      },
      request: {
        keywords: ["ai resume builder"], benchmark: "gpts",
        dateFrom: "2026-04-22", dateTo: "2026-07-21",
      },
      requestHash: "a".repeat(64),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockKeys).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test("loads keys only for a confirmed execution", async () => {
    mockParse.mockResolvedValue({
      action: "execute", dataForSeoConnectionId: "dataforseo-1", dataForSeoConnectionVersion: 1,
      openRouterConnectionId: "openrouter-1", openRouterConnectionVersion: 1,
      request: {
        keywords: ["ai resume builder"], benchmark: "gpts",
        dateFrom: "2026-04-22", dateTo: "2026-07-21",
      },
      quoteId: "quote-1", requestHash: "a".repeat(64),
      confirmedEstimatedCostUsd: 0.012, confirmation: "CONFIRM",
    });
    mockExecute.mockResolvedValue({ jobId: "job-1", status: "pending", providerRequestState: "started" });
    const response = await POST(request);
    expect(response.status).toBe(202);
    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-1", confirmation: "CONFIRM", decryptionKeys: {},
    }));
  });

  test("keeps intent retry quote credential-free and retry execution OpenRouter-only", async () => {
    mockParse.mockResolvedValue({
      action: "retry_intent_quote", baseJobId: "base-job",
      openRouterConnectionId: "openrouter-1", openRouterConnectionVersion: 1,
      clientRequestId: "retry-1",
    });
    mockRetryQuote.mockResolvedValue({
      quote: {
        quoteId: "retry-quote", capability: "compare", estimatedCostUsd: 0.001,
        status: "quoted", expiresAt: "later", reservationExpiresAt: null,
      },
      request: { baseJobId: "base-job", retryToken: "retry-1" },
      requestHash: "b".repeat(64),
    });
    let response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockKeys).not.toHaveBeenCalled();

    mockParse.mockResolvedValue({
      action: "retry_intent_execute", openRouterConnectionId: "openrouter-1",
      openRouterConnectionVersion: 1,
      request: { baseJobId: "base-job", retryToken: "retry-1" },
      quoteId: "retry-quote", requestHash: "b".repeat(64),
      confirmedEstimatedCostUsd: 0.001, confirmation: "CONFIRM",
    });
    mockRetryExecute.mockResolvedValue({
      jobId: "retry-job", status: "complete", providerRequestState: "completed",
      data: {} as never,
    });
    response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockRetryExecute).toHaveBeenCalledWith(expect.not.objectContaining({
      dataForSeoConnectionId: expect.anything(),
    }));
  });
});
