import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getAuthUser } from "@/lib/auth";
import { validateApiKey } from "@/lib/api_keys";
import { checkEffectiveAccess } from "@/lib/entitlements";
import {
  getPrincipal,
  hasApiKeyScope,
  isAuthzError,
  isCronRequest,
  requireEffectiveUser,
  requirePaidApiPermission,
} from "./authz";

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/api_keys", () => ({
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/entitlements", () => ({
  accessDeniedStatus: vi.fn((code: string) =>
    code === "unauthorized" ? 401 : code === "quota_exceeded" ? 429 : 403,
  ),
  checkEffectiveAccess: vi.fn(),
}));

const mockGetAuthUser = vi.mocked(getAuthUser);
const mockValidateApiKey = vi.mocked(validateApiKey);
const mockCheckEffectiveAccess = vi.mocked(checkEffectiveAccess);
const originalCronSecret = process.env.CRON_SECRET;
const originalGkCronSecret = process.env.GK_CRON_SECRET;
const originalExternalCronSecret = process.env.EXTERNAL_CRON_SECRET;

const restoreEnv = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

describe("authz Principal", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockValidateApiKey.mockReset();
    mockCheckEffectiveAccess.mockReset();
    mockGetAuthUser.mockResolvedValue(null);
    delete process.env.CRON_SECRET;
    delete process.env.GK_CRON_SECRET;
    delete process.env.EXTERNAL_CRON_SECRET;
  });

  afterEach(() => {
    restoreEnv("CRON_SECRET", originalCronSecret);
    restoreEnv("GK_CRON_SECRET", originalGkCronSecret);
    restoreEnv("EXTERNAL_CRON_SECRET", originalExternalCronSecret);
  });

  test("resolves Bearer API keys without a second role lookup", async () => {
    mockValidateApiKey.mockResolvedValue({
      valid: true,
      userId: "user-1",
      apiKeyId: 12,
      role: "student",
      scopes: ["cache:read"],
    });

    const request = new Request("https://example.com/api/me", {
      headers: { authorization: "Bearer gk_live_test" },
    });
    const principal = await getPrincipal(request);

    expect(principal).toEqual({
      userId: "user-1",
      role: "student",
      apiKeyId: 12,
      scopes: ["cache:read"],
      authMethod: "api_key",
    });
    expect(mockGetAuthUser).not.toHaveBeenCalled();
  });

  test("does not accept query API keys unless a compatibility caller opts in", async () => {
    mockValidateApiKey.mockResolvedValue({
      valid: true,
      userId: "user-1",
      apiKeyId: 12,
      role: "student",
      scopes: ["cache:read"],
    });
    const request = new Request(
      "https://example.com/api/me?api_key=gk_live_test",
    );

    const defaultPrincipal = await getPrincipal(request);
    const compatibilityPrincipal = await getPrincipal(request, {
      allowLegacyQueryKey: true,
    });

    expect(defaultPrincipal.authMethod).toBe("anonymous");
    expect(compatibilityPrincipal.authMethod).toBe("api_key_query");
    expect(
      hasApiKeyScope(compatibilityPrincipal, "cache:read"),
    ).toBe(false);
  });

  test("recognizes configured cron secrets", async () => {
    process.env.CRON_SECRET = "cron-secret";
    const request = new Request("https://example.com/api/cron", {
      headers: { "x-cron-secret": "cron-secret" },
    });

    expect(await isCronRequest(request)).toBe(true);
  });

  test("keeps the API key Principal when scheduled clients send both credentials", async () => {
    process.env.CRON_SECRET = "cron-secret";
    mockValidateApiKey.mockResolvedValue({
      valid: true,
      userId: "admin-1",
      apiKeyId: 18,
      role: "admin",
      scopes: ["cache:read"],
    });
    const request = new Request("https://example.com/api/research/compare", {
      headers: {
        authorization: "Bearer gk_live_test",
        "x-cron-secret": "cron-secret",
      },
    });

    expect(await isCronRequest(request)).toBe(true);
    expect(await getPrincipal(request)).toMatchObject({
      userId: "admin-1",
      authMethod: "api_key",
    });
  });

  test("keeps ordinary API keys out of platform paid execution", async () => {
    mockValidateApiKey.mockResolvedValue({
      valid: true,
      userId: "user-1",
      apiKeyId: 12,
      role: "student",
      scopes: ["cache:read"],
    });
    const request = new Request("https://example.com/api/research/serp", {
      headers: { authorization: "Bearer gk_live_test" },
    });

    const result = await requirePaidApiPermission(request);

    expect(isAuthzError(result)).toBe(true);
    if (isAuthzError(result)) {
      expect(result.status).toBe(403);
    }
  });

  test("enforces effective entitlement after resolving the Principal", async () => {
    mockValidateApiKey.mockResolvedValue({
      valid: true,
      userId: "user-1",
      apiKeyId: 12,
      role: "student",
      scopes: ["cache:read"],
    });
    mockCheckEffectiveAccess.mockResolvedValue({
      allowed: false,
      reason: "Subscription required",
      code: "trial_expired",
      entitlement: {
        allowed: false,
        source: "none",
        planKey: null,
        status: "expired",
        expiresAt: "2026-04-01T00:00:00Z",
      },
    });
    const request = new Request("https://example.com/api/research/expand", {
      headers: { authorization: "Bearer gk_live_test" },
    });

    const result = await requireEffectiveUser(request);

    expect(isAuthzError(result)).toBe(true);
    if (isAuthzError(result)) {
      expect(result.status).toBe(403);
      await expect(result.json()).resolves.toMatchObject({
        code: "trial_expired",
        action: "subscribe",
      });
    }
  });
});
