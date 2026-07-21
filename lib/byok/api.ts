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
import { ByokExpandError } from "./expand";
import { ByokSerpError } from "./serp";
import { ByokSpendControlError } from "./spend-controls";
import { ByokTrendsError } from "./trends";

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

const plainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

export const parseByokTrendsBody = async (request: Request) => {
  const body = await readLimitedJsonObject(request);
  if (body.action === "quote") {
    exactKeys(body, [
      "action", "executionMode", "provider", "connectionId",
      "expectedConnectionVersion", "clientRequestId", "keyword", "benchmark", "days",
    ]);
    if (
      body.executionMode !== "byok"
      || body.provider !== "dataforseo"
      || typeof body.connectionId !== "string"
      || !body.connectionId.trim()
      || !Number.isInteger(body.expectedConnectionVersion)
      || Number(body.expectedConnectionVersion) < 1
      || typeof body.clientRequestId !== "string"
      || typeof body.keyword !== "string"
      || (body.benchmark !== undefined && typeof body.benchmark !== "string")
      || (body.days !== undefined && !Number.isInteger(body.days))
    ) {
      throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
    }
    return {
      action: "quote" as const,
      connectionId: body.connectionId.trim(),
      expectedConnectionVersion: Number(body.expectedConnectionVersion),
      clientRequestId: body.clientRequestId,
      keyword: body.keyword,
      benchmark: body.benchmark as string | undefined,
      days: body.days as number | undefined,
    };
  }
  if (body.action === "execute") {
    exactKeys(body, [
      "action", "executionMode", "provider", "connectionId",
      "expectedConnectionVersion", "request", "quoteId", "requestHash",
      "confirmedEstimatedCostUsd", "confirmation",
    ]);
    if (!plainObject(body.request)) {
      throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
    }
    exactKeys(body.request, ["keyword", "benchmark", "dateFrom", "dateTo"]);
    if (
      body.executionMode !== "byok"
      || body.provider !== "dataforseo"
      || typeof body.connectionId !== "string"
      || !body.connectionId.trim()
      || !Number.isInteger(body.expectedConnectionVersion)
      || Number(body.expectedConnectionVersion) < 1
      || typeof body.request.keyword !== "string"
      || typeof body.request.benchmark !== "string"
      || typeof body.request.dateFrom !== "string"
      || typeof body.request.dateTo !== "string"
      || typeof body.quoteId !== "string"
      || typeof body.requestHash !== "string"
      || typeof body.confirmedEstimatedCostUsd !== "number"
      || body.confirmation !== "CONFIRM"
    ) {
      throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
    }
    return {
      action: "execute" as const,
      connectionId: body.connectionId.trim(),
      expectedConnectionVersion: Number(body.expectedConnectionVersion),
      request: {
        keyword: body.request.keyword,
        benchmark: body.request.benchmark,
        dateFrom: body.request.dateFrom,
        dateTo: body.request.dateTo,
      },
      quoteId: body.quoteId,
      requestHash: body.requestHash,
      confirmedEstimatedCostUsd: body.confirmedEstimatedCostUsd,
      confirmation: "CONFIRM" as const,
    };
  }
  throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
};

export const parseByokSerpBody = async (request: Request) => {
  const body = await readLimitedJsonObject(request);
  if (body.action === "quote") {
    exactKeys(body, [
      "action", "executionMode", "provider", "connectionId",
      "expectedConnectionVersion", "clientRequestId", "keyword",
    ]);
    if (
      body.executionMode !== "byok"
      || body.provider !== "dataforseo"
      || typeof body.connectionId !== "string"
      || !body.connectionId.trim()
      || !Number.isInteger(body.expectedConnectionVersion)
      || Number(body.expectedConnectionVersion) < 1
      || typeof body.clientRequestId !== "string"
      || typeof body.keyword !== "string"
    ) throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
    return {
      action: "quote" as const,
      connectionId: body.connectionId.trim(),
      expectedConnectionVersion: Number(body.expectedConnectionVersion),
      clientRequestId: body.clientRequestId,
      keyword: body.keyword,
    };
  }
  if (body.action === "execute") {
    exactKeys(body, [
      "action", "executionMode", "provider", "connectionId",
      "expectedConnectionVersion", "request", "quoteId", "requestHash",
      "confirmedEstimatedCostUsd", "confirmation",
    ]);
    if (!plainObject(body.request)) {
      throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
    }
    exactKeys(body.request, ["keyword"]);
    if (
      body.executionMode !== "byok"
      || body.provider !== "dataforseo"
      || typeof body.connectionId !== "string"
      || !body.connectionId.trim()
      || !Number.isInteger(body.expectedConnectionVersion)
      || Number(body.expectedConnectionVersion) < 1
      || typeof body.request.keyword !== "string"
      || typeof body.quoteId !== "string"
      || typeof body.requestHash !== "string"
      || typeof body.confirmedEstimatedCostUsd !== "number"
      || body.confirmation !== "CONFIRM"
    ) throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
    return {
      action: "execute" as const,
      connectionId: body.connectionId.trim(),
      expectedConnectionVersion: Number(body.expectedConnectionVersion),
      request: { keyword: body.request.keyword },
      quoteId: body.quoteId,
      requestHash: body.requestHash,
      confirmedEstimatedCostUsd: body.confirmedEstimatedCostUsd,
      confirmation: "CONFIRM" as const,
    };
  }
  throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
};

