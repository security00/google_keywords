import "server-only";

import { NextResponse } from "next/server";

import { requireEffectiveUser } from "@/lib/authz";
import {
  ProviderConnectionApiError,
  readLimitedJsonObject,
} from "@/lib/provider-connections/api";
import {
  ProviderConnectionKeyringError,
  providerConnectionOwnerAllowed,
} from "@/lib/provider-connections/keyring";
import { ByokSemanticFilterError } from "./semantic-filter";

type Environment = Readonly<Record<string, string | undefined>>;

const noStoreJson = (body: unknown, init?: ResponseInit) => {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export const byokLiveModeEnabled = (
  environment: Environment = process.env,
) => environment.BYOK_LIVE_MODE_ENABLED === "true";

const hiddenResponse = () => noStoreJson(
  { error: "Not found", code: "FEATURE_DISABLED" },
  { status: 404 },
);

const isSameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    if (origin !== new URL(request.url).origin) return false;
  } catch {
    return false;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
};

export const requireByokLiveOwner = async (
  request: Request,
  options: Readonly<{ mutation?: boolean }> = {},
): Promise<{ ownerId: string } | NextResponse> => {
  if (!byokLiveModeEnabled()) return hiddenResponse();
  const principal = await requireEffectiveUser(request);
  if (principal instanceof Response) {
    principal.headers.set("Cache-Control", "no-store");
    return principal;
  }
  if (
    principal.authMethod !== "cookie"
    || !providerConnectionOwnerAllowed(principal.userId)
  ) {
    return hiddenResponse();
  }
  if (options.mutation && !isSameOrigin(request)) {
    return noStoreJson(
      { error: "Cross-origin request rejected", code: "CROSS_ORIGIN_REQUEST" },
      { status: 403 },
    );
  }
  return { ownerId: principal.userId };
};

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) {
    throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
  }
};

export const parseByokSemanticFilterBody = async (request: Request) => {
  const body = await readLimitedJsonObject(request);
  exactKeys(body, [
    "executionMode",
    "provider",
    "connectionId",
    "expectedConnectionVersion",
    "keywords",
  ]);
  if (
    body.executionMode !== "byok"
    || body.provider !== "openrouter"
    || typeof body.connectionId !== "string"
    || !body.connectionId.trim()
    || !Number.isInteger(body.expectedConnectionVersion)
    || Number(body.expectedConnectionVersion) < 1
    || !Array.isArray(body.keywords)
    || body.keywords.some((keyword) => typeof keyword !== "string")
  ) {
    throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
  }
  return {
    connectionId: body.connectionId.trim(),
    expectedConnectionVersion: Number(body.expectedConnectionVersion),
    keywords: body.keywords as string[],
  };
};

export const byokErrorResponse = (error: unknown) => {
  if (error instanceof ProviderConnectionApiError) {
    return noStoreJson(
      { error: "BYOK request rejected", code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ProviderConnectionKeyringError) {
    return noStoreJson(
      { error: "BYOK key configuration unavailable", code: error.code },
      { status: 503 },
    );
  }
  if (error instanceof ByokSemanticFilterError) {
    const status: Record<ByokSemanticFilterError["code"], number> = {
      INVALID_INPUT: 400,
      CONNECTION_NOT_FOUND: 404,
      CONNECTION_VERSION_CONFLICT: 409,
      CONNECTION_NOT_VERIFIED: 409,
      CREDENTIAL_UNAVAILABLE: 503,
      JOB_PERSISTENCE_ERROR: 503,
      PROVIDER_FAILED: 502,
      PROVIDER_RESPONSE_INVALID: 502,
      COST_LEDGER_WRITE_FAILED: 503,
      PRIVATE_CACHE_WRITE_FAILED: 503,
    };
    return noStoreJson(
      { error: "BYOK execution failed", code: error.code },
      { status: status[error.code] },
    );
  }
  return noStoreJson(
    { error: "BYOK execution failed", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
};

export const byokJson = noStoreJson;
