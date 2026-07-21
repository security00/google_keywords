import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Batch, d1Query } from "@/lib/d1";
import type { ProviderCredentialEnvelope } from "./credential-crypto";
import {
  ProviderConnectionStoreError,
  createProviderConnection,
  deleteProviderConnection,
  listProviderConnections,
  loadProviderConnection,
  recordProviderConnectionAuditEvent,
  rewrapProviderConnectionDek,
  rotateProviderConnectionCredential,
  updateProviderConnectionVerification,
} from "./store";

vi.mock("@/lib/d1", () => ({
  d1Batch: vi.fn(),
  d1Query: vi.fn(),
}));

const mockD1Batch = vi.mocked(d1Batch);
const mockD1Query = vi.mocked(d1Query);

const context = {
  connectionId: "connection-1",
  ownerId: "owner-1",
  provider: "openrouter" as const,
};

const envelope: ProviderCredentialEnvelope = {
  encryptionVersion: 1,
  fingerprintVersion: 1,
  kekVersion: "kek-v1",
  fingerprintKeyVersion: "fingerprint-v1",
  ciphertext: "encrypted-payload",
  iv: "random-iv",
  wrappedDek: "wrapped-dek",
  fingerprintHmac: "scoped-fingerprint",
};

const fullRow = {
  connection_id: context.connectionId,
  owner_id: context.ownerId,
  provider: context.provider,
  label: "Primary",
  credential_ciphertext: envelope.ciphertext,
  credential_iv: envelope.iv,
  wrapped_dek: envelope.wrappedDek,
  kek_version: envelope.kekVersion,
  encryption_version: envelope.encryptionVersion,
  fingerprint_hmac: envelope.fingerprintHmac,
  fingerprint_version: envelope.fingerprintVersion,
  fingerprint_key_version: envelope.fingerprintKeyVersion,
  credential_version: 1,
  masked_hint: "sk-...1234",
  verification_status: "unverified",
  verified_at: null,
  last_verification_code: null,
  created_at: "2026-07-21T00:00:00.000Z",
  updated_at: "2026-07-21T00:00:00.000Z",
};

const expectStoreError = (code: string) => (error: unknown) => {
  expect(error).toBeInstanceOf(ProviderConnectionStoreError);
  expect((error as ProviderConnectionStoreError).code).toBe(code);
  return true;
};

