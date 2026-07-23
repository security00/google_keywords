import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  encryptProviderCredential,
  type ProviderCredentialDecryptionKeys,
  type ProviderCredentialEncryptionKeys,
} from "./credential-crypto";
import {
  loadProviderConnection,
  updateProviderConnectionVerification,
} from "./store";
import { claimProviderVerificationAttempt } from "./verification-rate-limit";
import {
  verifyDataForSeoConnection,
  verifyDataForSeoCredential,
  verifyOpenRouterConnection,
  verifyOpenRouterCredential,
} from "./verification";

vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return {
    ...actual,
    loadProviderConnection: vi.fn(),
    updateProviderConnectionVerification: vi.fn(),
  };
});

vi.mock("./verification-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./verification-rate-limit")>();
  return { ...actual, claimProviderVerificationAttempt: vi.fn() };
});

const mockLoad = vi.mocked(loadProviderConnection);
const mockUpdate = vi.mocked(updateProviderConnectionVerification);
const mockClaim = vi.mocked(claimProviderVerificationAttempt);

const context = {
  connectionId: "connection-1",
  ownerId: "owner-1",
  provider: "openrouter" as const,
};

const storedDataForSeoConnection = async () => {
  const keys = await keyBundle();
  const dataContext = {
    connectionId: "connection-2",
    ownerId: "owner-1",
    provider: "dataforseo" as const,
  };
  const envelope = await encryptProviderCredential(
    dataContext,
    { login: "owner@example.com", password: "dataforseo-sensitive-password" },
    keys.encryption,
  );
  return {
    keys,
    context: dataContext,
    connection: {
      ...dataContext,
      label: "DataForSEO",
      credentialVersion: 1,
      maskedHint: "DataForSEO credential saved",
      verificationStatus: "unverified" as const,
      verifiedAt: null,
      lastVerificationCode: null,
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
      envelope,
    },
  };
};

const keyBundle = async (): Promise<{
  encryption: ProviderCredentialEncryptionKeys;
  decryption: ProviderCredentialDecryptionKeys;
}> => {
  const kek = await crypto.subtle.generateKey(
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
  const fingerprintKey = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
  return {
    encryption: {
      kekVersion: "v1",
      kek,
      fingerprintKeyVersion: "v1",
      fingerprintKey,
    },
    decryption: {
      resolveKek: (version) => version === "v1" ? kek : undefined,
      resolveFingerprintKey: (version) => version === "v1"
        ? fingerprintKey
        : undefined,
    },
  };
};

const storedConnection = async (
  apiKey = "sk-or-sensitive-1234",
) => {
  const keys = await keyBundle();
  const envelope = await encryptProviderCredential(
    context,
    { apiKey },
    keys.encryption,
  );
  return {
    keys,
    connection: {
      ...context,
      provider: "openrouter" as const,
      label: "Primary",
      credentialVersion: 1,
      maskedHint: "••••1234",
      verificationStatus: "unverified" as const,
      verifiedAt: null,
      lastVerificationCode: null,
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
      envelope,
    },
  };
};

describe("OpenRouter Provider Connection verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaim.mockResolvedValue({
      allowed: true,
      attemptCount: 1,
      blockedUntil: null,
    });
  });

  test("decrypts only the owner-scoped credential and records a valid result", async () => {
    const { keys, connection } = await storedConnection();
    mockLoad.mockResolvedValue(connection);
    mockUpdate.mockImplementation(async (input) => ({
      ...connection,
      verificationStatus: input.status,
      lastVerificationCode: input.verificationCode,
    }));
    const verifier = vi.fn().mockResolvedValue("VERIFIED");

    const result = await verifyOpenRouterConnection({
      ownerId: context.ownerId,
      connectionId: context.connectionId,
      decryptionKeys: keys.decryption,
      verifier,
    });

    expect(verifier).toHaveBeenCalledWith("sk-or-sensitive-1234");
    expect(mockLoad).toHaveBeenCalledWith(context.ownerId, context.connectionId);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      context,
      expectedCredentialVersion: 1,
      status: "valid",
      verificationCode: "VERIFIED",
    }));
    expect(result.verification).toEqual({ status: "valid", code: "VERIFIED" });
    expect(result.connection).not.toHaveProperty("envelope");
  });

  test("records invalid credentials without exposing Provider response bodies", async () => {
    const { keys, connection } = await storedConnection();
    mockLoad.mockResolvedValue(connection);
    mockUpdate.mockImplementation(async (input) => ({
      ...connection,
      verificationStatus: input.status,
      lastVerificationCode: input.verificationCode,
    }));

    const result = await verifyOpenRouterConnection({
      ownerId: context.ownerId,
      connectionId: context.connectionId,
      decryptionKeys: keys.decryption,
      verifier: vi.fn().mockResolvedValue("INVALID_CREDENTIAL"),
    });

    expect(result.verification).toEqual({
      status: "invalid",
      code: "INVALID_CREDENTIAL",
    });
  });

  test("blocks before loading or decrypting when the persistent limit is active", async () => {
    const { keys } = await storedConnection();
    mockClaim.mockResolvedValue({
      allowed: false,
      attemptCount: 4,
      blockedUntil: "2026-07-21T00:15:00.000Z",
    });
    const verifier = vi.fn();

    await expect(verifyOpenRouterConnection({
      ownerId: context.ownerId,
      connectionId: context.connectionId,
      decryptionKeys: keys.decryption,
      verifier,
    })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(mockLoad).not.toHaveBeenCalled();
    expect(verifier).not.toHaveBeenCalled();
  });

  test("fails closed and records a sanitized code when decryption keys are missing", async () => {
    const { connection } = await storedConnection();
    mockLoad.mockResolvedValue(connection);
    mockUpdate.mockImplementation(async (input) => ({
      ...connection,
      verificationStatus: input.status,
      lastVerificationCode: input.verificationCode,
    }));
    const verifier = vi.fn();

    const result = await verifyOpenRouterConnection({
      ownerId: context.ownerId,
      connectionId: context.connectionId,
      decryptionKeys: {
        resolveKek: () => undefined,
        resolveFingerprintKey: () => undefined,
      },
      verifier,
    });

    expect(result.verification.code).toBe("CREDENTIAL_UNAVAILABLE");
    expect(verifier).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      verificationCode: "CREDENTIAL_UNAVAILABLE",
    }));
  });

  test("uses only the fixed official OpenRouter key endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("sensitive-provider-body", { status: 200 }),
    );

    await expect(verifyOpenRouterCredential("sk-or-sensitive-1234"))
      .resolves.toBe("VERIFIED");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        headers: { Authorization: "Bearer sk-or-sensitive-1234" },
      }),
    );
    fetchSpy.mockRestore();
  });

  test("rejects an OpenRouter redirect without following it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://redirected.example.test" },
      }),
    );

    await expect(verifyOpenRouterCredential("sk-or-sensitive-1234"))
      .resolves.toBe("VERIFICATION_FAILED");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    fetchSpy.mockRestore();
  });
});

