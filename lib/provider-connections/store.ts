import "server-only";

import { d1Batch, d1Query, type D1QueryResult } from "@/lib/d1";
import {
  PROVIDER_CREDENTIAL_ENCRYPTION_VERSION,
  PROVIDER_CREDENTIAL_FINGERPRINT_VERSION,
  SUPPORTED_PROVIDER_IDS,
  type ProviderCredentialContext,
  type ProviderCredentialEnvelope,
  type ProviderId,
} from "./credential-crypto";

export type ProviderConnectionVerificationStatus =
  | "unverified"
  | "valid"
  | "invalid"
  | "error";

export type ProviderConnectionMetadata = Readonly<{
  connectionId: string;
  ownerId: string;
  provider: ProviderId;
  label: string;
  credentialVersion: number;
  maskedHint: string;
  verificationStatus: ProviderConnectionVerificationStatus;
  verifiedAt: string | null;
  lastVerificationCode: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type StoredProviderConnection = ProviderConnectionMetadata & Readonly<{
  envelope: ProviderCredentialEnvelope;
}>;

export type ProviderConnectionAuditAction =
  | "created"
  | "credential_rotated"
  | "kek_rewrapped"
  | "deleted"
  | "verification_succeeded"
  | "verification_failed";

export type ProviderConnectionAuditOutcome = "success" | "failure";

export type ProviderConnectionAuditEvent = Readonly<{
  eventId: string;
  connectionId: string;
  ownerId: string;
  provider: ProviderId;
  action: ProviderConnectionAuditAction;
  outcome: ProviderConnectionAuditOutcome;
  errorCode: string | null;
  createdAt: string;
}>;

export type ProviderConnectionStoreErrorCode =
  | "INVALID_INPUT"
  | "CONNECTION_CONFLICT"
  | "CONNECTION_NOT_FOUND"
  | "CREDENTIAL_VERSION_CONFLICT"
  | "PERSISTENCE_ERROR";

export class ProviderConnectionStoreError extends Error {
  readonly code: ProviderConnectionStoreErrorCode;

  constructor(code: ProviderConnectionStoreErrorCode) {
    super(code);
    this.name = "ProviderConnectionStoreError";
    this.code = code;
  }
}

type ProviderConnectionRow = {
  connection_id: string;
  owner_id: string;
  provider: string;
  label: string;
  credential_ciphertext: string;
  credential_iv: string;
  wrapped_dek: string;
  kek_version: string;
  encryption_version: number;
  fingerprint_hmac: string;
  fingerprint_version: number;
  fingerprint_key_version: string;
  credential_version: number;
  masked_hint: string;
  verification_status: string;
  verified_at: string | null;
  last_verification_code: string | null;
  created_at: string;
  updated_at: string;
};

type ProviderConnectionMetadataRow = Omit<
  ProviderConnectionRow,
  | "credential_ciphertext"
  | "credential_iv"
  | "wrapped_dek"
  | "kek_version"
  | "encryption_version"
  | "fingerprint_hmac"
  | "fingerprint_version"
  | "fingerprint_key_version"
>;

type ProviderConnectionAuditRow = {
  event_id: string;
  connection_id: string;
  owner_id: string;
  provider: string;
  action: string;
  outcome: string;
  error_code: string | null;
  created_at: string;
};

const CONNECTION_COLUMNS = `
  connection_id, owner_id, provider, label,
  credential_ciphertext, credential_iv, wrapped_dek, kek_version,
  encryption_version, fingerprint_hmac, fingerprint_version,
  fingerprint_key_version, credential_version, masked_hint,
  verification_status, verified_at, last_verification_code,
  created_at, updated_at
`;

const METADATA_COLUMNS = `
  connection_id, owner_id, provider, label, credential_version, masked_hint,
  verification_status, verified_at, last_verification_code,
  created_at, updated_at
`;

const MAX_CONTEXT_LENGTH = 256;
const MAX_LABEL_LENGTH = 120;
const MAX_MASK_LENGTH = 120;
const MAX_VERSION_LENGTH = 64;
const SAFE_ERROR_CODE = /^[A-Z0-9_]{1,64}$/;

const fail = (code: ProviderConnectionStoreErrorCode): never => {
  throw new ProviderConnectionStoreError(code);
};

const isProviderId = (value: string): value is ProviderId =>
  SUPPORTED_PROVIDER_IDS.some((provider) => provider === value);

const isVerificationStatus = (
  value: string,
): value is ProviderConnectionVerificationStatus =>
  value === "unverified"
  || value === "valid"
  || value === "invalid"
  || value === "error";

const isAuditAction = (value: string): value is ProviderConnectionAuditAction =>
  value === "created"
  || value === "credential_rotated"
  || value === "kek_rewrapped"
  || value === "deleted"
  || value === "verification_succeeded"
  || value === "verification_failed";

const isAuditOutcome = (value: string): value is ProviderConnectionAuditOutcome =>
  value === "success" || value === "failure";

const assertIdentifier = (value: string) => {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_CONTEXT_LENGTH
  ) {
    fail("INVALID_INPUT");
  }
};

