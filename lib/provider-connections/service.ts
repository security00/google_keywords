import "server-only";

import {
  encryptProviderCredential,
  type ProviderCredentialEncryptionKeys,
} from "./credential-crypto";
import {
  ProviderConnectionStoreError,
  createProviderConnection,
  deleteProviderConnection,
  listProviderConnections,
  loadProviderConnection,
  loadProviderConnectionByProvider,
  rotateProviderConnectionCredential,
  type ProviderConnectionMetadata,
} from "./store";

export type PublicProviderConnection = Readonly<{
  id: string;
  provider: "openrouter";
  label: string;
  maskedHint: string;
  credentialVersion: number;
  verificationStatus: ProviderConnectionMetadata["verificationStatus"];
  verifiedAt: string | null;
  lastVerificationCode: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ProviderConnectionServiceErrorCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_PROVIDER"
  | "CONNECTION_CONFLICT"
  | "CONNECTION_NOT_FOUND"
  | "CREDENTIAL_VERSION_CONFLICT"
  | "ENCRYPTION_FAILED"
  | "PERSISTENCE_ERROR";

export class ProviderConnectionServiceError extends Error {
  readonly code: ProviderConnectionServiceErrorCode;

  constructor(code: ProviderConnectionServiceErrorCode) {
    super(code);
    this.name = "ProviderConnectionServiceError";
    this.code = code;
  }
}

const MAX_OWNER_ID_LENGTH = 256;
const MAX_LABEL_LENGTH = 120;
const MIN_API_KEY_LENGTH = 8;
const MAX_API_KEY_LENGTH = 512;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

const fail = (code: ProviderConnectionServiceErrorCode): never => {
  throw new ProviderConnectionServiceError(code);
};

const assertOwnerId = (ownerId: string) => {
  if (
    typeof ownerId !== "string"
    || ownerId.length === 0
    || ownerId.length > MAX_OWNER_ID_LENGTH
  ) {
    fail("INVALID_INPUT");
  }
};

const normalizeLabel = (value: string | undefined) => {
  const label = value?.trim() || "OpenRouter";
  if (label.length > MAX_LABEL_LENGTH || CONTROL_CHARACTERS.test(label)) {
    return fail("INVALID_INPUT");
  }
  return label;
};

const normalizeApiKey = (value: string) => {
  if (typeof value !== "string") return fail("INVALID_INPUT");
  const apiKey = value.trim();
  if (
    apiKey.length < MIN_API_KEY_LENGTH
    || apiKey.length > MAX_API_KEY_LENGTH
    || CONTROL_CHARACTERS.test(apiKey)
  ) {
    return fail("INVALID_INPUT");
  }
  return apiKey;
};

const maskedHint = (apiKey: string) => `••••${apiKey.slice(-4)}`;

const constantTimeEqual = (left: string, right: string) => {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
};

const mapStoreError = (error: ProviderConnectionStoreError): never => {
  if (error.code === "INVALID_INPUT") return fail("INVALID_INPUT");
  if (error.code === "CONNECTION_CONFLICT") return fail("CONNECTION_CONFLICT");
  if (error.code === "CONNECTION_NOT_FOUND") return fail("CONNECTION_NOT_FOUND");
  if (error.code === "CREDENTIAL_VERSION_CONFLICT") {
    return fail("CREDENTIAL_VERSION_CONFLICT");
  }
  return fail("PERSISTENCE_ERROR");
};

const runStoreOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProviderConnectionStoreError) return mapStoreError(error);
    if (error instanceof ProviderConnectionServiceError) throw error;
    return fail("PERSISTENCE_ERROR");
  }
};

const encryptOpenRouterCredential = async (
  context: Readonly<{
    connectionId: string;
    ownerId: string;
    provider: "openrouter";
  }>,
  apiKey: string,
  keys: ProviderCredentialEncryptionKeys,
) => {
  try {
    return await encryptProviderCredential(context, { apiKey }, keys);
  } catch {
    return fail("ENCRYPTION_FAILED");
  }
};

