import "server-only";

import { NextResponse } from "next/server";

import { requireEffectiveUser } from "@/lib/authz";
import {
  ProviderConnectionKeyringError,
  providerConnectionOwnerAllowed,
  providerConnectionsManagementEnabled,
} from "./keyring";
import { ProviderConnectionServiceError } from "./service";

export const PROVIDER_CONNECTION_BODY_LIMIT_BYTES = 8 * 1024;

export type ProviderConnectionOwner = Readonly<{ ownerId: string }>;

export type CreateProviderConnectionBody =
  | Readonly<{
    provider: "openrouter";
    label?: string;
    apiKey: string;
  }>
  | Readonly<{
    provider: "dataforseo";
    label?: string;
    login: string;
    password: string;
  }>;

export type RotateProviderConnectionBody =
  | Readonly<{
    provider: "openrouter";
    label?: string;
    apiKey: string;
    expectedCredentialVersion: number;
  }>
  | Readonly<{
    provider: "dataforseo";
    label?: string;
    login: string;
    password: string;
    expectedCredentialVersion: number;
  }>;

export type ProviderConnectionApiErrorCode =
  | "FEATURE_DISABLED"
  | "COOKIE_AUTH_REQUIRED"
  | "CROSS_ORIGIN_REQUEST"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_PROVIDER"
  | "CONNECTION_CONFLICT"
  | "CONNECTION_NOT_FOUND"
  | "CREDENTIAL_VERSION_CONFLICT"
  | "KEY_CONFIG_UNAVAILABLE"
  | "KEY_CONFIG_INVALID"
  | "ENCRYPTION_FAILED"
  | "PERSISTENCE_ERROR"
  | "INTERNAL_ERROR";

export class ProviderConnectionApiError extends Error {
  readonly code: ProviderConnectionApiErrorCode;
  readonly status: number;

  constructor(code: ProviderConnectionApiErrorCode, status: number) {
    super(code);
    this.name = "ProviderConnectionApiError";
    this.code = code;
    this.status = status;
  }
}

const fail = (code: ProviderConnectionApiErrorCode, status: number): never => {
  throw new ProviderConnectionApiError(code, status);
};

const noStoreJson = (body: unknown, init?: ResponseInit) => {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export const featureDisabledResponse = () =>
  noStoreJson({ error: "Not found", code: "FEATURE_DISABLED" }, { status: 404 });

const sameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  if (origin !== requestOrigin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
};

export const requireProviderConnectionOwner = async (
  request: Request,
  options: Readonly<{ mutation?: boolean }> = {},
): Promise<ProviderConnectionOwner | NextResponse> => {
  if (!providerConnectionsManagementEnabled()) return featureDisabledResponse();

  const principal = await requireEffectiveUser(request);
  if (principal instanceof Response) {
    principal.headers.set("Cache-Control", "no-store");
    return principal;
  }
  if (principal.authMethod !== "cookie") {
    return noStoreJson(
      { error: "Cookie authentication required", code: "COOKIE_AUTH_REQUIRED" },
      { status: 403 },
    );
  }
  if (!providerConnectionOwnerAllowed(principal.userId)) {
    return featureDisabledResponse();
  }
  if (options.mutation && !sameOrigin(request)) {
    return noStoreJson(
      { error: "Cross-origin request rejected", code: "CROSS_ORIGIN_REQUEST" },
      { status: 403 },
    );
  }
  return { ownerId: principal.userId };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value)
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const assertExactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
) => {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    fail("INVALID_REQUEST", 400);
  }
};

export const readLimitedJsonObject = async (
  request: Request,
  limitBytes = PROVIDER_CONNECTION_BODY_LIMIT_BYTES,
): Promise<Record<string, unknown>> => {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return fail("UNSUPPORTED_MEDIA_TYPE", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isInteger(parsedLength) || parsedLength < 0) {
      return fail("INVALID_REQUEST", 400);
    }
    if (parsedLength > limitBytes) return fail("PAYLOAD_TOO_LARGE", 413);
  }
  if (!request.body) return fail("INVALID_JSON", 400);

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > limitBytes) {
        await reader.cancel();
        return fail("PAYLOAD_TOO_LARGE", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof ProviderConnectionApiError) throw error;
    return fail("INVALID_JSON", 400);
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!isPlainObject(parsed)) return fail("INVALID_REQUEST", 400);
    return parsed;
  } catch (error) {
    if (error instanceof ProviderConnectionApiError) throw error;
    return fail("INVALID_JSON", 400);
  }
};