describe("DataForSEO Provider Connection verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaim.mockResolvedValue({
      allowed: true,
      attemptCount: 1,
      blockedUntil: null,
    });
  });

  test("decrypts both credential fields and records a valid result", async () => {
    const { keys, context: dataContext, connection } =
      await storedDataForSeoConnection();
    mockLoad.mockResolvedValue(connection);
    mockUpdate.mockImplementation(async (input) => ({
      ...connection,
      verificationStatus: input.status,
      lastVerificationCode: input.verificationCode,
    }));
    const verifier = vi.fn().mockResolvedValue("VERIFIED");

    const result = await verifyDataForSeoConnection({
      ownerId: dataContext.ownerId,
      connectionId: dataContext.connectionId,
      decryptionKeys: keys.decryption,
      verifier,
    });

    expect(mockClaim).toHaveBeenCalledWith(dataContext.ownerId, "dataforseo");
    expect(verifier).toHaveBeenCalledWith(
      "owner@example.com",
      "dataforseo-sensitive-password",
    );
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      context: dataContext,
      status: "valid",
      verificationCode: "VERIFIED",
    }));
    expect(result.connection).not.toHaveProperty("envelope");
  });

  test("uses only the fixed free DataForSEO account endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("sensitive-provider-body", { status: 200 }),
    );

    await expect(verifyDataForSeoCredential(
      "owner@example.com",
      "dataforseo-sensitive-password",
    )).resolves.toBe("VERIFIED");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.dataforseo.com/v3/appendix/user_data",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        cache: "no-store",
      }),
    );
    const request = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((request.headers as Record<string, string>).Authorization)
      .toMatch(/^Basic /);
    expect(JSON.stringify(request)).not.toContain("dataforseo-sensitive-password");
    fetchSpy.mockRestore();
  });

  test("rejects a DataForSEO redirect without following it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 307,
        headers: { Location: "https://redirected.example.test" },
      }),
    );

    await expect(verifyDataForSeoCredential(
      "owner@example.com",
      "dataforseo-sensitive-password",
    )).resolves.toBe("VERIFICATION_FAILED");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    fetchSpy.mockRestore();
  });
});