export const parseByokExpandBody = async (request: Request) => {
  const body = await readLimitedJsonObject(request);
  if (body.action === "quote") {
    exactKeys(body, [
      "action", "executionMode", "provider", "connectionId",
      "expectedConnectionVersion", "clientRequestId", "keyword", "days",
    ]);
    if (body.executionMode !== "byok" || body.provider !== "dataforseo"
      || typeof body.connectionId !== "string" || !body.connectionId.trim()
      || !Number.isInteger(body.expectedConnectionVersion)
      || Number(body.expectedConnectionVersion) < 1
      || typeof body.clientRequestId !== "string"
      || typeof body.keyword !== "string"
      || !Number.isInteger(body.days)) {
      throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
    }
    return {
      action: "quote" as const,
      connectionId: body.connectionId.trim(),
      expectedConnectionVersion: Number(body.expectedConnectionVersion),
      clientRequestId: body.clientRequestId,
      keyword: body.keyword,
      days: Number(body.days),
    };
  }
  if (body.action === "execute") {
    exactKeys(body, [
      "action", "executionMode", "provider", "connectionId",
      "expectedConnectionVersion", "request", "quoteId", "requestHash",
      "confirmedEstimatedCostUsd", "confirmation",
    ]);
    if (!plainObject(body.request)) throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
    exactKeys(body.request, ["keyword", "dateFrom", "dateTo"]);
    if (body.executionMode !== "byok" || body.provider !== "dataforseo"
      || typeof body.connectionId !== "string" || !body.connectionId.trim()
      || !Number.isInteger(body.expectedConnectionVersion)
      || Number(body.expectedConnectionVersion) < 1
      || typeof body.request.keyword !== "string"
      || typeof body.request.dateFrom !== "string"
      || typeof body.request.dateTo !== "string"
      || typeof body.quoteId !== "string"
      || typeof body.requestHash !== "string"
      || typeof body.confirmedEstimatedCostUsd !== "number"
      || body.confirmation !== "CONFIRM") {
      throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
    }
    return {
      action: "execute" as const,
      connectionId: body.connectionId.trim(),
      expectedConnectionVersion: Number(body.expectedConnectionVersion),
      request: {
        keyword: body.request.keyword,
        dateFrom: body.request.dateFrom,
        dateTo: body.request.dateTo,
      },
      quoteId: body.quoteId,
      requestHash: body.requestHash,
      confirmedEstimatedCostUsd: body.confirmedEstimatedCostUsd,
      confirmation: "CONFIRM" as const,
    };
  }
  throw new ProviderConnectionApiError("INVALID_REQUEST", 400);
};

export const byokErrorResponse = (error: unknown) => {
  if (error instanceof ProviderConnectionApiError) {
    return noStoreJson(
      { error: "BYOK request rejected", code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ByokExpandError) {
    const status: Record<ByokExpandError["code"], number> = {
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
      SPEND_RESERVATION_FAILED: 409,
    };
    return noStoreJson(
      { error: "BYOK expansion failed", code: error.code },
      { status: status[error.code] },
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
  if (error instanceof ByokSpendControlError) {
    const status: Record<ByokSpendControlError["code"], number> = {
      INVALID_INPUT: 400,
      QUOTE_CONFLICT: 409,
      QUOTE_NOT_FOUND: 404,
      QUOTE_EXPIRED: 409,
      QUOTE_ALREADY_USED: 409,
      COST_CONFIRMATION_MISMATCH: 409,
      DAILY_BUDGET_EXCEEDED: 409,
      CONCURRENCY_LIMIT_REACHED: 409,
      PERSISTENCE_ERROR: 503,
    };
    return noStoreJson(
      { error: "BYOK spend guard rejected the request", code: error.code },
      { status: status[error.code] },
    );
  }
  if (error instanceof ByokTrendsError) {
    const status: Record<ByokTrendsError["code"], number> = {
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
      SPEND_RESERVATION_FAILED: 409,
    };
    return noStoreJson(
      { error: "BYOK Trends execution failed", code: error.code },
      { status: status[error.code] },
    );
  }
  if (error instanceof ByokSerpError) {
    const status: Record<ByokSerpError["code"], number> = {
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
      SPEND_RESERVATION_FAILED: 409,
    };
    return noStoreJson(
      { error: "BYOK SERP execution failed", code: error.code },
      { status: status[error.code] },
    );
  }
  return noStoreJson(
    { error: "BYOK execution failed", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
};

export const byokJson = noStoreJson;
