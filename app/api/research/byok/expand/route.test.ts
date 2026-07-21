import { beforeEach, describe, expect, test, vi } from "vitest";

import { parseByokExpandBody, requireByokLiveOwner } from "@/lib/byok/api";
import { executeByokExpand, quoteByokExpand } from "@/lib/byok/expand";
import { loadProviderCredentialDecryptionKeys } from "@/lib/provider-connections/keyring";
import { POST } from "./route";

vi.mock("@/lib/byok/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/api")>()),
  parseByokExpandBody: vi.fn(), requireByokLiveOwner: vi.fn(),
}));
vi.mock("@/lib/byok/expand", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/expand")>()),
  executeByokExpand: vi.fn(), getOwnedByokExpandResult: vi.fn(), quoteByokExpand: vi.fn(),
}));
vi.mock("@/lib/provider-connections/keyring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-connections/keyring")>()),
  loadProviderCredentialDecryptionKeys: vi.fn(),
}));

const mockOwner = vi.mocked(requireByokLiveOwner);
const mockParse = vi.mocked(parseByokExpandBody);
const mockQuote = vi.mocked(quoteByokExpand);
const mockExecute = vi.mocked(executeByokExpand);
const mockKeys = vi.mocked(loadProviderCredentialDecryptionKeys);
const request = new Request("https://app.test/api/research/byok/expand", {
  method: "POST", headers: { origin: "https://app.test" },
});

describe("BYOK Expand route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwner.mockResolvedValue({ ownerId: "owner-1" });
    mockKeys.mockResolvedValue({} as never);
  });

  test("quotes without loading decryption keys", async () => {
    mockParse.mockResolvedValue({
      action: "quote", connectionId: "connection-1", expectedConnectionVersion: 1,
      clientRequestId: "request-1", keyword: "ai resume builder", days: 90,
    });
    mockQuote.mockResolvedValue({
      quote: {
        quoteId: "quote-1", capability: "expand", estimatedCostUsd: 0.011,
        status: "quoted", expiresAt: "later", reservationExpiresAt: null,
      },
      request: { keyword: "ai resume builder", dateFrom: "2026-04-22", dateTo: "2026-07-21" },
      requestHash: "a".repeat(64),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockKeys).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test("loads keys only for an exact confirmed execution", async () => {
    mockParse.mockResolvedValue({
      action: "execute", connectionId: "connection-1", expectedConnectionVersion: 1,
      request: { keyword: "ai resume builder", dateFrom: "2026-04-22", dateTo: "2026-07-21" },
      quoteId: "quote-1", requestHash: "a".repeat(64),
      confirmedEstimatedCostUsd: 0.011, confirmation: "CONFIRM",
    });
    mockExecute.mockResolvedValue({ jobId: "job-1", status: "pending", providerRequestState: "started" });
    const response = await POST(request);
    expect(response.status).toBe(202);
    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-1", confirmation: "CONFIRM", decryptionKeys: {},
    }));
  });
});
