import "server-only";

import { DATAFORSEO_API_BASE_URL } from "@/lib/providers/dataforseo";
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

export type ProviderCredentialVerificationCode =
  | "VERIFIED"
  | "INVALID_CREDENTIAL"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "VERIFICATION_FAILED"
  | "CREDENTIAL_UNAVAILABLE";

export type OpenRouterCredentialVerifier = (
  apiKey: string,
) => Promise<ProviderCredentialVerificationCode>;

export type DataForSeoCredentialVerifier = (
  login: string,
  password: string,
) => Promise<ProviderCredentialVerificationCode>;

export type OpenRouterVerificationCode = ProviderCredentialVerificationCode;

export type ProviderConnectionVerificationResult = Readonly<{
  connection: PublicProviderConnection;
  verification: Readonly<{
    status: "valid" | "invalid" | "error";
    code: ProviderCredentialVerificationCode;
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

export const verifyDataForSeoCredential: DataForSeoCredentialVerifier = async (
  login,
  password,
) => {
  try {
    const authorization = Buffer.from(`${login}:${password}`).toString("base64");
    const response = await fetch(`${DATAFORSEO_API_BASE_URL}/appendix/user_data`, {
      method: "GET",
      headers: { Authorization: `Basic ${authorization}` },
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
  code: ProviderCredentialVerificationCode,
): "valid" | "invalid" | "error" => {
  if (code === "VERIFIED") return "valid";
  if (code === "INVALID_CREDENTIAL") return "invalid";
  return "error";
};

const updateStatus = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  provider: "openrouter" | "dataforseo";
  credentialVersion: number;
  code: ProviderCredentialVerificationCode;
}>) => {
  try {
    return await updateProviderConnectionVerification({
      context: {
        ownerId: input.ownerId,
        connectionId: input.connectionId,
        provider: input.provider,
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
      provider: "openrouter",
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
      provider: "openrouter",
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
    provider: "openrouter",
    credentialVersion: connection.credentialVersion,
    code,
  });
  return {
    connection: toPublicProviderConnection(updated),
    verification: { status, code },
  };
};

export const verifyDataForSeoConnection = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  decryptionKeys: ProviderCredentialDecryptionKeys;
  verifier?: DataForSeoCredentialVerifier;
}>): Promise<ProviderConnectionVerificationResult> => {
  try {
    const rateLimit = await claimProviderVerificationAttempt(
      input.ownerId,
      "dataforseo",
    );
    if (!rateLimit.allowed) return fail("RATE_LIMITED");
  } catch (error) {
    if (error instanceof ProviderConnectionServiceError) throw error;
    return fail("RATE_LIMIT_PERSISTENCE_ERROR");
  }

  let connection;
  try {
    connection = await loadProviderConnection(input.ownerId, input.connectionId);
  } catch {
    return fail("PERSISTENCE_ERROR");
  }
  if (!connection || connection.provider !== "dataforseo") {
    return fail("CONNECTION_NOT_FOUND");
  }

  let credential: Record<string, string>;
  try {
    credential = await decryptProviderCredential(
      {
        ownerId: input.ownerId,
        connectionId: input.connectionId,
        provider: "dataforseo",
      },
      connection.envelope,
      input.decryptionKeys,
    );
  } catch {
    const updated = await updateStatus({
      ownerId: input.ownerId,
      connectionId: input.connectionId,
      provider: "dataforseo",
      credentialVersion: connection.credentialVersion,
      code: "CREDENTIAL_UNAVAILABLE",
    });
    return {
      connection: toPublicProviderConnection(updated),
      verification: { status: "error", code: "CREDENTIAL_UNAVAILABLE" },
    };
  }

  if (
    Object.keys(credential).length !== 2
    || typeof credential.login !== "string"
    || credential.login.length === 0
    || typeof credential.password !== "string"
    || credential.password.length === 0
  ) {
    const updated = await updateStatus({
      ownerId: input.ownerId,
      connectionId: input.connectionId,
      provider: "dataforseo",
      credentialVersion: connection.credentialVersion,
      code: "CREDENTIAL_UNAVAILABLE",
    });
    return {
      connection: toPublicProviderConnection(updated),
      verification: { status: "error", code: "CREDENTIAL_UNAVAILABLE" },
    };
  }

  const code = await (input.verifier ?? verifyDataForSeoCredential)(
    credential.login,
    credential.password,
  );
  const status = verificationStatus(code);
  const updated = await updateStatus({
    ownerId: input.ownerId,
    connectionId: input.connectionId,
    provider: "dataforseo",
    credentialVersion: connection.credentialVersion,
    code,
  });
  return {
    connection: toPublicProviderConnection(updated),
    verification: { status, code },
  };
};

export const verifyManagedProviderConnection = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  decryptionKeys: ProviderCredentialDecryptionKeys;
}>): Promise<ProviderConnectionVerificationResult> => {
  let connection;
  try {
    connection = await loadProviderConnection(input.ownerId, input.connectionId);
  } catch {
    return fail("PERSISTENCE_ERROR");
  }
  if (!connection) return fail("CONNECTION_NOT_FOUND");
  if (connection.provider === "openrouter") {
    return verifyOpenRouterConnection(input);
  }
  if (connection.provider === "dataforseo") {
    return verifyDataForSeoConnection(input);
  }
  return fail("CONNECTION_NOT_FOUND");
};