export const toPublicProviderConnection = (
  connection: ProviderConnectionMetadata,
): PublicProviderConnection => {
  if (connection.provider !== "openrouter") return fail("UNSUPPORTED_PROVIDER");
  return {
    id: connection.connectionId,
    provider: connection.provider,
    label: connection.label,
    maskedHint: connection.maskedHint,
    credentialVersion: connection.credentialVersion,
    verificationStatus: connection.verificationStatus,
    verifiedAt: connection.verifiedAt,
    lastVerificationCode: connection.lastVerificationCode,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
};

export const listOpenRouterConnections = async (
  ownerId: string,
): Promise<PublicProviderConnection[]> => {
  assertOwnerId(ownerId);
  const connections = await runStoreOperation(() => listProviderConnections(ownerId));
  return connections.map(toPublicProviderConnection);
};

export const createOpenRouterConnection = async (input: Readonly<{
  ownerId: string;
  label?: string;
  apiKey: string;
  keys: ProviderCredentialEncryptionKeys;
}>): Promise<PublicProviderConnection> => {
  assertOwnerId(input.ownerId);
  const label = normalizeLabel(input.label);
  const apiKey = normalizeApiKey(input.apiKey);
  const existing = await runStoreOperation(() =>
    loadProviderConnectionByProvider(input.ownerId, "openrouter")
  );
  const connectionId = existing?.connectionId ?? crypto.randomUUID();
  const context = {
    connectionId,
    ownerId: input.ownerId,
    provider: "openrouter" as const,
  };
  const envelope = await encryptOpenRouterCredential(context, apiKey, input.keys);

  if (existing) {
    if (constantTimeEqual(existing.envelope.fingerprintHmac, envelope.fingerprintHmac)) {
      return toPublicProviderConnection(existing);
    }
    return fail("CONNECTION_CONFLICT");
  }

  const created = await runStoreOperation(() => createProviderConnection({
    context,
    envelope,
    label,
    maskedHint: maskedHint(apiKey),
  }));
  return toPublicProviderConnection(created);
};

export const rotateOpenRouterConnection = async (input: Readonly<{
  ownerId: string;
  connectionId: string;
  expectedCredentialVersion: number;
  label?: string;
  apiKey: string;
  keys: ProviderCredentialEncryptionKeys;
}>): Promise<PublicProviderConnection> => {
  assertOwnerId(input.ownerId);
  if (typeof input.connectionId !== "string" || input.connectionId.length === 0) {
    fail("INVALID_INPUT");
  }
  if (
    !Number.isInteger(input.expectedCredentialVersion)
    || input.expectedCredentialVersion < 1
  ) {
    fail("INVALID_INPUT");
  }
  const label = normalizeLabel(input.label);
  const apiKey = normalizeApiKey(input.apiKey);
  const existing = await runStoreOperation(() =>
    loadProviderConnection(input.ownerId, input.connectionId)
  );
  if (!existing) return fail("CONNECTION_NOT_FOUND");
  if (existing.provider !== "openrouter") return fail("UNSUPPORTED_PROVIDER");

  const context = {
    connectionId: existing.connectionId,
    ownerId: input.ownerId,
    provider: "openrouter" as const,
  };
  const envelope = await encryptOpenRouterCredential(context, apiKey, input.keys);
  const rotated = await runStoreOperation(() => rotateProviderConnectionCredential({
    context,
    expectedCredentialVersion: input.expectedCredentialVersion,
    envelope,
    label,
    maskedHint: maskedHint(apiKey),
  }));
  return toPublicProviderConnection(rotated);
};

export const removeProviderConnection = async (
  ownerId: string,
  connectionId: string,
): Promise<void> => {
  assertOwnerId(ownerId);
  if (typeof connectionId !== "string" || connectionId.length === 0) {
    fail("INVALID_INPUT");
  }
  const deleted = await runStoreOperation(() =>
    deleteProviderConnection(ownerId, connectionId)
  );
  if (!deleted) fail("CONNECTION_NOT_FOUND");
};