const parseOpenRouterCredential = (value: unknown) => {
  if (!isPlainObject(value)) return fail("INVALID_REQUEST", 400);
  assertExactKeys(value, ["apiKey"]);
  if (typeof value.apiKey !== "string") return fail("INVALID_REQUEST", 400);
  return value.apiKey;
};

const parseDataForSeoCredential = (value: unknown) => {
  if (!isPlainObject(value)) return fail("INVALID_REQUEST", 400);
  assertExactKeys(value, ["login", "password"]);
  if (typeof value.login !== "string" || typeof value.password !== "string") {
    return fail("INVALID_REQUEST", 400);
  }
  return { login: value.login, password: value.password };
};

export const parseCreateProviderConnectionBody = (
  body: Record<string, unknown>,
): CreateProviderConnectionBody => {
  assertExactKeys(body, ["provider", "label", "credential"]);
  if (body.label !== undefined && typeof body.label !== "string") {
    return fail("INVALID_REQUEST", 400);
  }
  if (body.provider === "openrouter") {
    return {
      provider: "openrouter",
      label: body.label,
      apiKey: parseOpenRouterCredential(body.credential),
    };
  }
  if (body.provider === "dataforseo") {
    return {
      provider: "dataforseo",
      label: body.label,
      ...parseDataForSeoCredential(body.credential),
    };
  }
  return fail("UNSUPPORTED_PROVIDER", 400);
};

export const parseRotateProviderConnectionBody = (
  body: Record<string, unknown>,
): RotateProviderConnectionBody => {
  assertExactKeys(body, ["label", "credential", "expectedCredentialVersion"]);
  if (body.label !== undefined && typeof body.label !== "string") {
    return fail("INVALID_REQUEST", 400);
  }
  if (
    !Number.isInteger(body.expectedCredentialVersion)
    || Number(body.expectedCredentialVersion) < 1
  ) {
    return fail("INVALID_REQUEST", 400);
  }
  if (!isPlainObject(body.credential)) return fail("INVALID_REQUEST", 400);
  if (Object.hasOwn(body.credential, "apiKey")) {
    return {
      provider: "openrouter",
      label: body.label,
      apiKey: parseOpenRouterCredential(body.credential),
      expectedCredentialVersion: Number(body.expectedCredentialVersion),
    };
  }
  return {
    provider: "dataforseo",
    label: body.label,
    ...parseDataForSeoCredential(body.credential),
    expectedCredentialVersion: Number(body.expectedCredentialVersion),
  };
};

export const providerConnectionErrorResponse = (error: unknown) => {
  if (error instanceof ProviderConnectionApiError) {
    return noStoreJson(
      { error: "Provider connection request rejected", code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ProviderConnectionKeyringError) {
    return noStoreJson(
      { error: "Provider connection key configuration unavailable", code: error.code },
      { status: 503 },
    );
  }
  if (error instanceof ProviderConnectionServiceError) {
    const mapping: Record<ProviderConnectionServiceError["code"], number> = {
      INVALID_INPUT: 400,
      UNSUPPORTED_PROVIDER: 400,
      CONNECTION_CONFLICT: 409,
      CONNECTION_NOT_FOUND: 404,
      CREDENTIAL_VERSION_CONFLICT: 409,
      ENCRYPTION_FAILED: 503,
      DECRYPTION_FAILED: 503,
      RATE_LIMITED: 429,
      RATE_LIMIT_PERSISTENCE_ERROR: 503,
      PERSISTENCE_ERROR: 503,
    };
    return noStoreJson(
      { error: "Provider connection request failed", code: error.code },
      { status: mapping[error.code] },
    );
  }
  return noStoreJson(
    { error: "Provider connection request failed", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
};

export const providerConnectionJson = noStoreJson;
