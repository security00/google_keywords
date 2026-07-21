import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { requireEffectiveUser } from "@/lib/authz";
import { loadActiveProviderCredentialEncryptionKeys } from "@/lib/provider-connections/keyring";
import {
  ProviderConnectionServiceError,
  createOpenRouterConnection,
  listOpenRouterConnections,
  removeProviderConnection,
  rotateOpenRouterConnection,
} from "@/lib/provider-connections/service";
import { GET, POST } from "./route";
import { DELETE, PUT } from "./[id]/route";

vi.mock("@/lib/authz", () => ({
  requireEffectiveUser: vi.fn(),
}));

vi.mock("@/lib/provider-connections/keyring", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/provider-connections/keyring")
  >();
  return {
    ...actual,
    loadActiveProviderCredentialEncryptionKeys: vi.fn(),
  };
});

vi.mock("@/lib/provider-connections/service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/provider-connections/service")
  >();
  return {
    ...actual,
    createOpenRouterConnection: vi.fn(),
    listOpenRouterConnections: vi.fn(),
    removeProviderConnection: vi.fn(),
    rotateOpenRouterConnection: vi.fn(),
  };
});

const mockRequireEffectiveUser = vi.mocked(requireEffectiveUser);
const mockLoadKeys = vi.mocked(loadActiveProviderCredentialEncryptionKeys);
const mockCreate = vi.mocked(createOpenRouterConnection);
const mockList = vi.mocked(listOpenRouterConnections);
const mockRemove = vi.mocked(removeProviderConnection);
const mockRotate = vi.mocked(rotateOpenRouterConnection);

const publicConnection = {
  id: "connection-1",
  provider: "openrouter" as const,
  label: "Primary",
  maskedHint: "••••1234",
  credentialVersion: 1,
  verificationStatus: "unverified" as const,
  verifiedAt: null,
  lastVerificationCode: null,
  createdAt: "2026-07-21T00:00:00.000Z",
  updatedAt: "2026-07-21T00:00:00.000Z",
};

const cookiePrincipal = {
  userId: "owner-1",
  role: "student" as const,
  scopes: [],
  authMethod: "cookie" as const,
  access: { allowed: true as const },
};

const mutationRequest = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: {
      origin: "https://www.discoverkeywords.co",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("Provider Connection management routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BYOK_PROVIDER_CONNECTIONS_ENABLED", "true");
    mockRequireEffectiveUser.mockResolvedValue(cookiePrincipal as never);
    mockLoadKeys.mockResolvedValue({} as never);
    mockList.mockResolvedValue([publicConnection]);
    mockCreate.mockResolvedValue(publicConnection);
    mockRotate.mockResolvedValue({ ...publicConnection, credentialVersion: 2 });
    mockRemove.mockResolvedValue();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("lists only public connection metadata", async () => {
    const response = await GET(new Request(
      "https://www.discoverkeywords.co/api/provider-connections",
    ));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith("owner-1");
    expect(serialized).not.toMatch(/ciphertext|wrappedDek|fingerprintHmac|ownerId|apiKey/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("creates an OpenRouter connection without echoing the credential", async () => {
    const response = await POST(mutationRequest(
      "https://www.discoverkeywords.co/api/provider-connections",
      "POST",
      {
        provider: "openrouter",
        label: "Primary",
        credential: { apiKey: "sk-or-sensitive-1234" },
      },
    ));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-1",
      label: "Primary",
      apiKey: "sk-or-sensitive-1234",
    }));
    expect(serialized).not.toContain("sk-or-sensitive-1234");
    expect(serialized).toContain("••••1234");
  });

  test("rejects arbitrary Base URL fields before loading encryption keys", async () => {
    const response = await POST(mutationRequest(
      "https://www.discoverkeywords.co/api/provider-connections",
      "POST",
      {
        provider: "openrouter",
        credential: {
          apiKey: "sk-or-sensitive-1234",
          baseUrl: "https://attacker.example",
        },
      },
    ));

    expect(response.status).toBe(400);
    expect(mockLoadKeys).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("rotates with the route id and expected credential version", async () => {
    const response = await PUT(
      mutationRequest(
        "https://www.discoverkeywords.co/api/provider-connections/connection-1",
        "PUT",
        {
          credential: { apiKey: "sk-or-rotated-5678" },
          expectedCredentialVersion: 1,
        },
      ),
      { params: Promise.resolve({ id: "connection-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockRotate).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-1",
      connectionId: "connection-1",
      expectedCredentialVersion: 1,
      apiKey: "sk-or-rotated-5678",
    }));
  });

  test("returns the same 404 for missing and cross-owner deletes", async () => {
    mockRemove.mockRejectedValue(
      new ProviderConnectionServiceError("CONNECTION_NOT_FOUND"),
    );
    const response = await DELETE(
      mutationRequest(
        "https://www.discoverkeywords.co/api/provider-connections/guessed-id",
        "DELETE",
      ),
      { params: Promise.resolve({ id: "guessed-id" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe("CONNECTION_NOT_FOUND");
    expect(mockRemove).toHaveBeenCalledWith("owner-1", "guessed-id");
  });

  test("returns 204 after owner-scoped hard deletion", async () => {
    const response = await DELETE(
      mutationRequest(
        "https://www.discoverkeywords.co/api/provider-connections/connection-1",
        "DELETE",
      ),
      { params: Promise.resolve({ id: "connection-1" }) },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
