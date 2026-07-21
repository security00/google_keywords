import "server-only";

export const PROVIDER_CREDENTIAL_ENCRYPTION_VERSION = 1 as const;
export const PROVIDER_CREDENTIAL_FINGERPRINT_VERSION = 1 as const;

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BITS = 128;
const MAX_CONTEXT_VALUE_LENGTH = 256;
const MAX_KEY_VERSION_LENGTH = 64;

export const SUPPORTED_PROVIDER_IDS = [
  "openrouter",
  "dataforseo",
  "openai",
  "deepseek",
  "gemini",
] as const;

export type ProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];
export type ProviderCredentialPayload = Readonly<Record<string, string>>;

export type ProviderCredentialContext = Readonly<{
  connectionId: string;
  ownerId: string;
  provider: ProviderId;
}>;

export type ProviderCredentialEnvelope = Readonly<{
  encryptionVersion: typeof PROVIDER_CREDENTIAL_ENCRYPTION_VERSION;
  fingerprintVersion: typeof PROVIDER_CREDENTIAL_FINGERPRINT_VERSION;
  kekVersion: string;
  fingerprintKeyVersion: string;
  ciphertext: string;
  iv: string;
  wrappedDek: string;
  fingerprintHmac: string;
}>;

export type ProviderCredentialEncryptionKeys = Readonly<{
  kekVersion: string;
  kek: CryptoKey;
  fingerprintKeyVersion: string;
  fingerprintKey: CryptoKey;
}>;

export type ProviderCredentialDecryptionKeys = Readonly<{
  resolveKek: (version: string) => CryptoKey | null | undefined;
  resolveFingerprintKey: (version: string) => CryptoKey | null | undefined;
}>;

export type ProviderCredentialRewrapKeys = Readonly<{
  sourceKek: CryptoKey;
  targetKekVersion: string;
  targetKek: CryptoKey;
}>;

export type ProviderCredentialCryptoErrorCode =
  | "INVALID_CONTEXT"
  | "INVALID_CREDENTIAL"
  | "INVALID_ENVELOPE"
  | "INVALID_KEY"
  | "UNSUPPORTED_ENCRYPTION_VERSION"
  | "KEY_VERSION_NOT_FOUND"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED"
  | "FINGERPRINT_MISMATCH";

export class ProviderCredentialCryptoError extends Error {
  readonly code: ProviderCredentialCryptoErrorCode;

  constructor(code: ProviderCredentialCryptoErrorCode) {
    super(code);
    this.name = "ProviderCredentialCryptoError";
    this.code = code;
  }
}

const fail = (code: ProviderCredentialCryptoErrorCode): never => {
  throw new ProviderCredentialCryptoError(code);
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const base64UrlToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  if (
    !value
    || !/^[A-Za-z0-9_-]+$/.test(value)
    || value.length % 4 === 1
  ) {
    fail("INVALID_ENVELOPE");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (bytesToBase64Url(bytes) !== value) fail("INVALID_ENVELOPE");
    return bytes;
  } catch (error) {
    if (error instanceof ProviderCredentialCryptoError) throw error;
    return fail("INVALID_ENVELOPE");
  }
};

const decodeKeySecret = (secret: string) => {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64UrlToBytes(secret);
  } catch {
    return fail("INVALID_KEY");
  }
  if (bytes.byteLength !== AES_KEY_BYTES) fail("INVALID_KEY");
  return bytes;
};

const assertVersion = (value: string) => {
  if (
    typeof value !== "string"
    || !value
    || value.length > MAX_KEY_VERSION_LENGTH
    || !/^[A-Za-z0-9._-]+$/.test(value)
  ) {
    fail("INVALID_KEY");
  }
};

function assertKey(
  key: CryptoKey | null | undefined,
  algorithmName: "AES-KW" | "HMAC",
  requiredUsage: KeyUsage,
): asserts key is CryptoKey {
  if (
    !key
    || key.type !== "secret"
    || key.algorithm.name !== algorithmName
    || !key.usages.includes(requiredUsage)
  ) {
    fail("INVALID_KEY");
  }
}

const normalizeContext = (context: ProviderCredentialContext) => {
  if (
    !context
    || typeof context !== "object"
    || typeof context.connectionId !== "string"
    || typeof context.ownerId !== "string"
    || typeof context.provider !== "string"
  ) {
    fail("INVALID_CONTEXT");
  }
  const connectionId = context.connectionId.trim();
  const ownerId = context.ownerId.trim();
  const provider = context.provider;
  if (
    !connectionId
    || !ownerId
    || connectionId.length > MAX_CONTEXT_VALUE_LENGTH
    || ownerId.length > MAX_CONTEXT_VALUE_LENGTH
    || !SUPPORTED_PROVIDER_IDS.includes(provider)
  ) {
    fail("INVALID_CONTEXT");
  }
  return { connectionId, ownerId, provider };
};