describe("Provider Connection store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("lists only owner-scoped metadata without selecting encrypted fields", async () => {
    mockD1Query.mockResolvedValue({ rows: [fullRow] });

    const result = await listProviderConnections(context.ownerId);

    const [sql, params] = mockD1Query.mock.calls[0];
    expect(sql).toContain("WHERE owner_id = ?");
    expect(sql).not.toContain("credential_ciphertext");
    expect(sql).not.toContain("wrapped_dek");
    expect(sql).not.toContain("fingerprint_hmac");
    expect(params).toEqual([context.ownerId]);
    expect(result).toEqual([
      {
        connectionId: context.connectionId,
        ownerId: context.ownerId,
        provider: context.provider,
        label: "Primary",
        credentialVersion: 1,
        maskedHint: "sk-...1234",
        verificationStatus: "unverified",
        verifiedAt: null,
        lastVerificationCode: null,
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    ]);
  });

  test("loads encrypted material only with owner and connection id", async () => {
    mockD1Query.mockResolvedValue({ rows: [fullRow] });

    const result = await loadProviderConnection(context.ownerId, context.connectionId);

    const [sql, params] = mockD1Query.mock.calls[0];
    expect(sql).toContain("WHERE owner_id = ? AND connection_id = ?");
    expect(params).toEqual([context.ownerId, context.connectionId]);
    expect(result?.envelope).toEqual(envelope);
  });

  test("maps read failures to a stable error without leaking the D1 message", async () => {
    mockD1Query.mockRejectedValue(
      new Error("SQLITE_ERROR: no such table provider_connections"),
    );

    await expect(listProviderConnections(context.ownerId)).rejects.toSatisfy(
      expectStoreError("PERSISTENCE_ERROR"),
    );
  });

  test("creates the encrypted row and credential-free audit event atomically", async () => {
    mockD1Batch.mockResolvedValue([
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
    ]);
    mockD1Query.mockResolvedValue({ rows: [fullRow] });

    await createProviderConnection({
      context,
      envelope,
      label: "Primary",
      maskedHint: "sk-...1234",
    });

    const statements = mockD1Batch.mock.calls[0][0];
    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toContain("INSERT INTO provider_connections");
    expect(statements[1].sql).toContain("provider_connection_audit_events");
    expect(statements[1].sql).not.toMatch(/ciphertext|wrapped_dek|masked_hint/i);
    expect(statements[1].params).not.toContain(envelope.ciphertext);
    expect(statements[1].params).not.toContain(envelope.wrappedDek);
  });

  test("maps unique conflicts to a stable error without returning the D1 message", async () => {
    mockD1Batch.mockRejectedValue(
      new Error("UNIQUE constraint failed: provider_connections.owner_id"),
    );

    await expect(
      createProviderConnection({
        context,
        envelope,
        label: "Primary",
        maskedHint: "sk-...1234",
      }),
    ).rejects.toSatisfy(expectStoreError("CONNECTION_CONFLICT"));
  });

  test("rotates with owner, provider and optimistic credential version guards", async () => {
    mockD1Batch.mockResolvedValue([
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
    ]);
    mockD1Query.mockResolvedValue({
      rows: [{ ...fullRow, credential_version: 2 }],
    });

    const result = await rotateProviderConnectionCredential({
      context,
      expectedCredentialVersion: 1,
      envelope,
      label: "Rotated",
      maskedHint: "sk-...5678",
    });

    const statements = mockD1Batch.mock.calls[0][0];
    expect(statements[0].sql).toContain(
      "WHERE owner_id = ? AND connection_id = ? AND provider = ?",
    );
    expect(statements[0].sql).toContain("AND credential_version = ?");
    expect(statements[0].sql).toContain("verification_status = 'unverified'");
    expect(statements[1].sql).toContain("WHERE changes() = 1");
    expect(result.credentialVersion).toBe(2);
  });

  test("distinguishes a stale credential version from an owner-scoped miss", async () => {
    mockD1Batch.mockResolvedValue([
      { rows: [], meta: { changes: 0 } },
      { rows: [], meta: { changes: 0 } },
    ]);
    mockD1Query.mockResolvedValueOnce({ rows: [fullRow] });

    await expect(
      rotateProviderConnectionCredential({
        context,
        expectedCredentialVersion: 1,
        envelope,
        label: "Primary",
        maskedHint: "sk-...1234",
      }),
    ).rejects.toSatisfy(expectStoreError("CREDENTIAL_VERSION_CONFLICT"));

    mockD1Query.mockResolvedValueOnce({ rows: [] });
    await expect(
      rotateProviderConnectionCredential({
        context: { ...context, ownerId: "other-owner" },
        expectedCredentialVersion: 1,
        envelope,
        label: "Primary",
        maskedHint: "sk-...1234",
      }),
    ).rejects.toSatisfy(expectStoreError("CONNECTION_NOT_FOUND"));
  });

  test("rewraps only the DEK with owner, credential and KEK version guards", async () => {
    const rewrappedEnvelope = {
      ...envelope,
      kekVersion: "kek-v2",
      wrappedDek: "rewrapped-dek",
    };
    mockD1Batch.mockResolvedValue([
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
    ]);
    mockD1Query.mockResolvedValue({
      rows: [{
        ...fullRow,
        wrapped_dek: rewrappedEnvelope.wrappedDek,
        kek_version: rewrappedEnvelope.kekVersion,
      }],
    });

    const result = await rewrapProviderConnectionDek({
      context,
      expectedCredentialVersion: 1,
      expectedKekVersion: "kek-v1",
      envelope: rewrappedEnvelope,
    });

    const statements = mockD1Batch.mock.calls[0][0];
    expect(statements[0].sql).toContain("SET wrapped_dek = ?, kek_version = ?");
    expect(statements[0].sql).toContain("AND credential_version = ? AND kek_version = ?");
    expect(statements[0].params).not.toContain(envelope.ciphertext);
    expect(statements[1].sql).toContain("'kek_rewrapped'");
    expect(result.envelope.kekVersion).toBe("kek-v2");
  });

  test("hard-deletes by owner and id while retaining a credential-free audit event", async () => {
    mockD1Batch.mockResolvedValue([
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
    ]);

    await expect(
      deleteProviderConnection(context.ownerId, context.connectionId),
    ).resolves.toBe(true);

    const statements = mockD1Batch.mock.calls[0][0];
    expect(statements[0].sql).toContain("SELECT ?, connection_id, owner_id, provider");
    expect(statements[0].sql).not.toMatch(/ciphertext|wrapped_dek|masked_hint/i);
    expect(statements[1].sql).toContain(
      "WHERE owner_id = ? AND connection_id = ?",
    );
    expect(statements[1].params).toEqual([context.ownerId, context.connectionId]);
  });

  test("updates verification status with owner/provider/version guards and audit", async () => {
    mockD1Batch.mockResolvedValue([
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
    ]);
    mockD1Query.mockResolvedValue({
      rows: [{
        ...fullRow,
        verification_status: "valid",
        verified_at: "2026-07-21T00:05:00.000Z",
        last_verification_code: "VERIFIED",
      }],
    });

    const result = await updateProviderConnectionVerification({
      context,
      expectedCredentialVersion: 1,
      status: "valid",
      verificationCode: "VERIFIED",
    });

    const statements = mockD1Batch.mock.calls[0][0];
    expect(statements[0].sql).toContain(
      "WHERE owner_id = ? AND connection_id = ? AND provider = ?",
    );
    expect(statements[0].sql).toContain("AND credential_version = ?");
    expect(statements[1].sql).toContain("WHERE changes() = 1");
    expect(statements[1].params).not.toContain(envelope.ciphertext);
    expect(result.verificationStatus).toBe("valid");
  });

  test("rejects unsafe audit error strings before touching D1", async () => {
    await expect(
      recordProviderConnectionAuditEvent({
        context,
        action: "verification_failed",
        outcome: "failure",
        errorCode: "provider said key=secret-value",
      }),
    ).rejects.toSatisfy(expectStoreError("INVALID_INPUT"));
    expect(mockD1Query).not.toHaveBeenCalled();
  });
});
