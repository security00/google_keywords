import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { requireEffectiveUser } from "@/lib/authz";
import {
  parseByokExpandBody,
  parseByokCompareBody,
  byokLiveModeEnabled,
  parseByokSemanticFilterBody,
  parseByokSerpBody,
  parseByokTrendsBody,
  requireByokLiveOwner,
} from "./api";

vi.mock("@/lib/authz", () => ({ requireEffectiveUser: vi.fn() }));

const mockRequireEffectiveUser = vi.mocked(requireEffectiveUser);
const request = (body?: unknown, origin = "https://app.test") => new Request(
  "https://app.test/api/research/byok/semantic-filter",
  {
    method: "POST",
    headers: {
      origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  },
);

describe("BYOK live API boundary", () => {
  beforeEach(() => {
    vi.stubEnv("BYOK_LIVE_MODE_ENABLED", "true");
    vi.stubEnv("BYOK_PROVIDER_CONNECTIONS_ALLOWLIST", "owner-1");
    mockRequireEffectiveUser.mockResolvedValue({
      userId: "owner-1",
      role: "student",
      scopes: [],
      authMethod: "cookie",
      access: { allowed: true },
    } as never);
  });

  afterEach(() => vi.unstubAllEnvs());

  test("is hidden unless the independent Live Mode flag is explicitly enabled", async () => {
    expect(byokLiveModeEnabled({})).toBe(false);
    vi.stubEnv("BYOK_LIVE_MODE_ENABLED", "false");

    const response = await requireByokLiveOwner(request());

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(404);
    expect(mockRequireEffectiveUser).not.toHaveBeenCalled();
  });

  test("requires Cookie auth, allowlist membership and same origin", async () => {
    const owner = await requireByokLiveOwner(request(), { mutation: true });
    expect(owner).toEqual({ ownerId: "owner-1" });

    const crossOrigin = await requireByokLiveOwner(
      request(undefined, "https://attacker.test"),
      { mutation: true },
    );
    expect(crossOrigin).toBeInstanceOf(Response);
    expect((crossOrigin as Response).status).toBe(403);

    mockRequireEffectiveUser.mockResolvedValueOnce({
      userId: "owner-1",
      authMethod: "api_key",
      scopes: [],
      access: { allowed: true },
    } as never);
    const apiKey = await requireByokLiveOwner(request());
    expect((apiKey as Response).status).toBe(404);
  });

  test("requires an explicit byok/openrouter request and rejects unknown fields", async () => {
    const parsed = await parseByokSemanticFilterBody(request({
      executionMode: "byok",
      provider: "openrouter",
      connectionId: "connection-1",
      expectedConnectionVersion: 2,
      keywords: ["ai tool"],
    }));
    expect(parsed).toEqual({
      connectionId: "connection-1",
      expectedConnectionVersion: 2,
      keywords: ["ai tool"],
    });

    await expect(parseByokSemanticFilterBody(request({
      executionMode: "byok",
      provider: "openrouter",
      connectionId: "connection-1",
      expectedConnectionVersion: 2,
      keywords: ["ai tool"],
      baseUrl: "https://attacker.test",
    }))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  test("parses the two-step DataForSEO Trends quote and exact confirmation", async () => {
    const quote = await parseByokTrendsBody(request({
      action: "quote",
      executionMode: "byok",
      provider: "dataforseo",
      connectionId: "connection-2",
      expectedConnectionVersion: 1,
      clientRequestId: "request-1234",
      keyword: "ai resume builder",
      benchmark: "gpts",
      days: 90,
    }));
    expect(quote).toMatchObject({
      action: "quote",
      connectionId: "connection-2",
      expectedConnectionVersion: 1,
    });

    const execute = await parseByokTrendsBody(request({
      action: "execute",
      executionMode: "byok",
      provider: "dataforseo",
      connectionId: "connection-2",
      expectedConnectionVersion: 1,
      request: {
        keyword: "ai resume builder",
        benchmark: "gpts",
        dateFrom: "2026-04-22",
        dateTo: "2026-07-21",
      },
      quoteId: "quote-1",
      requestHash: "a".repeat(64),
      confirmedEstimatedCostUsd: 0.011,
      confirmation: "CONFIRM",
    }));
    expect(execute).toMatchObject({
      action: "execute",
      confirmation: "CONFIRM",
      confirmedEstimatedCostUsd: 0.011,
    });

    await expect(parseByokTrendsBody(request({
      action: "execute",
      executionMode: "byok",
      provider: "dataforseo",
      connectionId: "connection-2",
      expectedConnectionVersion: 1,
      request: {
        keyword: "ai resume builder",
        benchmark: "gpts",
        dateFrom: "2026-04-22",
        dateTo: "2026-07-21",
        endpoint: "https://attacker.test",
      },
      quoteId: "quote-1",
      requestHash: "a".repeat(64),
      confirmedEstimatedCostUsd: 0.011,
      confirmation: "CONFIRM",
    }))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  test("requires exact two-step SERP bodies and rejects configurable Provider fields", async () => {
    await expect(parseByokSerpBody(request({
      action: "quote", executionMode: "byok", provider: "dataforseo",
      connectionId: "connection-2", expectedConnectionVersion: 1,
      clientRequestId: "request-1234", keyword: "ai resume builder",
    }))).resolves.toMatchObject({ action: "quote", keyword: "ai resume builder" });

    await expect(parseByokSerpBody(request({
      action: "quote", executionMode: "byok", provider: "dataforseo",
      connectionId: "connection-2", expectedConnectionVersion: 1,
      clientRequestId: "request-1234", keyword: "ai resume builder",
      depth: 100,
    }))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  test("requires exact two-step Expand bodies and rejects Provider overrides", async () => {
    await expect(parseByokExpandBody(request({
      action: "quote", executionMode: "byok", provider: "dataforseo",
      connectionId: "connection-2", expectedConnectionVersion: 1,
      clientRequestId: "request-1234", keyword: "ai resume builder", days: 90,
    }))).resolves.toMatchObject({ action: "quote", days: 90 });

    await expect(parseByokExpandBody(request({
      action: "quote", executionMode: "byok", provider: "dataforseo",
      connectionId: "connection-2", expectedConnectionVersion: 1,
      clientRequestId: "request-1234", keyword: "ai resume builder", days: 90,
      itemTypes: ["google_trends_graph"],
    }))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  test("binds exact dual-provider Compare bodies and rejects model overrides", async () => {
    await expect(parseByokCompareBody(request({
      action: "quote", executionMode: "byok",
      dataForSeoConnectionId: "dataforseo-1", dataForSeoConnectionVersion: 1,
      openRouterConnectionId: "openrouter-1", openRouterConnectionVersion: 2,
      clientRequestId: "request-1", keywords: ["ai resume builder"],
      benchmark: "gpts", days: 90,
    }))).resolves.toMatchObject({ action: "quote", openRouterConnectionVersion: 2 });

    await expect(parseByokCompareBody(request({
      action: "quote", executionMode: "byok",
      dataForSeoConnectionId: "dataforseo-1", dataForSeoConnectionVersion: 1,
      openRouterConnectionId: "openrouter-1", openRouterConnectionVersion: 2,
      clientRequestId: "request-1", keywords: ["ai resume builder"],
      benchmark: "gpts", days: 90, model: "expensive/model",
    }))).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    await expect(parseByokCompareBody(request({
      action: "retry_intent_quote", executionMode: "byok", baseJobId: "base-job",
      openRouterConnectionId: "openrouter-1", openRouterConnectionVersion: 2,
      clientRequestId: "retry-1",
    }))).resolves.toMatchObject({ action: "retry_intent_quote", baseJobId: "base-job" });

    await expect(parseByokCompareBody(request({
      action: "retry_intent_execute", executionMode: "byok",
      openRouterConnectionId: "openrouter-1", openRouterConnectionVersion: 2,
      request: { baseJobId: "base-job", retryToken: "retry-1" },
      quoteId: "quote-2", requestHash: "b".repeat(64),
      confirmedEstimatedCostUsd: 0.001, confirmation: "CONFIRM",
      dataForSeoConnectionId: "must-not-be-accepted",
    }))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
