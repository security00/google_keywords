import { beforeEach, describe, expect, test, vi } from "vitest";

import { getCached, setCache } from "@/lib/cache";
import { decryptProviderCredential } from "@/lib/provider-connections/credential-crypto";
import { loadProviderConnection } from "@/lib/provider-connections/store";
import { recordPipelineCostEvent } from "@/lib/pipelines/cost-ledger";
import { createByokOpenRouterClient } from "@/lib/byok/provider-clients";
import {
  getPlatformOpenRouterClient,
} from "@/lib/providers/openrouter";
import {
  claimOwnedByokJob,
  completeOwnedByokJob,
  createOrGetOwnedByokJob,
  failOwnedByokJob,
  getOwnedJob,
} from "@/lib/research-jobs";
import {
  BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD,
  ByokSemanticFilterError,
  executeByokSemanticFilter,
} from "./semantic-filter";

vi.mock("@/lib/cache", () => ({ getCached: vi.fn(), setCache: vi.fn() }));
vi.mock("@/lib/provider-connections/credential-crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-connections/credential-crypto")>()),
  decryptProviderCredential: vi.fn(),
}));
vi.mock("@/lib/provider-connections/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-connections/store")>()),
  loadProviderConnection: vi.fn(),
}));
vi.mock("@/lib/pipelines/cost-ledger", () => ({
  recordPipelineCostEvent: vi.fn(),
}));
vi.mock("@/lib/byok/provider-clients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/provider-clients")>()),
  createByokOpenRouterClient: vi.fn(),
}));
vi.mock("@/lib/providers/openrouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/openrouter")>()),
  getPlatformOpenRouterClient: vi.fn(),
}));
vi.mock("@/lib/research-jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/research-jobs")>()),
  claimOwnedByokJob: vi.fn(),
  completeOwnedByokJob: vi.fn(),
  createOrGetOwnedByokJob: vi.fn(),
  failOwnedByokJob: vi.fn(),
  getOwnedJob: vi.fn(),
}));

const mockGetCached = vi.mocked(getCached);
const mockSetCache = vi.mocked(setCache);
const mockDecrypt = vi.mocked(decryptProviderCredential);
const mockLoadConnection = vi.mocked(loadProviderConnection);
const mockCost = vi.mocked(recordPipelineCostEvent);
const mockPlatformClient = vi.mocked(getPlatformOpenRouterClient);
const mockCreateOpenRouterClient = vi.mocked(createByokOpenRouterClient);
const mockClaim = vi.mocked(claimOwnedByokJob);
const mockComplete = vi.mocked(completeOwnedByokJob);
const mockCreateJob = vi.mocked(createOrGetOwnedByokJob);
const mockFail = vi.mocked(failOwnedByokJob);
const mockGetJob = vi.mocked(getOwnedJob);

const job = {
  id: "job-1",
  user_id: "owner-1",
  job_type: "semantic_filter" as const,
  status: "pending" as const,
  task_ids: [],
  payload: { keywords: ["ai tool"] },
  session_id: null,
  error: null,
  execution_mode: "byok" as const,
  credential_source: "user" as const,
  idempotency_key: "request-hash",
  claim_token: null,
  lease_expires_at: null,
  attempt_count: 0,
  provider_connection_id: "connection-1",
  provider_connection_version: 1,
  provider_request_state: "not_started" as const,
  result_cache_key: null,
  created_at: "2026-07-21T00:00:00.000Z",
  updated_at: "2026-07-21T00:00:00.000Z",
};

const connection = {
  connectionId: "connection-1",
  ownerId: "owner-1",
  provider: "openrouter" as const,
  label: "Primary",
  credentialVersion: 1,
  maskedHint: "***1234",
  verificationStatus: "valid" as const,
  verifiedAt: "2026-07-21T00:00:00.000Z",
  lastVerificationCode: "VERIFIED",
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
  envelope: {} as never,
};

const input = {
  ownerId: "owner-1",
  connectionId: "connection-1",
  expectedConnectionVersion: 1,
  keywords: ["AI Tool", "celebrity news"],
  decryptionKeys: {} as never,
};