const assertContext = (context: ProviderCredentialContext) => {
  assertIdentifier(context.connectionId);
  assertIdentifier(context.ownerId);
  if (!isProviderId(context.provider)) fail("INVALID_INPUT");
};

const assertDisplayFields = (label: string, maskedHint: string) => {
  if (typeof label !== "string" || label.length > MAX_LABEL_LENGTH) {
    fail("INVALID_INPUT");
  }
  if (
    typeof maskedHint !== "string"
    || maskedHint.length === 0
    || maskedHint.length > MAX_MASK_LENGTH
  ) {
    fail("INVALID_INPUT");
  }
};

const assertEnvelope = (envelope: ProviderCredentialEnvelope) => {
  if (
    envelope.encryptionVersion !== PROVIDER_CREDENTIAL_ENCRYPTION_VERSION
    || envelope.fingerprintVersion !== PROVIDER_CREDENTIAL_FINGERPRINT_VERSION
    || typeof envelope.kekVersion !== "string"
    || envelope.kekVersion.length === 0
    || envelope.kekVersion.length > MAX_VERSION_LENGTH
    || typeof envelope.fingerprintKeyVersion !== "string"
    || envelope.fingerprintKeyVersion.length === 0
    || envelope.fingerprintKeyVersion.length > MAX_VERSION_LENGTH
  ) {
    fail("INVALID_INPUT");
  }
  for (const value of [
    envelope.ciphertext,
    envelope.iv,
    envelope.wrappedDek,
    envelope.fingerprintHmac,
  ]) {
    if (typeof value !== "string" || value.length === 0) fail("INVALID_INPUT");
  }
};

