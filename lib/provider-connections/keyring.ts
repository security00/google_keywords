import "server-only";

import {
  importProviderCredentialFingerprintKey,
  importProviderCredentialKek,
  type ProviderCredentialEncryptionKeys,
  type ProviderCredentialDecryptionKeys,
} from "./credential-crypto";

export type ProviderConnectionKeyringErrorCode =
  | "KEY_CONFIG_UNAVAILABLE"
  | "KEY_CONFIG_INVALID";

export class ProviderConnectionKeyringError extends Error {
  readonly code: ProviderConnectionKeyringErrorCode;

  constructor(code: ProviderConnectionKeyringErrorCode) {
    super(code);
    this.name = "ProviderConnectionKeyringError";
    this.code = code;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

const VERSION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const secretName = (prefix: string, version: string) =>
  `${prefix}_${version.toUpperCase().replace(/-/g, "_")}`;

const requiredVersion = (value: string | undefined) => {
  const version = value?.trim();
  if (!version) throw new ProviderConnectionKeyringError("KEY_CONFIG_UNAVAILABLE");
  if (!VERSION_PATTERN.test(version)) {
    throw new ProviderConnectionKeyringError("KEY_CONFIG_INVALID");
  }
  return version;
};

const requiredSecret = (
  environment: Environment,
  prefix: string,
  version: string,
) => {
  const value = environment[secretName(prefix, version)]?.trim();
  if (!value) throw new ProviderConnectionKeyringError("KEY_CONFIG_UNAVAILABLE");
  return value;
};

export const providerConnectionsManagementEnabled = (
  environment: Environment = process.env,
) => environment.BYOK_PROVIDER_CONNECTIONS_ENABLED === "true";

export const providerConnectionOwnerAllowed = (
  ownerId: string,
  environment: Environment = process.env,
) => {
  const allowedOwners = (environment.BYOK_PROVIDER_CONNECTIONS_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowedOwners.includes(ownerId);
};

export const loadActiveProviderCredentialEncryptionKeys = async (
  environment: Environment = process.env,
): Promise<ProviderCredentialEncryptionKeys> => {
  const kekVersion = requiredVersion(environment.BYOK_ACTIVE_KEK_VERSION);
  const fingerprintKeyVersion = requiredVersion(
    environment.BYOK_ACTIVE_FINGERPRINT_KEY_VERSION,
  );
  const kekSecret = requiredSecret(environment, "BYOK_KEK", kekVersion);
  const fingerprintSecret = requiredSecret(
    environment,
    "BYOK_FINGERPRINT_KEY",
    fingerprintKeyVersion,
  );

  try {
    const [kek, fingerprintKey] = await Promise.all([
      importProviderCredentialKek(kekSecret, ["wrapKey"]),
      importProviderCredentialFingerprintKey(fingerprintSecret, ["sign"]),
    ]);
    return { kekVersion, kek, fingerprintKeyVersion, fingerprintKey };
  } catch {
    throw new ProviderConnectionKeyringError("KEY_CONFIG_INVALID");
  }
};

const readVersions = (
  value: string | undefined,
  activeVersion: string,
) => {
  const versions = (value ?? activeVersion)
    .split(",")
    .map((version) => requiredVersion(version))
    .filter((version, index, all) => all.indexOf(version) === index);
  if (!versions.includes(activeVersion)) versions.push(activeVersion);
  return versions;
};

export const loadProviderCredentialDecryptionKeys = async (
  environment: Environment = process.env,
): Promise<ProviderCredentialDecryptionKeys> => {
  const activeKekVersion = requiredVersion(environment.BYOK_ACTIVE_KEK_VERSION);
  const activeFingerprintVersion = requiredVersion(
    environment.BYOK_ACTIVE_FINGERPRINT_KEY_VERSION,
  );
  const kekVersions = readVersions(
    environment.BYOK_KEK_READ_VERSIONS,
    activeKekVersion,
  );
  const fingerprintVersions = readVersions(
    environment.BYOK_FINGERPRINT_KEY_READ_VERSIONS,
    activeFingerprintVersion,
  );

  try {
    const kekEntries = await Promise.all(kekVersions.map(async (version) => [
      version,
      await importProviderCredentialKek(
        requiredSecret(environment, "BYOK_KEK", version),
        ["unwrapKey"],
      ),
    ] as const));
    const fingerprintEntries = await Promise.all(
      fingerprintVersions.map(async (version) => [
        version,
        await importProviderCredentialFingerprintKey(
          requiredSecret(environment, "BYOK_FINGERPRINT_KEY", version),
          ["verify"],
        ),
      ] as const),
    );
    const keks = new Map(kekEntries);
    const fingerprintKeys = new Map(fingerprintEntries);
    return {
      resolveKek: (version) => keks.get(version),
      resolveFingerprintKey: (version) => fingerprintKeys.get(version),
    };
  } catch (error) {
    if (error instanceof ProviderConnectionKeyringError) throw error;
    throw new ProviderConnectionKeyringError("KEY_CONFIG_INVALID");
  }
};
