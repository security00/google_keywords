import { describe, expect, test } from "vitest";

import {
  ProviderConnectionKeyringError,
  loadActiveProviderCredentialEncryptionKeys,
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
});
