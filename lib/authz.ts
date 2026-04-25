import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { validateApiKey } from "@/lib/api_keys";
import { getAuthUser } from "@/lib/auth";
import { d1Query } from "@/lib/d1";

export type PrincipalRole = "admin" | "student";

export type Principal = {
  userId?: string;
  role?: PrincipalRole;
  authMethod: "cookie" | "api_key" | "cron" | "anonymous";
  error?: string;
};

type RequestLike = Request | NextRequest;

const normalizeRole = (role: string | null | undefined): PrincipalRole =>
  role === "admin" ? "admin" : "student";

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

const isCronRequest = (request: RequestLike) => {
  const secrets = cronSecrets();
  if (secrets.length === 0) return false;

  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret && secrets.includes(headerSecret)) return true;

  const token = bearerToken(request);
  return Boolean(token && secrets.includes(token));
};

const getRoleForUser = async (userId: string) => {
  const { rows } = await d1Query<{ role: string }>(
    "SELECT role FROM auth_users_v2 WHERE id = ? LIMIT 1",
    [userId]
  );
  return rows[0]?.role ?? null;
};

export async function getPrincipal(request: RequestLike): Promise<Principal> {
  if (isCronRequest(request)) {
    return { authMethod: "cron" };
  }

  const token = bearerToken(request);
  if (token) {
    const result = await validateApiKey(token, request);
    if (!result.valid || !result.userId) {
      return {
        authMethod: "anonymous",
        error: result.error || "Invalid API key",
      };
    }

    const role = await getRoleForUser(result.userId);
    if (!role) {
      return { authMethod: "anonymous", error: "User not found" };
    }

    return {
      userId: result.userId,
      role: normalizeRole(role),
      authMethod: "api_key",
    };
  }

  const user = await getAuthUser();
  if (user) {
    return {
      userId: user.id,
      role: normalizeRole(user.role),
      authMethod: "cookie",
    };
  }

  return {
    authMethod: "anonymous",
    error: "Authentication required",
  };
}

const unauthorized = (message = "Unauthorized") =>
  NextResponse.json({ error: message }, { status: 401 });

const forbidden = (message = "Forbidden") =>
  NextResponse.json({ error: message }, { status: 403 });

export async function requireUser(
  request: RequestLike
): Promise<Principal | NextResponse> {
  const principal = await getPrincipal(request);
  if (principal.userId) return principal;
  return unauthorized(principal.error || "Unauthorized");
}

export async function requireAdminRequest(
  request: RequestLike
): Promise<Principal | NextResponse> {
  const principal = await getPrincipal(request);
  if (!principal.userId) return unauthorized(principal.error || "Unauthorized");
  if (principal.role !== "admin") return forbidden("Admin only");
  return principal;
}

export async function requireCron(
  request: RequestLike
): Promise<Principal | NextResponse> {
  if (isCronRequest(request)) return { authMethod: "cron" };
  return unauthorized("Unauthorized");
}

export async function requireCronOrAdmin(
  request: RequestLike
): Promise<Principal | NextResponse> {
  if (isCronRequest(request)) return { authMethod: "cron" };
  return requireAdminRequest(request);
}

export function isAuthzError(
  value: Principal | NextResponse
): value is NextResponse {
  return value instanceof NextResponse;
}

export async function requirePaidApiPermission(
  request: RequestLike
): Promise<Principal | NextResponse> {
  return requireCronOrAdmin(request);
}

