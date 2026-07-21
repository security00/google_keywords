import { describe, expect, test } from "vitest";

import {
  ProviderConnectionKeyringError,
  loadActiveProviderCredentialEncryptionKeys,
  loadProviderCredentialDecryptionKeys,
  providerConnectionOwnerAllowed,
  providerConnectionsManagementEnabled,
} from "./keyring";

const secret = (fill: number) => {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

describe("Provider Connection keyring", () => {
  test("keeps management disabled unless explicitly enabled", () => {
    expect(providerConnectionsManagementEnabled({})).toBe(false);
    expect(providerConnectionsManagementEnabled({
      BYOK_PROVIDER_CONNECTIONS_ENABLED: "false",
    })).toBe(false);
    expect(providerConnectionsManagementEnabled({
      BYOK_PROVIDER_CONNECTIONS_ENABLED: "true",
    })).toBe(true);
  });

  test("requires an explicit exact owner allowlist match", () => {
    const environment = {
      BYOK_PROVIDER_CONNECTIONS_ALLOWLIST: " owner-1,owner-2 ",
    };
    expect(providerConnectionOwnerAllowed("owner-1", environment)).toBe(true);
    expect(providerConnectionOwnerAllowed("owner", environment)).toBe(false);
    expect(providerConnectionOwnerAllowed("owner-3", environment)).toBe(false);
  });

  test("loads active versioned encryption-only keys", async () => {
    const keys = await loadActiveProviderCredentialEncryptionKeys({
      BYOK_ACTIVE_KEK_VERSION: "v1",
      BYOK_KEK_V1: secret(7),
      BYOK_ACTIVE_FINGERPRINT_KEY_VERSION: "v1",
      BYOK_FINGERPRINT_KEY_V1: secret(9),
    });

    expect(keys.kekVersion).toBe("v1");
    expect(keys.kek.usages).toEqual(["wrapKey"]);
    expect(keys.fingerprintKeyVersion).toBe("v1");
    expect(keys.fingerprintKey.usages).toEqual(["sign"]);
  });

  test("fails closed with stable errors for missing or malformed configuration", async () => {
    await expect(loadActiveProviderCredentialEncryptionKeys({})).rejects.toMatchObject({
      code: "KEY_CONFIG_UNAVAILABLE",
    } satisfies Partial<ProviderConnectionKeyringError>);

    await expect(loadActiveProviderCredentialEncryptionKeys({
      BYOK_ACTIVE_KEK_VERSION: "bad version",
      BYOK_ACTIVE_FINGERPRINT_KEY_VERSION: "v1",
    })).rejects.toMatchObject({ code: "KEY_CONFIG_INVALID" });
  });

  test("loads active and previous read-only decryption key versions", async () => {
    const keys = await loadProviderCredentialDecryptionKeys({
      BYOK_ACTIVE_KEK_VERSION: "v2",
      BYOK_KEK_READ_VERSIONS: "v1,v2",
      BYOK_KEK_V1: secret(1),
      BYOK_KEK_V2: secret(2),
      BYOK_ACTIVE_FINGERPRINT_KEY_VERSION: "v2",
      BYOK_FINGERPRINT_KEY_READ_VERSIONS: "v1,v2",
      BYOK_FINGERPRINT_KEY_V1: secret(3),
      BYOK_FINGERPRINT_KEY_V2: secret(4),
    });

    expect(keys.resolveKek("v1")?.usages).toEqual(["unwrapKey"]);
    expect(keys.resolveKek("v2")?.usages).toEqual(["unwrapKey"]);
    expect(keys.resolveKek("v3")).toBeUndefined();
    expect(keys.resolveFingerprintKey("v1")?.usages).toEqual(["verify"]);
  });
});
