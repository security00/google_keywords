import { describe, expect, test } from "vitest";

import {
  ProviderCredentialCryptoError,
  decryptProviderCredential,
  encryptProviderCredential,
  importProviderCredentialFingerprintKey,
  importProviderCredentialKek,
  rewrapProviderCredentialDek,
  type ProviderCredentialContext,
} from "./credential-crypto";

const base64UrlSecret = (fill: number) =>
  Buffer.from(new Uint8Array(32).fill(fill)).toString("base64url");

const context: ProviderCredentialContext = {
  connectionId: "connection-1",
  ownerId: "owner-1",
  provider: "openrouter",
};

const mutateBase64Url = (value: string) => {
  const bytes = Buffer.from(value, "base64url");
  bytes[0] ^= 0x01;
  return bytes.toString("base64url");
};

const expectCryptoError = async (
  promise: Promise<unknown>,
  code: ProviderCredentialCryptoError["code"],
) => {
  await expect(promise).rejects.toMatchObject({
    name: "ProviderCredentialCryptoError",
    code,
    message: code,
  });
};

const createKeys = async (kekFill = 0x11, fingerprintFill = 0x22) => {
  const kek = await importProviderCredentialKek(base64UrlSecret(kekFill));
  const fingerprintKey = await importProviderCredentialFingerprintKey(
    base64UrlSecret(fingerprintFill),
  );
  return {
    encryption: {
      kekVersion: "kek-v1",
      kek,
      fingerprintKeyVersion: "fingerprint-v1",
      fingerprintKey,
    },
    decryption: {
      resolveKek: (version: string) => version === "kek-v1" ? kek : null,
      resolveFingerprintKey: (version: string) =>
        version === "fingerprint-v1" ? fingerprintKey : null,
    },
  };
};