describe("BYOK semantic filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConnection.mockResolvedValue(connection);
    mockCreateJob.mockResolvedValue({ job, created: true });
    mockClaim.mockResolvedValue({ token: "claim-1", leaseExpiresAt: "now" });
    mockDecrypt.mockResolvedValue({ apiKey: "user-openrouter-key" });
    mockCost.mockResolvedValue({ inserted: true });
    mockSetCache.mockResolvedValue();
    mockComplete.mockResolvedValue(true);
    mockFail.mockResolvedValue(true);
  });

  test("uses one user client call, private cache and explicit user/byok cost attribution", async () => {
    const complete = vi.fn().mockResolvedValue({
      usage: { cost: 0.000123 },
      choices: [{ message: { content: JSON.stringify({
        items: [
          { keyword: "AI Tool", decision: "keep", reason: "durable utility" },
          { keyword: "celebrity news", decision: "block", reason: "short-lived news" },
        ],
      }) } }],
    });
    const clientFactory = vi.fn(() => ({
      provider: "openrouter",
      model: "test/model",
      complete,
    }));

    const result = await executeByokSemanticFilter({ ...input, clientFactory });

    expect(result.status).toBe("complete");
    expect(clientFactory).toHaveBeenCalledWith("user-openrouter-key");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
    expect(complete.mock.calls[0][0]).toMatchObject({
      provider: { require_parameters: true },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "semantic_filter_decisions",
          strict: true,
          schema: {
            additionalProperties: false,
            properties: {
              items: {
                minItems: 2,
                maxItems: 2,
                items: {
                  additionalProperties: false,
                  properties: {
                    keyword: { enum: ["AI Tool", "celebrity news"] },
                    decision: { enum: ["keep", "block"] },
                  },
                  required: ["keyword", "decision", "reason"],
                },
              },
            },
            required: ["items"],
          },
        },
      },
    });
    expect(mockSetCache).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        namespace: "byok-semantic-filter",
        scope: { type: "private", ownerId: "owner-1" },
        allowLegacyRead: false,
      }),
    );
    expect(mockCost).toHaveBeenCalledWith(expect.objectContaining({
      credentialSource: "user",
      executionMode: "byok",
      ownerId: "owner-1",
      eventKey: "byok:job-1:openrouter:semantic-filter:v1",
      unitPriceUsd: BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD,
      actualCostUsd: 0.000123,
    }));
    expect(mockPlatformClient).not.toHaveBeenCalled();
  });

  test("accepts a fenced JSON object without weakening decision validation", async () => {
    const complete = vi.fn().mockResolvedValue({
      choices: [{ message: { content: [
        "```json",
        JSON.stringify({
          items: [
            { keyword: "AI Tool", decision: "keep", reason: "durable utility" },
            { keyword: "celebrity news", decision: "block", reason: "short-lived news" },
          ],
        }),
        "```",
      ].join("\n") } }],
    });
    const clientFactory = () => ({
      provider: "openrouter",
      model: "test/model",
      complete,
    });

    const result = await executeByokSemanticFilter({ ...input, clientFactory });

    expect(result).toMatchObject({
      status: "complete",
      results: [
        { keyword: "AI Tool", decision: "keep" },
        { keyword: "celebrity news", decision: "block" },
      ],
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(mockFail).not.toHaveBeenCalled();
  });

  test("returns a completed private result without another Provider call", async () => {
    mockCreateJob.mockResolvedValue({
      created: false,
      job: {
        ...job,
        status: "complete",
        provider_request_state: "completed",
        result_cache_key: "private-key",
      },
    });
    mockGetCached.mockResolvedValue([
      { keyword: "AI Tool", decision: "keep", reason: "durable utility" },
    ]);
    const clientFactory = vi.fn();

    const result = await executeByokSemanticFilter({ ...input, clientFactory });

    expect(result.status).toBe("complete");
    expect(clientFactory).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockCost).not.toHaveBeenCalled();
    expect(mockGetCached).toHaveBeenCalledWith("private-key", expect.objectContaining({
      scope: { type: "private", ownerId: "owner-1" },
    }));
  });

  test("uses the fixed low-cost BYOK model without reading platform settings", async () => {
    mockCreateOpenRouterClient.mockReturnValue({
      provider: "openrouter",
      model: "google/gemini-2.5-flash-lite",
      complete: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          items: [
            { keyword: "AI Tool", decision: "keep", reason: "durable utility" },
            { keyword: "celebrity news", decision: "block", reason: "short-lived news" },
          ],
        }) } }],
      }),
    });

    await executeByokSemanticFilter(input);

    expect(mockCreateOpenRouterClient).toHaveBeenCalledWith(
      { apiKey: "user-openrouter-key" },
      { model: "google/gemini-2.5-flash-lite" },
    );
    expect(mockPlatformClient).not.toHaveBeenCalled();
  });

  test("does not reclaim a job after its Provider-started checkpoint", async () => {
    mockClaim.mockResolvedValue(null);
    mockGetJob.mockResolvedValue({
      ...job,
      status: "processing",
      provider_request_state: "started",
    });
    const clientFactory = vi.fn();

    const result = await executeByokSemanticFilter({ ...input, clientFactory });

    expect(result).toMatchObject({ status: "pending", providerRequestState: "started" });
    expect(clientFactory).not.toHaveBeenCalled();
    expect(mockCost).not.toHaveBeenCalled();
  });

  test("requires the exact verified owner connection version before creating a job", async () => {
    mockLoadConnection.mockResolvedValue({
      ...connection,
      credentialVersion: 2,
    });

    await expect(executeByokSemanticFilter(input)).rejects.toMatchObject({
      code: "CONNECTION_VERSION_CONFLICT",
    } satisfies Partial<ByokSemanticFilterError>);
    expect(mockCreateJob).not.toHaveBeenCalled();
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  test("records one attributed attempt and terminally fails after Provider error", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("secret-shaped provider body"));
    const clientFactory = () => ({
      provider: "openrouter",
      model: "test/model",
      complete,
    });

    await expect(executeByokSemanticFilter({ ...input, clientFactory }))
      .rejects.toMatchObject({ code: "PROVIDER_FAILED" });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(mockCost).toHaveBeenCalledTimes(1);
    expect(mockCost).toHaveBeenCalledWith(expect.objectContaining({
      unitType: "request_attempt",
      unitPriceUsd: BYOK_SEMANTIC_FILTER_ESTIMATED_COST_USD,
    }));
    expect(mockFail).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "PROVIDER_FAILED",
    }));
    expect(JSON.stringify(mockCost.mock.calls)).not.toContain(
      "secret-shaped provider body",
    );
  });

  test("records a sanitized validation code and never retries an invalid response", async () => {
    const complete = vi.fn().mockResolvedValue({
      usage: { cost: 0.0000255 },
      choices: [{ message: {
        content: "sensitive-provider-text " + JSON.stringify({
          items: [
            { keyword: "AI Tool", decision: "maybe", reason: "uncertain" },
            { keyword: "celebrity news", decision: "block", reason: "short-lived news" },
          ],
        }),
      } }],
    });
    const clientFactory = () => ({
      provider: "openrouter",
      model: "test/model",
      complete,
    });

    await expect(executeByokSemanticFilter({ ...input, clientFactory }))
      .rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(mockCost).toHaveBeenCalledTimes(1);
    expect(mockCost).toHaveBeenCalledWith(expect.objectContaining({
      unitType: "request",
      actualCostUsd: 0.0000255,
      metadata: {
        outcome: "invalid_response",
        model: "test/model",
        connectionVersion: 1,
        validationCode: "DECISION_INVALID",
      },
    }));
    expect(mockFail).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "PROVIDER_RESPONSE_INVALID",
    }));
    expect(JSON.stringify(mockCost.mock.calls)).not.toContain(
      "sensitive-provider-text",
    );
  });
});
