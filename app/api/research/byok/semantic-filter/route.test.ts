import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  parseByokSemanticFilterBody,
  requireByokLiveOwner,
} from "@/lib/byok/api";
import {
  ByokSemanticFilterError,
  executeByokSemanticFilter,
  getOwnedByokSemanticFilterResult,
} from "@/lib/byok/semantic-filter";
import { loadProviderCredentialDecryptionKeys } from "@/lib/provider-connections/keyring";
import { GET, POST } from "./route";

vi.mock("@/lib/byok/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/api")>()),
  parseByokSemanticFilterBody: vi.fn(),
  requireByokLiveOwner: vi.fn(),
}));
vi.mock("@/lib/byok/semantic-filter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/semantic-filter")>()),
  executeByokSemanticFilter: vi.fn(),
  getOwnedByokSemanticFilterResult: vi.fn(),
}));
vi.mock("@/lib/provider-connections/keyring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-connections/keyring")>()),
  loadProviderCredentialDecryptionKeys: vi.fn(),
}));

const mockOwner = vi.mocked(requireByokLiveOwner);
const mockParse = vi.mocked(parseByokSemanticFilterBody);
const mockExecute = vi.mocked(executeByokSemanticFilter);
const mockGetResult = vi.mocked(getOwnedByokSemanticFilterResult);
const mockKeys = vi.mocked(loadProviderCredentialDecryptionKeys);

const postRequest = new Request(
  "https://app.test/api/research/byok/semantic-filter",
  { method: "POST", headers: { origin: "https://app.test" } },
);

describe("BYOK semantic filter route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwner.mockResolvedValue({ ownerId: "owner-1" });
    mockParse.mockResolvedValue({
      connectionId: "connection-1",
      expectedConnectionVersion: 1,
      keywords: ["ai tool"],
    });
    mockKeys.mockResolvedValue({} as never);
    mockExecute.mockResolvedValue({
      jobId: "job-1",
      status: "complete",
      providerRequestState: "completed",
      results: [{ keyword: "ai tool", decision: "keep", reason: "utility" }],
    });
  });

  test("executes only for the authenticated owner and returns no-store", async () => {
    const response = await POST(postRequest);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-1",
      connectionId: "connection-1",
      decryptionKeys: {},
    }));
  });

  test("returns 202 for a previously started job without re-executing it", async () => {
    mockExecute.mockResolvedValue({
      jobId: "job-1",
      status: "pending",
      providerRequestState: "started",
    });
    const response = await POST(postRequest);
    expect(response.status).toBe(202);
  });

  test("reads status through an owner-scoped GET", async () => {
    mockGetResult.mockResolvedValue({
      jobId: "job-1",
      status: "pending",
      providerRequestState: "started",
    });
    const response = await GET(new Request(
      "https://app.test/api/research/byok/semantic-filter?jobId=job-1",
    ));
    expect(response.status).toBe(202);
    expect(mockGetResult).toHaveBeenCalledWith("owner-1", "job-1");
  });

  test("maps stable execution errors without leaking internal messages", async () => {
    mockExecute.mockRejectedValue(new ByokSemanticFilterError("PROVIDER_FAILED"));
    const response = await POST(postRequest);
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.code).toBe("PROVIDER_FAILED");
  });
});
