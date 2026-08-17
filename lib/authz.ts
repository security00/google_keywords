import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  validateApiKey,
  type ApiKeyScope,
} from "@/lib/api_keys";
import { getAuthUser } from "@/lib/auth";
import {
  accessDeniedStatus,
  checkEffectiveAccess,
  type EffectiveAccessResult,
} from "@/lib/entitlements";

export type PrincipalRole = "admin" | "student";
export type PrincipalAuthMethod =
  | "cookie"
  | "api_key"
  | "api_key_query"
  | "cron"
  | "anonymous";

export type Principal = {
  userId?: string;
  role?: PrincipalRole;
  apiKeyId?: number;
  scopes: ApiKeyScope[];
  authMethod: PrincipalAuthMethod;
  error?: string;
};

type RequestLike = Request | NextRequest;

export type PrincipalOptions = {
  allowLegacyQueryKey?: boolean;
};

type AllowedEffectiveAccess = Extract<
  EffectiveAccessResult,
  { allowed: true }
>;

export type EffectivePrincipal = Principal & {
  userId: string;
  access: AllowedEffectiveAccess;
};

const bearerToken = (request: RequestLike) => {
  const authHeader = request.headers.get("authorization");
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const cronSecrets = () =>
  [
    process.env.CRON_SECRET,
    process.env.GK_CRON_SECRET,
    process.env.EXTERNAL_CRON_SECRET,
  ].filter((value): value is string => Boolean(value));

const digestSecret = async (value: string) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );

const secretsEqual = async (left: string, right: string) => {
  const [leftDigest, rightDigest] = await Promise.all([
    digestSecret(left),
    digestSecret(right),
  ]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index];
  }
  return difference === 0;
};

export async function isCronRequest(request: RequestLike): Promise<boolean> {
  const secrets = cronSecrets();
  if (secrets.length === 0) return false;

  const presented = [
    request.headers.get("x-cron-secret"),
    bearerToken(request),
  ].filter((value): value is string => Boolean(value));
  if (presented.length === 0) return false;

  const matches = await Promise.all(
    presented.flatMap((credential) =>
      secrets.map((secret) => secretsEqual(credential, secret)),
    ),
  );
  return matches.some(Boolean);
}

const queryApiKey = (request: RequestLike) => {
  try {
    return new URL(request.url).searchParams.get("api_key");
  } catch {
    return null;
  }
};

const apiKeyPrincipal = async (
  token: string,
  request: RequestLike,
  authMethod: "api_key" | "api_key_query",
): Promise<Principal> => {
  const result = await validateApiKey(token, request);
  if (!result.valid || !result.userId || !result.role) {
    return {
      authMethod: "anonymous",
      scopes: [],
      error: result.error || "Invalid API key",
    };
  }

  return {
    userId: result.userId,
    role: result.role,
    apiKeyId: result.apiKeyId,
    scopes: result.scopes ?? ["cache:read"],
    authMethod,
  };
};

export async function getPrincipal(
  request: RequestLike,
  options: PrincipalOptions = {},
): Promise<Principal> {
  const token = bearerToken(request);
  // Scheduled clients currently send both an API key and x-cron-secret.
  // Preserve the user Principal for ownership checks while paid execution
  // independently verifies the cron credential through isCronRequest().
  if (token?.startsWith("gk_live_")) {
    return apiKeyPrincipal(token, request, "api_key");
  }

  if (await isCronRequest(request)) {
    return { authMethod: "cron", scopes: [] };
  }

  if (token) {
    return apiKeyPrincipal(token, request, "api_key");
  }

  if (options.allowLegacyQueryKey) {
    const legacyToken = queryApiKey(request);
    if (legacyToken) {
      const url = new URL(request.url);
      if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
        return {
          authMethod: "anonymous",
          scopes: [],
          error: "API key in URL requires HTTPS",
        };
      }
      console.warn(
        JSON.stringify({
          event: "legacy_api_key_query_auth",
          path: url.pathname,
        }),
      );
      return apiKeyPrincipal(legacyToken, request, "api_key_query");
    }
  }

  const user = await getAuthUser();
  if (user) {
    return {
      userId: user.id,
      role: user.role === "admin" ? "admin" : "student",
      scopes: [],
      authMethod: "cookie",
    };
  }

  return {
    authMethod: "anonymous",
    scopes: [],
    error: "Authentication required",
  };
}

export function hasApiKeyScope(
  principal: Principal,
  scope: ApiKeyScope,
): boolean {
  return principal.authMethod === "api_key" && principal.scopes.includes(scope);
}

const unauthorized = (message = "Unauthorized") =>
  NextResponse.json({ error: message }, { status: 401 });

const forbidden = (message = "Forbidden") =>
  NextResponse.json({ error: message }, { status: 403 });

export async function requireUser(
  request: RequestLike,
  options: PrincipalOptions = {},
): Promise<Principal | NextResponse> {
  const principal = await getPrincipal(request, options);
  if (principal.userId) return principal;
  return unauthorized(principal.error || "Unauthorized");
}

export async function requireEffectiveUser(
  request: RequestLike,
  options: PrincipalOptions = {},
): Promise<EffectivePrincipal | NextResponse> {
  const principal = await getPrincipal(request, options);
  if (!principal.userId) {
    return unauthorized(principal.error || "Unauthorized");
  }

  const access = await checkEffectiveAccess(principal.userId);
  if (!access.allowed) {
    return NextResponse.json(
      {
        error: access.reason,
        code: access.code,
        action: access.code === "trial_expired" ? "subscribe" : undefined,
      },
      { status: accessDeniedStatus(access.code) },
    );
  }

  return {
    ...principal,
    userId: principal.userId,
    access,
  };
}

export async function requireAdminRequest(
  request: RequestLike,
): Promise<Principal | NextResponse> {
  const principal = await getPrincipal(request);
  if (!principal.userId) return unauthorized(principal.error || "Unauthorized");
  if (principal.role !== "admin") return forbidden("Admin only");
  return principal;
}

export async function requireCron(
  request: RequestLike,
): Promise<Principal | NextResponse> {
  if (await isCronRequest(request)) {
    return { authMethod: "cron", scopes: [] };
  }
  return unauthorized("Unauthorized");
}

export async function requireCronOrAdmin(
  request: RequestLike,
): Promise<Principal | NextResponse> {
  if (await isCronRequest(request)) {
    return { authMethod: "cron", scopes: [] };
  }
  return requireAdminRequest(request);
}

export function isAuthzError(
  value: Principal | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}

export async function requirePaidApiPermission(
  request: RequestLike,
): Promise<Principal | NextResponse> {
  return requireCronOrAdmin(request);
}
