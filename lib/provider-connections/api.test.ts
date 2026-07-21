import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { requireEffectiveUser } from "@/lib/authz";
import { NextResponse } from "next/server";
import {
  PROVIDER_CONNECTION_BODY_LIMIT_BYTES,
  ProviderConnectionApiError,
  parseCreateProviderConnectionBody,
  parseRotateProviderConnectionBody,
  providerConnectionErrorResponse,
  readLimitedJsonObject,
  requireProviderConnectionOwner,
} from "./api";

vi.mock("@/lib/authz", () => ({
  requireEffectiveUser: vi.fn(),
}));

const mockRequireEffectiveUser = vi.mocked(requireEffectiveUser);
const cookiePrincipal = {
  userId: "owner-1",
  role: "student" as const,
  scopes: [],
  authMethod: "cookie" as const,
  access: {
    allowed: true as const,
    user: { id: "owner-1" },
    quota: { allowed: true as const, used: 0, limit: 10 },
    trial: { active: true, expiresAt: null },
    entitlement: {
      allowed: true,
      source: "course" as const,
      planKey: "course" as const,
      status: "trialing" as const,
      expiresAt: null,
    },
  },
};

const request = (
  method: string,
  options: Readonly<{
    origin?: string;
    body?: string;
    headers?: Record<string, string>;
  }> = {},
) => new Request("https://www.discoverkeywords.co/api/provider-connections", {
  method,
  headers: {
    ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...options.headers,
  },
  body: options.body,
});

describe("Provider Connection API boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BYOK_PROVIDER_CONNECTIONS_ENABLED", "true");
    vi.stubEnv("BYOK_PROVIDER_CONNECTIONS_ALLOWLIST", "owner-1");
    mockRequireEffectiveUser.mockResolvedValue(cookiePrincipal as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns a hidden 404 before authentication while feature is disabled", async () => {
    vi.stubEnv("BYOK_PROVIDER_CONNECTIONS_ENABLED", "false");

    const result = await requireProviderConnectionOwner(request("GET"));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
    expect(mockRequireEffectiveUser).not.toHaveBeenCalled();
  });

  test("allows an entitled Cookie Principal", async () => {
    await expect(
      requireProviderConnectionOwner(request("GET")),
    ).resolves.toEqual({ ownerId: "owner-1" });
  });

  test("hides management from authenticated owners outside the allowlist", async () => {
    vi.stubEnv("BYOK_PROVIDER_CONNECTIONS_ALLOWLIST", "another-owner");

    const result = await requireProviderConnectionOwner(request("GET"));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  test("preserves authentication and entitlement denials as no-store responses", async () => {
    mockRequireEffectiveUser.mockResolvedValue(
      NextResponse.json({ error: "Activation required" }, { status: 403 }),
    );

    const result = await requireProviderConnectionOwner(request("GET"));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect((result as Response).headers.get("cache-control")).toBe("no-store");
  });

  test("rejects API key and Cron principals even when they have a user id", async () => {
    mockRequireEffectiveUser.mockResolvedValue({
      ...cookiePrincipal,
      authMethod: "api_key",
    } as never);

    const result = await requireProviderConnectionOwner(request("GET"));

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    await expect((result as Response).json()).resolves.toMatchObject({
      code: "COOKIE_AUTH_REQUIRED",
    });
  });

  test("requires exact same-origin mutation requests", async () => {
    const missing = await requireProviderConnectionOwner(request("POST"), {
      mutation: true,
    });
    const foreign = await requireProviderConnectionOwner(
      request("POST", { origin: "https://attacker.example" }),
      { mutation: true },
    );
    const same = await requireProviderConnectionOwner(
      request("POST", { origin: "https://www.discoverkeywords.co" }),
      { mutation: true },
    );
    const spoofedFetchSite = await requireProviderConnectionOwner(
      request("POST", {
        origin: "https://www.discoverkeywords.co",
        headers: { "sec-fetch-site": "cross-site" },
      }),
      { mutation: true },
    );

    expect((missing as Response).status).toBe(403);
    expect((foreign as Response).status).toBe(403);
    expect((spoofedFetchSite as Response).status).toBe(403);
    expect(same).toEqual({ ownerId: "owner-1" });
  });

  test("rejects oversized declared and streamed JSON bodies", async () => {
    await expect(readLimitedJsonObject(request("POST", {
      body: "{}",
      headers: { "content-length": String(PROVIDER_CONNECTION_BODY_LIMIT_BYTES + 1) },
    }))).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });

    await expect(readLimitedJsonObject(request("POST", {
      body: JSON.stringify({ value: "x".repeat(PROVIDER_CONNECTION_BODY_LIMIT_BYTES) }),
    }))).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
  });

  test("requires application/json and a plain JSON object", async () => {
    await expect(readLimitedJsonObject(new Request(
      "https://www.discoverkeywords.co/api/provider-connections",
      { method: "POST", body: "{}", headers: { "content-type": "text/plain" } },
    ))).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });

    await expect(readLimitedJsonObject(request("POST", { body: "[]" })))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  test("rejects unknown fields, nested extras and unsupported Providers", () => {
    expect(() => parseCreateProviderConnectionBody({
      provider: "openrouter",
      credential: { apiKey: "sk-or-secret", baseUrl: "https://attacker.example" },
    })).toThrowError(ProviderConnectionApiError);

    expect(() => parseCreateProviderConnectionBody({
      provider: "custom",
      credential: { apiKey: "sk-or-secret" },
    })).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_PROVIDER" }));
  });

  test("parses exact DataForSEO create and rotation credential shapes", () => {
    expect(parseCreateProviderConnectionBody({
      provider: "dataforseo",
      label: "Research data",
      credential: {
        login: "owner@example.com",
        password: "sensitive-password",
      },
    })).toEqual({
      provider: "dataforseo",
      label: "Research data",
      login: "owner@example.com",
      password: "sensitive-password",
    });

    expect(parseRotateProviderConnectionBody({
      credential: {
        login: "owner@example.com",
        password: "rotated-password",
      },
      expectedCredentialVersion: 2,
    })).toEqual({
      provider: "dataforseo",
      label: undefined,
      login: "owner@example.com",
      password: "rotated-password",
      expectedCredentialVersion: 2,
    });

    expect(() => parseCreateProviderConnectionBody({
      provider: "dataforseo",
      credential: {
        login: "owner@example.com",
        password: "sensitive-password",
        baseUrl: "https://attacker.example",
      },
    })).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  test("never includes an unknown exception message in the response", async () => {
    const response = providerConnectionErrorResponse(
      new Error("failed for api key sk-or-sensitive-value"),
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).not.toContain("sk-or-sensitive-value");
    expect(serialized).toContain("INTERNAL_ERROR");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
