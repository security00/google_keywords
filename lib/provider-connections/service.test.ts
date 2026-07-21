import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  encryptProviderCredential,
  type ProviderCredentialEncryptionKeys,
} from "./credential-crypto";
import {
  createProviderConnection,
  deleteProviderConnection,
  listProviderConnections,
  loadProviderConnection,
  loadProviderConnectionByProvider,
  rotateProviderConnectionCredential,
} from "./store";
import {
  ProviderConnectionServiceError,
  createDataForSeoConnection,
  createOpenRouterConnection,
  listOpenRouterConnections,
  removeProviderConnection,
  rotateDataForSeoConnection,
  rotateOpenRouterConnection,
} from "./service";

vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return {
    ...actual,
    createProviderConnection: vi.fn(),
    deleteProviderConnection: vi.fn(),
    listProviderConnections: vi.fn(),
    loadProviderConnection: vi.fn(),
    loadProviderConnectionByProvider: vi.fn(),
    rotateProviderConnectionCredential: vi.fn(),
  };
});

const mockCreate = vi.mocked(createProviderConnection);
const mockDelete = vi.mocked(deleteProviderConnection);
const mockList = vi.mocked(listProviderConnections);
const mockLoad = vi.mocked(loadProviderConnection);
const mockLoadByProvider = vi.mocked(loadProviderConnectionByProvider);
const mockRotate = vi.mocked(rotateProviderConnectionCredential);

const context = {
  connectionId: "connection-1",
  ownerId: "owner-1",
  provider: "openrouter" as const,
};

const metadata = {
  connectionId: context.connectionId,
  ownerId: context.ownerId,
  provider: context.provider,
  label: "Primary",
  credentialVersion: 1,
  maskedHint: "••••1234",
  verificationStatus: "unverified" as const,
  verifiedAt: null,
  lastVerificationCode: null,
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
};

const dataForSeoContext = {
  connectionId: "connection-2",
  ownerId: context.ownerId,
  provider: "dataforseo" as const,
};

const dataForSeoMetadata = {
  ...metadata,
  ...dataForSeoContext,
  label: "DataForSEO",
  maskedHint: "DataForSEO credential saved",
};

const createKeys = async (): Promise<ProviderCredentialEncryptionKeys> => ({
  kekVersion: "v1",
  kek: await crypto.subtle.generateKey(
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  ),
  fingerprintKeyVersion: "v1",
  fingerprintKey: await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  ),
});

const expectServiceError = (code: string) => (error: unknown) => {
  expect(error).toBeInstanceOf(ProviderConnectionServiceError);
  expect((error as ProviderConnectionServiceError).code).toBe(code);
  return true;
};

