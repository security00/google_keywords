import { beforeEach, describe, expect, test, vi } from "vitest";

import { parseByokSerpBody, requireByokLiveOwner } from "@/lib/byok/api";
import { executeByokSerp, quoteByokSerp } from "@/lib/byok/serp";
import { loadProviderCredentialDecryptionKeys } from "@/lib/provider-connections/keyring";
import { POST } from "./route";

vi.mock("@/lib/byok/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/api")>()),
  parseByokSerpBody: vi.fn(),
  requireByokLiveOwner: vi.fn(),
}));
vi.mock("@/lib/byok/serp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/serp")>()),
  executeByokSerp: vi.fn(),
  getOwnedByokSerpResult: vi.fn(),
  quoteByokSerp: vi.fn(),
}));
vi.mock("@/lib/provider-connections/keyring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-connections/keyring")>()),
  loadProviderCredentialDecryptionKeys: vi.fn(),
}));

const mockOwner = vi.mocked(requireByokLiveOwner);
const mockParse = vi.mocked(parseByokSerpBody);
const mockQuote = vi.mocked(quoteByokSerp);
const mockExecute = vi.mocked(executeByokSerp);
const mockKeys = vi.mocked(loadProviderCredentialDecryptionKeys);
const request = new Request("https://app.test/api/research/byok/serp", {
  method: "POST", headers: { origin: "https://app.test" },
});

describe("BYOK SERP route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwner.mockResolvedValue({ ownerId: "owner-1" });
    mockKeys.mockResolvedValue({} as never);
  });

  test("does not load credentials for a quote", async () => {
    mockParse.mockResolvedValue({
      action: "quote", connectionId: "connection-1", expectedConnectionVersion: 1,
      clientRequestId: "request-1234", keyword: "ai resume builder",
    });
    mockQuote.mockResolvedValue({
      quote: {
        quoteId: "quote-1", capability: "serp", estimatedCostUsd: 0.002,
        status: "quoted", expiresAt: "later", reservationExpiresAt: null,
      },
      request: { keyword: "ai resume builder" },
      requestHash: "a".repeat(64),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockKeys).not.toHaveBeenCalled();
  });

  test("passes only an exact confirmed request into execution", async () => {
    mockParse.mockResolvedValue({
      action: "execute", connectionId: "connection-1", expectedConnectionVersion: 1,
      request: { keyword: "ai resume builder" }, quoteId: "quote-1",
      requestHash: "a".repeat(64), confirmedEstimatedCostUsd: 0.002,
      confirmation: "CONFIRM",
    });
    mockExecute.mockResolvedValue({
      jobId: "job-1", status: "pending", providerRequestState: "started",
    });
    const response = await POST(request);
    expect(response.status).toBe(202);
    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-1", confirmation: "CONFIRM", decryptionKeys: {},
    }));
  });
});