const normalizeCredential = (credential: ProviderCredentialPayload) => {
  if (
    !credential
    || typeof credential !== "object"
    || Array.isArray(credential)
  ) {
    fail("INVALID_CREDENTIAL");
  }
  const entries = Object.entries(credential);
  if (
    entries.length === 0
    || entries.some(([key, value]) =>
      !key
      || typeof value !== "string"
      || value.length === 0
    )
  ) {
    fail("INVALID_CREDENTIAL");
  }
  return Object.fromEntries(
    entries.sort(([left], [right]) => left.localeCompare(right)),
  ) as Record<string, string>;
};

const aadBytes = (
  context: ReturnType<typeof normalizeContext>,
  encryptionVersion = PROVIDER_CREDENTIAL_ENCRYPTION_VERSION,
) => textEncoder.encode(JSON.stringify([
  "provider-credential-aad",
  encryptionVersion,
  context.connectionId,
  context.ownerId,
  context.provider,
]));

const fingerprintBytes = (
  context: ReturnType<typeof normalizeContext>,
  credentialJson: string,
) => textEncoder.encode(JSON.stringify([
  "provider-credential-fingerprint",
  PROVIDER_CREDENTIAL_FINGERPRINT_VERSION,
  context.ownerId,
  context.provider,
  credentialJson,
]));

const parseCredential = (plaintext: Uint8Array) => {
  try {
    const parsed = JSON.parse(textDecoder.decode(plaintext));
    return normalizeCredential(parsed);
  } catch (error) {
    if (error instanceof ProviderCredentialCryptoError) throw error;
    return fail("DECRYPTION_FAILED");
  }
};

const validateEnvelope = (envelope: ProviderCredentialEnvelope) => {
  if (
    !envelope
    || typeof envelope !== "object"
    || envelope.encryptionVersion
      !== PROVIDER_CREDENTIAL_ENCRYPTION_VERSION
  ) {
    if (
      envelope
      && typeof envelope === "object"
      && "encryptionVersion" in envelope
    ) {
      fail("UNSUPPORTED_ENCRYPTION_VERSION");
    }
    fail("INVALID_ENVELOPE");
  }
  if (
    envelope.fingerprintVersion
      !== PROVIDER_CREDENTIAL_FINGERPRINT_VERSION
  ) {
    fail("INVALID_ENVELOPE");
  }
  assertVersion(envelope.kekVersion);
  assertVersion(envelope.fingerprintKeyVersion);
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  const iv = base64UrlToBytes(envelope.iv);
  const wrappedDek = base64UrlToBytes(envelope.wrappedDek);
  const fingerprintHmac = base64UrlToBytes(envelope.fingerprintHmac);
  if (
    ciphertext.byteLength <= GCM_TAG_BITS / 8
    || iv.byteLength !== GCM_IV_BYTES
    || wrappedDek.byteLength !== AES_KEY_BYTES + 8
    || fingerprintHmac.byteLength !== 32
  ) {
    fail("INVALID_ENVELOPE");
  }
  return { ciphertext, iv, wrappedDek, fingerprintHmac };
};

export const importProviderCredentialKek = async (
  base64UrlSecret: string,
  usages: ReadonlyArray<"wrapKey" | "unwrapKey"> = ["wrapKey", "unwrapKey"],
) => {
  if (usages.length === 0) fail("INVALID_KEY");
  const bytes = decodeKeySecret(base64UrlSecret);
  try {
    return await crypto.subtle.importKey(
      "raw",
      bytes,
      "AES-KW",
      false,
      [...usages],
    );
  } catch {
    return fail("INVALID_KEY");
  } finally {
    bytes.fill(0);
  }
};

export const importProviderCredentialFingerprintKey = async (
  base64UrlSecret: string,
  usages: ReadonlyArray<"sign" | "verify"> = ["sign", "verify"],
) => {
  if (usages.length === 0) fail("INVALID_KEY");
  const bytes = decodeKeySecret(base64UrlSecret);
  try {
    return await crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      [...usages],
    );
  } catch {
    return fail("INVALID_KEY");
  } finally {
    bytes.fill(0);
  }
};