describe("Provider Connection service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns only public owner-scoped metadata", async () => {
    mockList.mockResolvedValue([metadata]);

    const result = await listOpenRouterConnections(context.ownerId);

    expect(mockList).toHaveBeenCalledWith(context.ownerId);
    expect(result[0]).toEqual({
      id: context.connectionId,
      provider: "openrouter",
      label: "Primary",
      maskedHint: "••••1234",
      credentialVersion: 1,
      verificationStatus: "unverified",
      verifiedAt: null,
      lastVerificationCode: null,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    });
    expect(result[0]).not.toHaveProperty("ownerId");
    expect(result[0]).not.toHaveProperty("envelope");
  });

  test("encrypts and creates a new OpenRouter connection", async () => {
    const keys = await createKeys();
    mockLoadByProvider.mockResolvedValue(null);
    mockCreate.mockImplementation(async (input) => ({
      ...metadata,
      connectionId: input.context.connectionId,
      label: input.label,
      maskedHint: input.maskedHint,
      envelope: input.envelope,
    }));

    const result = await createOpenRouterConnection({
      ownerId: context.ownerId,
      label: " Primary ",
      apiKey: "sk-or-secret-1234",
      keys,
    });

    const input = mockCreate.mock.calls[0][0];
    expect(input.context.ownerId).toBe(context.ownerId);
    expect(input.context.provider).toBe("openrouter");
    expect(input.label).toBe("Primary");
    expect(input.maskedHint).toBe("••••1234");
    expect(input.envelope.ciphertext).not.toContain("sk-or-secret-1234");
    expect(result).not.toHaveProperty("envelope");
  });

  test("makes repeated create idempotent for the same owner credential", async () => {
    const keys = await createKeys();
    const existingEnvelope = await encryptProviderCredential(
      context,
      { apiKey: "sk-or-secret-1234" },
      keys,
    );
    mockLoadByProvider.mockResolvedValue({ ...metadata, envelope: existingEnvelope });

    const result = await createOpenRouterConnection({
      ownerId: context.ownerId,
      apiKey: "sk-or-secret-1234",
      keys,
    });

    expect(result.id).toBe(context.connectionId);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("encrypts DataForSEO credentials without exposing the login or password", async () => {
    const keys = await createKeys();
    mockLoadByProvider.mockResolvedValue(null);
    mockCreate.mockImplementation(async (input) => ({
      ...dataForSeoMetadata,
      connectionId: input.context.connectionId,
      label: input.label,
      maskedHint: input.maskedHint,
      envelope: input.envelope,
    }));

    const result = await createDataForSeoConnection({
      ownerId: context.ownerId,
      login: " owner@example.com ",
      password: "dataforseo-sensitive-password",
      keys,
    });

    const input = mockCreate.mock.calls[0][0];
    expect(input.context.provider).toBe("dataforseo");
    expect(input.maskedHint).toBe("DataForSEO credential saved");
    expect(input.envelope.ciphertext).not.toContain("owner@example.com");
    expect(input.envelope.ciphertext).not.toContain("dataforseo-sensitive-password");
    expect(JSON.stringify(result)).not.toContain("owner@example.com");
  });

  test("requires explicit rotation when the owner already has another credential", async () => {
    const keys = await createKeys();
    const existingEnvelope = await encryptProviderCredential(
      context,
      { apiKey: "sk-or-old-secret" },
      keys,
    );
    mockLoadByProvider.mockResolvedValue({ ...metadata, envelope: existingEnvelope });

    await expect(createOpenRouterConnection({
      ownerId: context.ownerId,
      apiKey: "sk-or-new-secret",
      keys,
    })).rejects.toSatisfy(expectServiceError("CONNECTION_CONFLICT"));
  });

  test("rotates using the stored owner/provider context and expected version", async () => {
    const keys = await createKeys();
    const existingEnvelope = await encryptProviderCredential(
      context,
      { apiKey: "sk-or-old-secret" },
      keys,
    );
    mockLoad.mockResolvedValue({ ...metadata, envelope: existingEnvelope });
    mockRotate.mockImplementation(async (input) => ({
      ...metadata,
      credentialVersion: 2,
      maskedHint: input.maskedHint,
      envelope: input.envelope,
    }));

    const result = await rotateOpenRouterConnection({
      ownerId: context.ownerId,
      connectionId: context.connectionId,
      expectedCredentialVersion: 1,
      apiKey: "sk-or-new-secret-5678",
      keys,
    });

    const input = mockRotate.mock.calls[0][0];
    expect(input.context).toEqual(context);
    expect(input.expectedCredentialVersion).toBe(1);
    expect(input.maskedHint).toBe("••••5678");
    expect(result.credentialVersion).toBe(2);
  });

  test("rotates DataForSEO credentials with the stored provider context", async () => {
    const keys = await createKeys();
    const existingEnvelope = await encryptProviderCredential(
      dataForSeoContext,
      { login: "owner@example.com", password: "old-sensitive-password" },
      keys,
    );
    mockLoad.mockResolvedValue({
      ...dataForSeoMetadata,
      envelope: existingEnvelope,
    });
    mockRotate.mockImplementation(async (input) => ({
      ...dataForSeoMetadata,
      credentialVersion: 2,
      envelope: input.envelope,
    }));

    const result = await rotateDataForSeoConnection({
      ownerId: context.ownerId,
      connectionId: dataForSeoContext.connectionId,
      expectedCredentialVersion: 1,
      login: "owner@example.com",
      password: "new-sensitive-password",
      keys,
    });

    expect(mockRotate.mock.calls[0][0].context).toEqual(dataForSeoContext);
    expect(result.provider).toBe("dataforseo");
    expect(result.credentialVersion).toBe(2);
  });

  test("uses owner-scoped delete and maps a miss to not found", async () => {
    mockDelete.mockResolvedValue(false);

    await expect(
      removeProviderConnection(context.ownerId, context.connectionId),
    ).rejects.toSatisfy(expectServiceError("CONNECTION_NOT_FOUND"));
    expect(mockDelete).toHaveBeenCalledWith(context.ownerId, context.connectionId);
  });
});
