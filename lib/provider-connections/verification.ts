import "server-only";

import { OPENROUTER_API_BASE_URL } from "@/lib/providers/openrouter";
import {
  decryptProviderCredential,
  type ProviderCredentialDecryptionKeys,
} from "./credential-crypto";
import {
  ProviderConnectionServiceError,
  toPublicProviderConnection,
  type PublicProviderConnection,
} from "./service";
import {
  ProviderConnectionStoreError,
  loadProviderConnection,
  updateProviderConnectionVerification,
} from "./store";
import {
  ProviderVerificationRateLimitError,
  claimProviderVerificationAttempt,
} from "./verification-rate-limit";

export type OpenRouterVerificationCode =
  | "VERIFIED"
  | "INVALID_CREDENTIAL"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "VERIFICATION_FAILED"
  | "CREDENTIAL_UNAVAILABLE";

export type OpenRouterCredentialVerifier = (
  apiKey: string,
) => Promise<OpenRouterVerificationCode>;

export type ProviderConnectionVerificationResult = Readonly<{
  connection: PublicProviderConnection;
  verification: Readonly<{
    status: "valid" | "invalid" | "error";
    code: OpenRouterVerificationCode;
  }>;
}>;

const fail = (
  code: ConstructorParameters<typeof ProviderConnectionServiceError>[0],
): never => {
  throw new ProviderConnectionServiceError(code);
};

export const verifyOpenRouterCredential: OpenRouterCredentialVerifier = async (
  apiKey,
) => {
  try {
    const response = await fetch(`${OPENROUTER_API_BASE_URL}/key`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    await response.body?.cancel();
    if (response.status === 200) return "VERIFIED";
    if (response.status === 401 || response.status === 403) {
      return "INVALID_CREDENTIAL";
    }
    if (response.status === 429) return "PROVIDER_RATE_LIMITED";
    if (response.status >= 500) return "PROVIDER_UNAVAILABLE";
    return "VERIFICATION_FAILED";
  } catch {
    return "PROVIDER_UNAVAILABLE";
  }
};

const verificationStatus = (
  code: OpenRouterVerificationCode,
): "valid" | "invalid" | "error" => {
  if (code === "VERIFIED") return "valid";
  if (code === "INVALID_CREDENTIAL") return "invalid";
  return "error";
};

const updateStatus = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  credentialVersion: number;
  code: OpenRouterVerificationCode;
}>) => {
  try {
    return await updateProviderConnectionVerification({
      context: {
        ownerId: input.ownerId,
        connectionId: input.connectionId,
        provider: "openrouter",
      },
      expectedCredentialVersion: input.credentialVersion,
      status: verificationStatus(input.code),
      verificationCode: input.code,
    });
  } catch (error) {
    if (error instanceof ProviderConnectionStoreError) {
      if (error.code === "CONNECTION_NOT_FOUND") return fail("CONNECTION_NOT_FOUND");
      if (error.code === "CREDENTIAL_VERSION_CONFLICT") {
        return fail("CREDENTIAL_VERSION_CONFLICT");
      }
    }
    return fail("PERSISTENCE_ERROR");
  }
};

export const verifyOpenRouterConnection = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  decryptionKeys: ProviderCredentialDecryptionKeys;
  verifier?: OpenRouterCredentialVerifier;
}>): Promise<ProviderConnectionVerificationResult> => {
  try {
    const rateLimit = await claimProviderVerificationAttempt(
      input.ownerId,
      "openrouter",
    );
    if (!rateLimit.allowed) return fail("RATE_LIMITED");
  } catch (error) {
    if (error instanceof ProviderConnectionServiceError) throw error;
    if (error instanceof ProviderVerificationRateLimitError) {
      return fail("RATE_LIMIT_PERSISTENCE_ERROR");
    }
    return fail("RATE_LIMIT_PERSISTENCE_ERROR");
  }

  let connection;
  try {
    connection = await loadProviderConnection(input.ownerId, input.connectionId);
  } catch {
    return fail("PERSISTENCE_ERROR");
  }
  if (!connection || connection.provider !== "openrouter") {
    return fail("CONNECTION_NOT_FOUND");
  }

  let credential: Record<string, string>;
  try {
    credential = await decryptProviderCredential(
      {
        ownerId: input.ownerId,
        connectionId: input.connectionId,
        provider: "openrouter",
      },
      connection.envelope,
      input.decryptionKeys,
    );
  } catch {
    const updated = await updateStatus({
      ownerId: input.ownerId,
      connectionId: input.connectionId,
      credentialVersion: connection.credentialVersion,
      code: "CREDENTIAL_UNAVAILABLE",
    });
    return {
      connection: toPublicProviderConnection(updated),
      verification: { status: "error", code: "CREDENTIAL_UNAVAILABLE" },
    };
  }

  if (
    Object.keys(credential).length !== 1
    || typeof credential.apiKey !== "string"
    || credential.apiKey.length === 0
  ) {
    const updated = await updateStatus({
      ownerId: input.ownerId,
      connectionId: input.connectionId,
      credentialVersion: connection.credentialVersion,
      code: "CREDENTIAL_UNAVAILABLE",
    });
    return {
      connection: toPublicProviderConnection(updated),
      verification: { status: "error", code: "CREDENTIAL_UNAVAILABLE" },
    };
  }

  const code = await (input.verifier ?? verifyOpenRouterCredential)(credential.apiKey);
  const status = verificationStatus(code);
  const updated = await updateStatus({
    ownerId: input.ownerId,
    connectionId: input.connectionId,
    credentialVersion: connection.credentialVersion,
    code,
  });
  return {
    connection: toPublicProviderConnection(updated),
    verification: { status, code },
  };
};
