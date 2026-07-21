import { beforeEach, describe, expect, test, vi } from "vitest";

import { parseByokTrendsBody, requireByokLiveOwner } from "@/lib/byok/api";
import {
  executeByokTrends,
  getOwnedByokTrendsResult,
  quoteByokTrends,
} from "@/lib/byok/trends";
import { loadProviderCredentialDecryptionKeys } from "@/lib/provider-connections/keyring";
import { GET, POST } from "./route";

vi.mock("@/lib/byok/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/api")>()),
  parseByokTrendsBody: vi.fn(),
  requireByokLiveOwner: vi.fn(),
}));
vi.mock("@/lib/byok/trends", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/trends")>()),
  executeByokTrends: vi.fn(),
  getOwnedByokTrendsResult: vi.fn(),
  quoteByokTrends: vi.fn(),
}));
vi.mock("@/lib/provider-connections/keyring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-connections/keyring")>()),
  loadProviderCredentialDecryptionKeys: vi.fn(),
}));

const mockOwner = vi.mocked(requireByokLiveOwner);
const mockParse = vi.mocked(parseByokTrendsBody);
const mockQuote = vi.mocked(quoteByokTrends);
const mockExecute = vi.mocked(executeByokTrends);
const mockStatus = vi.mocked(getOwnedByokTrendsResult);
const mockKeys = vi.mocked(loadProviderCredentialDecryptionKeys);

const request = new Request("https://app.test/api/research/byok/trends", {
  method: "POST",
  headers: { origin: "https://app.test" },
});

describe("BYOK Trends route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwner.mockResolvedValue({ ownerId: "owner-1" });
    mockKeys.mockResolvedValue({} as never);
  });

  test("returns a quote without decrypting credentials or executing Provider", async () => {
    mockParse.mockResolvedValue({
      action: "quote",
      connectionId: "connection-1",
      expectedConnectionVersion: 1,
      clientRequestId: "request-1234",
      keyword: "ai resume builder",
      benchmark: "gpts",
      days: 90,
    });
    mockQuote.mockResolvedValue({
      quote: {
        quoteId: "quote-1",
        capability: "trends",
        estimatedCostUsd: 0.011,
        status: "quoted",
        expiresAt: "2026-07-21T08:10:00.000Z",
        reservationExpiresAt: null,
      },
      request: {
        keyword: "ai resume builder", benchmark: "gpts",
        dateFrom: "2026-04-22", dateTo: "2026-07-21",
      },
      requestHash: "a".repeat(64),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockQuote).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "owner-1" }));
    expect(mockKeys).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test("loads decryption keys only after an exact execute request", async () => {
    mockParse.mockResolvedValue({
      action: "execute",
      connectionId: "connection-1",
      expectedConnectionVersion: 1,
      request: {
        keyword: "ai resume builder", benchmark: "gpts",
        dateFrom: "2026-04-22", dateTo: "2026-07-21",
      },
      quoteId: "quote-1",
      requestHash: "a".repeat(64),
      confirmedEstimatedCostUsd: 0.011,
      confirmation: "CONFIRM",
    });
    mockExecute.mockResolvedValue({
      jobId: "job-1", status: "pending", providerRequestState: "started",
    });

    const response = await POST(request);
    expect(response.status).toBe(202);
    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-1",
      confirmation: "CONFIRM",
      decryptionKeys: {},
    }));
  });

  test("reads only the current owner's private job status", async () => {
    mockStatus.mockResolvedValue({
      jobId: "job-1", status: "pending", providerRequestState: "started",
    });
    const response = await GET(new Request(
      "https://app.test/api/research/byok/trends?jobId=job-1",
    ));
    expect(response.status).toBe(202);
    expect(mockStatus).toHaveBeenCalledWith("owner-1", "job-1");
  });
});