describe("provider credential envelope crypto", () => {
  test("round-trips a credential without exposing plaintext", async () => {
    const keys = await createKeys();
    const credential = { apiKey: "or-secret" };

    const envelope = await encryptProviderCredential(
      context,
      credential,
      keys.encryption,
    );
    const decrypted = await decryptProviderCredential(
      context,
      envelope,
      keys.decryption,
    );

    expect(decrypted).toEqual(credential);
    expect(JSON.stringify(envelope)).not.toContain("or-secret");
    expect(envelope).toMatchObject({
      encryptionVersion: 1,
      fingerprintVersion: 1,
      kekVersion: "kek-v1",
      fingerprintKeyVersion: "fingerprint-v1",
    });
  });

  test("matches the fixed owner/provider-scoped HMAC vector", async () => {
    const keys = await createKeys();

    const envelope = await encryptProviderCredential(
      context,
      { apiKey: "or-secret" },
      keys.encryption,
    );

    expect(envelope.fingerprintHmac).toBe(
      "lMQNgSk80Du3PuVzFCfeKS0Vgbrn_QfydFV53IhHzfo",
    );
  });

  test("uses a fresh DEK and IV while keeping the scoped fingerprint stable", async () => {
    const keys = await createKeys();
    const credential = { apiKey: "or-secret" };

    const first = await encryptProviderCredential(
      context,
      credential,
      keys.encryption,
    );
    const second = await encryptProviderCredential(
      context,
      credential,
      keys.encryption,
    );

    expect(second.iv).not.toBe(first.iv);
    expect(second.wrappedDek).not.toBe(first.wrappedDek);
    expect(second.ciphertext).not.toBe(first.ciphertext);
    expect(second.fingerprintHmac).toBe(first.fingerprintHmac);
  });

  test.each([
    ["connection", { ...context, connectionId: "connection-2" }],
    ["owner", { ...context, ownerId: "owner-2" }],
    ["provider", { ...context, provider: "openai" as const }],
  ])("rejects ciphertext moved to a different %s context", async (_label, otherContext) => {
    const keys = await createKeys();
    const envelope = await encryptProviderCredential(
      context,
      { apiKey: "or-secret" },
      keys.encryption,
    );

    await expectCryptoError(
      decryptProviderCredential(otherContext, envelope, keys.decryption),
      "DECRYPTION_FAILED",
    );
  });

  test.each([
    ["ciphertext", "DECRYPTION_FAILED"],
    ["iv", "DECRYPTION_FAILED"],
    ["wrappedDek", "DECRYPTION_FAILED"],
    ["fingerprintHmac", "FINGERPRINT_MISMATCH"],
  ] as const)("fails closed when %s is modified", async (field, expectedCode) => {
    const keys = await createKeys();
    const envelope = await encryptProviderCredential(
      context,
      { apiKey: "or-secret" },
      keys.encryption,
    );
    const modified = {
      ...envelope,
      [field]: mutateBase64Url(envelope[field]),
    };

    await expectCryptoError(
      decryptProviderCredential(context, modified, keys.decryption),
      expectedCode,
    );
  });

  test("fails closed when a key version is unavailable", async () => {
    const keys = await createKeys();
    const envelope = await encryptProviderCredential(
      context,
      { apiKey: "or-secret" },
      keys.encryption,
    );

    await expectCryptoError(
      decryptProviderCredential(
        context,
        { ...envelope, kekVersion: "retired-kek" },
        keys.decryption,
      ),
      "KEY_VERSION_NOT_FOUND",
    );
  });

  test("fails closed with a wrong KEK under the same version", async () => {
    const keys = await createKeys();
    const wrongKeys = await createKeys(0x33, 0x22);
    const envelope = await encryptProviderCredential(
      context,
      { apiKey: "or-secret" },
      keys.encryption,
    );

    await expectCryptoError(
      decryptProviderCredential(context, envelope, wrongKeys.decryption),
      "DECRYPTION_FAILED",
    );
  });

  test("fails closed with a wrong fingerprint key under the same version", async () => {
    const keys = await createKeys();
    const wrongKeys = await createKeys(0x11, 0x44);
    const envelope = await encryptProviderCredential(
      context,
      { apiKey: "or-secret" },
      keys.encryption,
    );

    await expectCryptoError(
      decryptProviderCredential(context, envelope, wrongKeys.decryption),
      "FINGERPRINT_MISMATCH",
    );
  });

  test("rejects unknown encryption versions before key resolution", async () => {
    const keys = await createKeys();
    const envelope = await encryptProviderCredential(
      context,
      { apiKey: "or-secret" },
      keys.encryption,
    );
    const unsupported = { ...envelope };
    Object.defineProperty(unsupported, "encryptionVersion", { value: 2 });

    await expectCryptoError(
      decryptProviderCredential(context, unsupported, keys.decryption),
      "UNSUPPORTED_ENCRYPTION_VERSION",
    );
  });

  test("rejects malformed key material and credentials", async () => {
    await expectCryptoError(
      importProviderCredentialKek(
        Buffer.from(new Uint8Array(16)).toString("base64url"),
      ),
      "INVALID_KEY",
    );
    await expectCryptoError(
      importProviderCredentialFingerprintKey(base64UrlSecret(0x22) + "="),
      "INVALID_KEY",
    );

    const keys = await createKeys();
    await expectCryptoError(
      encryptProviderCredential(context, {}, keys.encryption),
      "INVALID_CREDENTIAL",
    );
    await expectCryptoError(
      encryptProviderCredential(
        { ...context, ownerId: "" },
        { apiKey: "or-secret" },
        keys.encryption,
      ),
      "INVALID_CONTEXT",
    );
  });

  test("rejects keys that do not have the required operation", async () => {
    const unwrapOnlyKek = await importProviderCredentialKek(
      base64UrlSecret(0x11),
      ["unwrapKey"],
    );
    const fingerprintKey = await importProviderCredentialFingerprintKey(
      base64UrlSecret(0x22),
    );

    await expectCryptoError(
      encryptProviderCredential(
        context,
        { apiKey: "or-secret" },
        {
          kekVersion: "kek-v1",
          kek: unwrapOnlyKek,
          fingerprintKeyVersion: "fingerprint-v1",
          fingerprintKey,
        },
      ),
      "INVALID_KEY",
    );
  });

  test("rewraps only the DEK and decrypts with the target KEK", async () => {
    const source = await createKeys(0x11, 0x22);
    const targetKek = await importProviderCredentialKek(base64UrlSecret(0x33));
    const envelope = await encryptProviderCredential(
      context,
      { apiKey: "or-secret" },
      source.encryption,
    );

    const rewrapped = await rewrapProviderCredentialDek(envelope, {
      sourceKek: source.encryption.kek,
      targetKekVersion: "kek-v2",
      targetKek,
    });

    expect(rewrapped).toMatchObject({
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      fingerprintHmac: envelope.fingerprintHmac,
      fingerprintKeyVersion: envelope.fingerprintKeyVersion,
      kekVersion: "kek-v2",
    });
    expect(rewrapped.wrappedDek).not.toBe(envelope.wrappedDek);
    await expect(decryptProviderCredential(context, rewrapped, {
      resolveKek: (version) => version === "kek-v2" ? targetKek : null,
      resolveFingerprintKey: source.decryption.resolveFingerprintKey,
    })).resolves.toEqual({ apiKey: "or-secret" });
  });

  test("fails closed when rewrapping with the wrong source KEK", async () => {
    const source = await createKeys(0x11, 0x22);
    const wrongSource = await createKeys(0x44, 0x22);
    const targetKek = await importProviderCredentialKek(base64UrlSecret(0x33));
    const envelope = await encryptProviderCredential(
      context,
      { apiKey: "or-secret" },
      source.encryption,
    );

    await expectCryptoError(rewrapProviderCredentialDek(envelope, {
      sourceKek: wrongSource.encryption.kek,
      targetKekVersion: "kek-v2",
      targetKek,
    }), "DECRYPTION_FAILED");
  });
});
