import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { requireEffectiveUser } from "@/lib/authz";
import {
  byokLiveModeEnabled,
  parseByokSemanticFilterBody,
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
});