export const encryptProviderCredential = async (
  contextInput: ProviderCredentialContext,
  credentialInput: ProviderCredentialPayload,
  keys: ProviderCredentialEncryptionKeys,
): Promise<ProviderCredentialEnvelope> => {
  const context = normalizeContext(contextInput);
  const credential = normalizeCredential(credentialInput);
  assertVersion(keys.kekVersion);
  assertVersion(keys.fingerprintKeyVersion);
  assertKey(keys.kek, "AES-KW", "wrapKey");
  assertKey(keys.fingerprintKey, "HMAC", "sign");

  const credentialJson = JSON.stringify(credential);
  const plaintext = textEncoder.encode(credentialJson);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));

  try {
    const dek = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const [ciphertext, wrappedDek, fingerprintHmac] = await Promise.all([
      crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: aadBytes(context),
          tagLength: GCM_TAG_BITS,
        },
        dek,
        plaintext,
      ),
      crypto.subtle.wrapKey("raw", dek, keys.kek, "AES-KW"),
      crypto.subtle.sign(
        "HMAC",
        keys.fingerprintKey,
        fingerprintBytes(context, credentialJson),
      ),
    ]);

    return {
      encryptionVersion: PROVIDER_CREDENTIAL_ENCRYPTION_VERSION,
      fingerprintVersion: PROVIDER_CREDENTIAL_FINGERPRINT_VERSION,
      kekVersion: keys.kekVersion,
      fingerprintKeyVersion: keys.fingerprintKeyVersion,
      ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
      iv: bytesToBase64Url(iv),
      wrappedDek: bytesToBase64Url(new Uint8Array(wrappedDek)),
      fingerprintHmac: bytesToBase64Url(new Uint8Array(fingerprintHmac)),
    };
  } catch (error) {
    if (error instanceof ProviderCredentialCryptoError) throw error;
    return fail("ENCRYPTION_FAILED");
  } finally {
    plaintext.fill(0);
    iv.fill(0);
  }
};

export const decryptProviderCredential = async (
  contextInput: ProviderCredentialContext,
  envelope: ProviderCredentialEnvelope,
  keys: ProviderCredentialDecryptionKeys,
): Promise<Record<string, string>> => {
  const context = normalizeContext(contextInput);
  const decoded = validateEnvelope(envelope);
  const kek = keys.resolveKek(envelope.kekVersion);
  const fingerprintKey = keys.resolveFingerprintKey(
    envelope.fingerprintKeyVersion,
  );
  if (!kek || !fingerprintKey) fail("KEY_VERSION_NOT_FOUND");
  assertKey(kek, "AES-KW", "unwrapKey");
  assertKey(fingerprintKey, "HMAC", "verify");

  let plaintext: Uint8Array | null = null;
  try {
    const dek = await crypto.subtle.unwrapKey(
      "raw",
      decoded.wrappedDek,
      kek,
      "AES-KW",
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decoded.iv,
        additionalData: aadBytes(context, envelope.encryptionVersion),
        tagLength: GCM_TAG_BITS,
      },
      dek,
      decoded.ciphertext,
    );
    plaintext = new Uint8Array(decrypted);
    const credential = parseCredential(plaintext);
    const credentialJson = JSON.stringify(credential);
    const fingerprintMatches = await crypto.subtle.verify(
      "HMAC",
      fingerprintKey,
      decoded.fingerprintHmac,
      fingerprintBytes(context, credentialJson),
    );
    if (!fingerprintMatches) fail("FINGERPRINT_MISMATCH");
    return credential;
  } catch (error) {
    if (error instanceof ProviderCredentialCryptoError) throw error;
    return fail("DECRYPTION_FAILED");
  } finally {
    plaintext?.fill(0);
    decoded.ciphertext.fill(0);
    decoded.iv.fill(0);
    decoded.wrappedDek.fill(0);
    decoded.fingerprintHmac.fill(0);
  }
};

export const rewrapProviderCredentialDek = async (
  envelope: ProviderCredentialEnvelope,
  keys: ProviderCredentialRewrapKeys,
): Promise<ProviderCredentialEnvelope> => {
  const decoded = validateEnvelope(envelope);
  assertVersion(keys.targetKekVersion);
  assertKey(keys.sourceKek, "AES-KW", "unwrapKey");
  assertKey(keys.targetKek, "AES-KW", "wrapKey");

  try {
    const dek = await crypto.subtle.unwrapKey(
      "raw",
      decoded.wrappedDek,
      keys.sourceKek,
      "AES-KW",
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const wrappedDek = await crypto.subtle.wrapKey(
      "raw",
      dek,
      keys.targetKek,
      "AES-KW",
    );
    return {
      ...envelope,
      kekVersion: keys.targetKekVersion,
      wrappedDek: bytesToBase64Url(new Uint8Array(wrappedDek)),
    };
  } catch (error) {
    if (error instanceof ProviderCredentialCryptoError) throw error;
    return fail("DECRYPTION_FAILED");
  } finally {
    decoded.ciphertext.fill(0);
    decoded.iv.fill(0);
    decoded.wrappedDek.fill(0);
    decoded.fingerprintHmac.fill(0);
  }
};