const toMetadata = (
  row: ProviderConnectionMetadataRow,
): ProviderConnectionMetadata => {
  const credentialVersion = Number(row.credential_version);
  if (
    !isProviderId(row.provider)
    || !isVerificationStatus(row.verification_status)
    || !Number.isInteger(credentialVersion)
    || credentialVersion < 1
  ) {
    return fail("PERSISTENCE_ERROR");
  }
  return {
    connectionId: row.connection_id,
    ownerId: row.owner_id,
    provider: row.provider,
    label: row.label,
    credentialVersion,
    maskedHint: row.masked_hint,
    verificationStatus: row.verification_status,
    verifiedAt: row.verified_at,
    lastVerificationCode: row.last_verification_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const toStoredConnection = (row: ProviderConnectionRow): StoredProviderConnection => {
  const encryptionVersion = row.encryption_version;
  const fingerprintVersion = row.fingerprint_version;
  if (
    encryptionVersion !== PROVIDER_CREDENTIAL_ENCRYPTION_VERSION
    || fingerprintVersion !== PROVIDER_CREDENTIAL_FINGERPRINT_VERSION
  ) {
    return fail("PERSISTENCE_ERROR");
  }
  return {
    ...toMetadata(row),
    envelope: {
      encryptionVersion,
      fingerprintVersion,
      kekVersion: row.kek_version,
      fingerprintKeyVersion: row.fingerprint_key_version,
      ciphertext: row.credential_ciphertext,
      iv: row.credential_iv,
      wrappedDek: row.wrapped_dek,
      fingerprintHmac: row.fingerprint_hmac,
    },
  };
};

const toAuditEvent = (row: ProviderConnectionAuditRow): ProviderConnectionAuditEvent => {
  if (
    !isProviderId(row.provider)
    || !isAuditAction(row.action)
    || !isAuditOutcome(row.outcome)
  ) {
    return fail("PERSISTENCE_ERROR");
  }
  return {
    eventId: row.event_id,
    connectionId: row.connection_id,
    ownerId: row.owner_id,
    provider: row.provider,
    action: row.action,
    outcome: row.outcome,
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
};

const isUniqueConstraintError = (error: unknown) =>
  error instanceof Error
  && error.message.toLowerCase().includes("unique constraint");

const queryStore = async <T>(
  sql: string,
  params: readonly unknown[],
): Promise<D1QueryResult<T>> => {
  try {
    return await d1Query<T>(sql, [...params]);
  } catch (error) {
    if (error instanceof ProviderConnectionStoreError) throw error;
    return fail("PERSISTENCE_ERROR");
  }
};

export const listProviderConnections = async (
  ownerId: string,
): Promise<ProviderConnectionMetadata[]> => {
  assertIdentifier(ownerId);
  const { rows } = await queryStore<ProviderConnectionMetadataRow>(
    `SELECT ${METADATA_COLUMNS}
     FROM provider_connections
     WHERE owner_id = ?
     ORDER BY updated_at DESC, connection_id ASC`,
    [ownerId],
  );
  return rows.map(toMetadata);
};

export const loadProviderConnection = async (
  ownerId: string,
  connectionId: string,
): Promise<StoredProviderConnection | null> => {
  assertIdentifier(ownerId);
  assertIdentifier(connectionId);
  const { rows } = await queryStore<ProviderConnectionRow>(
    `SELECT ${CONNECTION_COLUMNS}
     FROM provider_connections
     WHERE owner_id = ? AND connection_id = ?
     LIMIT 1`,
    [ownerId, connectionId],
  );
  return rows[0] ? toStoredConnection(rows[0]) : null;
};

export const loadProviderConnectionByProvider = async (
  ownerId: string,
  provider: ProviderId,
): Promise<StoredProviderConnection | null> => {
  assertIdentifier(ownerId);
  if (!isProviderId(provider)) fail("INVALID_INPUT");
  const { rows } = await queryStore<ProviderConnectionRow>(
    `SELECT ${CONNECTION_COLUMNS}
     FROM provider_connections
     WHERE owner_id = ? AND provider = ?
     LIMIT 1`,
    [ownerId, provider],
  );
  return rows[0] ? toStoredConnection(rows[0]) : null;
};

export const createProviderConnection = async (input: Readonly<{
  context: ProviderCredentialContext;
  envelope: ProviderCredentialEnvelope;
  label: string;
  maskedHint: string;
}>): Promise<StoredProviderConnection> => {
  assertContext(input.context);
  assertEnvelope(input.envelope);
  assertDisplayFields(input.label, input.maskedHint);
  const now = new Date().toISOString();
  const auditEventId = crypto.randomUUID();

  try {
    await d1Batch([
      {
        sql: `INSERT INTO provider_connections (
                connection_id, owner_id, provider, label,
                credential_ciphertext, credential_iv, wrapped_dek,
                kek_version, encryption_version, fingerprint_hmac,
                fingerprint_version, fingerprint_key_version,
                credential_version, masked_hint, verification_status,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'unverified', ?, ?)`,
        params: [
          input.context.connectionId,
          input.context.ownerId,
          input.context.provider,
          input.label,
          input.envelope.ciphertext,
          input.envelope.iv,
          input.envelope.wrappedDek,
          input.envelope.kekVersion,
          input.envelope.encryptionVersion,
          input.envelope.fingerprintHmac,
          input.envelope.fingerprintVersion,
          input.envelope.fingerprintKeyVersion,
          input.maskedHint,
          now,
          now,
        ],
      },
      {
        sql: `INSERT INTO provider_connection_audit_events (
                event_id, connection_id, owner_id, provider,
                action, outcome, error_code, created_at
              ) VALUES (?, ?, ?, ?, 'created', 'success', NULL, ?)`,
        params: [
          auditEventId,
          input.context.connectionId,
          input.context.ownerId,
          input.context.provider,
          now,
        ],
      },
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) fail("CONNECTION_CONFLICT");
    return fail("PERSISTENCE_ERROR");
  }

  const connection = await loadProviderConnection(
    input.context.ownerId,
    input.context.connectionId,
  );
  return connection ?? fail("PERSISTENCE_ERROR");
};

export const rotateProviderConnectionCredential = async (input: Readonly<{
  context: ProviderCredentialContext;
  expectedCredentialVersion: number;
  envelope: ProviderCredentialEnvelope;
  label: string;
  maskedHint: string;
}>): Promise<StoredProviderConnection> => {
  assertContext(input.context);
  assertEnvelope(input.envelope);
  assertDisplayFields(input.label, input.maskedHint);
  if (!Number.isInteger(input.expectedCredentialVersion) || input.expectedCredentialVersion < 1) {
    fail("INVALID_INPUT");
  }
  const nextCredentialVersion = input.expectedCredentialVersion + 1;
  const now = new Date().toISOString();
  const auditEventId = crypto.randomUUID();

  let results;
  try {
    results = await d1Batch([
      {
        sql: `UPDATE provider_connections
              SET label = ?,
                  credential_ciphertext = ?, credential_iv = ?, wrapped_dek = ?,
                  kek_version = ?, encryption_version = ?, fingerprint_hmac = ?,
                  fingerprint_version = ?, fingerprint_key_version = ?,
                  credential_version = ?, masked_hint = ?,
                  verification_status = 'unverified', verified_at = NULL,
                  last_verification_code = NULL, updated_at = ?
              WHERE owner_id = ? AND connection_id = ? AND provider = ?
                AND credential_version = ?`,
        params: [
          input.label,
          input.envelope.ciphertext,
          input.envelope.iv,
          input.envelope.wrappedDek,
          input.envelope.kekVersion,
          input.envelope.encryptionVersion,
          input.envelope.fingerprintHmac,
          input.envelope.fingerprintVersion,
          input.envelope.fingerprintKeyVersion,
          nextCredentialVersion,
          input.maskedHint,
          now,
          input.context.ownerId,
          input.context.connectionId,
          input.context.provider,
          input.expectedCredentialVersion,
        ],
      },
      {
        sql: `INSERT INTO provider_connection_audit_events (
                event_id, connection_id, owner_id, provider,
                action, outcome, error_code, created_at
              )
              SELECT ?, ?, ?, ?, 'credential_rotated', 'success', NULL, ?
              WHERE changes() = 1`,
        params: [
          auditEventId,
          input.context.connectionId,
          input.context.ownerId,
          input.context.provider,
          now,
        ],
      },
    ]);
  } catch {
    return fail("PERSISTENCE_ERROR");
  }

  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    const existing = await loadProviderConnection(
      input.context.ownerId,
      input.context.connectionId,
    );
    if (!existing) fail("CONNECTION_NOT_FOUND");
    fail("CREDENTIAL_VERSION_CONFLICT");
  }

  const connection = await loadProviderConnection(
    input.context.ownerId,
    input.context.connectionId,
  );
  return connection ?? fail("PERSISTENCE_ERROR");
};

export const rewrapProviderConnectionDek = async (input: Readonly<{
  context: ProviderCredentialContext;
  expectedCredentialVersion: number;
  expectedKekVersion: string;
  envelope: ProviderCredentialEnvelope;
}>): Promise<StoredProviderConnection> => {
  assertContext(input.context);
  assertEnvelope(input.envelope);
  if (
    !Number.isInteger(input.expectedCredentialVersion)
    || input.expectedCredentialVersion < 1
    || !input.expectedKekVersion
    || input.expectedKekVersion.length > 64
    || input.envelope.kekVersion === input.expectedKekVersion
  ) {
    fail("INVALID_INPUT");
  }
  const now = new Date().toISOString();
  const auditEventId = crypto.randomUUID();

  let results;
  try {
    results = await d1Batch([
      {
        sql: `UPDATE provider_connections
              SET wrapped_dek = ?, kek_version = ?, updated_at = ?
              WHERE owner_id = ? AND connection_id = ? AND provider = ?
                AND credential_version = ? AND kek_version = ?`,
        params: [
          input.envelope.wrappedDek,
          input.envelope.kekVersion,
          now,
          input.context.ownerId,
          input.context.connectionId,
          input.context.provider,
          input.expectedCredentialVersion,
          input.expectedKekVersion,
        ],
      },
      {
        sql: `INSERT INTO provider_connection_audit_events (
                event_id, connection_id, owner_id, provider,
                action, outcome, error_code, created_at
              )
              SELECT ?, ?, ?, ?, 'kek_rewrapped', 'success', NULL, ?
              WHERE changes() = 1`,
        params: [
          auditEventId,
          input.context.connectionId,
          input.context.ownerId,
          input.context.provider,
          now,
        ],
      },
    ]);
  } catch {
    return fail("PERSISTENCE_ERROR");
  }

  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    const existing = await loadProviderConnection(
      input.context.ownerId,
      input.context.connectionId,
    );
    if (!existing) fail("CONNECTION_NOT_FOUND");
    fail("CREDENTIAL_VERSION_CONFLICT");
  }
  const connection = await loadProviderConnection(
    input.context.ownerId,
    input.context.connectionId,
  );
  return connection ?? fail("PERSISTENCE_ERROR");
};

export const deleteProviderConnection = async (
  ownerId: string,
  connectionId: string,
): Promise<boolean> => {
  assertIdentifier(ownerId);
  assertIdentifier(connectionId);
  const now = new Date().toISOString();
  const auditEventId = crypto.randomUUID();

  let results;
  try {
    results = await d1Batch([
      {
        sql: `INSERT INTO provider_connection_audit_events (
                event_id, connection_id, owner_id, provider,
                action, outcome, error_code, created_at
              )
              SELECT ?, connection_id, owner_id, provider,
                     'deleted', 'success', NULL, ?
              FROM provider_connections
              WHERE owner_id = ? AND connection_id = ?`,
        params: [auditEventId, now, ownerId, connectionId],
      },
      {
        sql: `DELETE FROM provider_connections
              WHERE owner_id = ? AND connection_id = ?`,
        params: [ownerId, connectionId],
      },
    ]);
  } catch {
    return fail("PERSISTENCE_ERROR");
  }

  return (results[1]?.meta?.changes ?? 0) === 1;
};

export const updateProviderConnectionVerification = async (input: Readonly<{
  context: ProviderCredentialContext;
  expectedCredentialVersion: number;
  status: Exclude<ProviderConnectionVerificationStatus, "unverified">;
  verificationCode: string;
}>): Promise<StoredProviderConnection> => {
  assertContext(input.context);
  if (
    !Number.isInteger(input.expectedCredentialVersion)
    || input.expectedCredentialVersion < 1
    || !isVerificationStatus(input.status)
    || !SAFE_ERROR_CODE.test(input.verificationCode)
  ) {
    fail("INVALID_INPUT");
  }
  const now = new Date().toISOString();
  const verifiedAt = input.status === "valid" ? now : null;
  const action: ProviderConnectionAuditAction = input.status === "valid"
    ? "verification_succeeded"
    : "verification_failed";
  const outcome: ProviderConnectionAuditOutcome = input.status === "valid"
    ? "success"
    : "failure";

  let results;
  try {
    results = await d1Batch([
      {
        sql: `UPDATE provider_connections
              SET verification_status = ?, verified_at = ?,
                  last_verification_code = ?, updated_at = ?
              WHERE owner_id = ? AND connection_id = ? AND provider = ?
                AND credential_version = ?`,
        params: [
          input.status,
          verifiedAt,
          input.verificationCode,
          now,
          input.context.ownerId,
          input.context.connectionId,
          input.context.provider,
          input.expectedCredentialVersion,
        ],
      },
      {
        sql: `INSERT INTO provider_connection_audit_events (
                event_id, connection_id, owner_id, provider,
                action, outcome, error_code, created_at
              )
              SELECT ?, ?, ?, ?, ?, ?, ?, ?
              WHERE changes() = 1`,
        params: [
          crypto.randomUUID(),
          input.context.connectionId,
          input.context.ownerId,
          input.context.provider,
          action,
          outcome,
          input.verificationCode,
          now,
        ],
      },
    ]);
  } catch {
    return fail("PERSISTENCE_ERROR");
  }

  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    const existing = await loadProviderConnection(
      input.context.ownerId,
      input.context.connectionId,
    );
    if (!existing) fail("CONNECTION_NOT_FOUND");
    fail("CREDENTIAL_VERSION_CONFLICT");
  }
  const connection = await loadProviderConnection(
    input.context.ownerId,
    input.context.connectionId,
  );
  return connection ?? fail("PERSISTENCE_ERROR");
};

export const recordProviderConnectionAuditEvent = async (input: Readonly<{
  context: ProviderCredentialContext;
  action: ProviderConnectionAuditAction;
  outcome: ProviderConnectionAuditOutcome;
  errorCode?: string | null;
}>): Promise<void> => {
  assertContext(input.context);
  if (!isAuditAction(input.action) || !isAuditOutcome(input.outcome)) {
    fail("INVALID_INPUT");
  }
  if (input.errorCode != null && !SAFE_ERROR_CODE.test(input.errorCode)) {
    fail("INVALID_INPUT");
  }

  await queryStore(
    `INSERT INTO provider_connection_audit_events (
       event_id, connection_id, owner_id, provider,
       action, outcome, error_code, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      input.context.connectionId,
      input.context.ownerId,
      input.context.provider,
      input.action,
      input.outcome,
      input.errorCode ?? null,
      new Date().toISOString(),
    ],
  );
};

export const listProviderConnectionAuditEvents = async (
  ownerId: string,
  limit = 100,
): Promise<ProviderConnectionAuditEvent[]> => {
  assertIdentifier(ownerId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("INVALID_INPUT");
  const { rows } = await queryStore<ProviderConnectionAuditRow>(
    `SELECT event_id, connection_id, owner_id, provider,
            action, outcome, error_code, created_at
     FROM provider_connection_audit_events
     WHERE owner_id = ?
     ORDER BY created_at DESC, event_id DESC
     LIMIT ?`,
    [ownerId, limit],
  );
  return rows.map(toAuditEvent);
};
