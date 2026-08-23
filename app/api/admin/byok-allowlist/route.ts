import { NextResponse } from "next/server";

import { isAuthzError, requireAdminRequest } from "@/lib/authz";
import {
  ByokAllowlistError,
  grantByokAllowlist,
  listByokAllowlist,
  revokeByokAllowlist,
} from "@/lib/byok/allowlist";
import { readLimitedJsonObject } from "@/lib/provider-connections/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = (body: unknown, init?: ResponseInit) => {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
};

const sameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    if (origin !== new URL(request.url).origin) return false;
    const fetchSite = request.headers.get("sec-fetch-site");
    return !fetchSite || fetchSite === "same-origin";
  } catch {
    return false;
  }
};

const errorResponse = (error: unknown) => {
  if (error instanceof ByokAllowlistError) {
    const status =
      error.code === "USER_NOT_FOUND" || error.code === "NOT_ON_ALLOWLIST"
        ? 404
        : error.code === "ENV_PINNED" || error.code === "USER_BANNED"
          ? 409
          : error.code === "PERSISTENCE_ERROR"
            ? 503
            : 400;
    return noStore({ error: error.code, code: error.code }, { status });
  }
  return noStore({ error: "BYOK_ALLOWLIST_UNAVAILABLE", code: "BYOK_ALLOWLIST_UNAVAILABLE" }, { status: 503 });
};

const requireCookieAdmin = async (request: Request) => {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) {
    principal.headers.set("Cache-Control", "no-store");
    return principal;
  }
  if (!principal.userId) {
    return noStore({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (principal.authMethod !== "cookie") {
    return noStore(
      { error: "Cookie authentication required", code: "COOKIE_AUTH_REQUIRED" },
      { status: 403 },
    );
  }
  if (!sameOrigin(request)) {
    return noStore(
      { error: "Cross-origin request rejected", code: "CROSS_ORIGIN_REQUEST" },
      { status: 403 },
    );
  }
  return principal;
};

export async function GET(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) {
    principal.headers.set("Cache-Control", "no-store");
    return principal;
  }
  try {
    return noStore({ items: await listByokAllowlist() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const principal = await requireCookieAdmin(request);
  if (principal instanceof Response) return principal;
  if (!principal.userId) {
    return noStore({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const body = await readLimitedJsonObject(request);
    const keys = Object.keys(body).sort();
    const allowed = ["dailyBudgetUsd", "email", "maxConcurrentJobs"];
    if (keys.some((key) => !allowed.includes(key)) || typeof body.email !== "string") {
      return noStore({ error: "INVALID_INPUT", code: "INVALID_INPUT" }, { status: 400 });
    }
    const entry = await grantByokAllowlist({
      actorId: principal.userId,
      email: body.email,
      dailyBudgetUsd: typeof body.dailyBudgetUsd === "number" ? body.dailyBudgetUsd : undefined,
      maxConcurrentJobs: typeof body.maxConcurrentJobs === "number"
        ? body.maxConcurrentJobs
        : undefined,
    });
    return noStore({ item: entry });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const principal = await requireCookieAdmin(request);
  if (principal instanceof Response) return principal;
  if (!principal.userId) {
    return noStore({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const body = await readLimitedJsonObject(request);
    const keys = Object.keys(body).sort();
    if (keys.join(",") !== "ownerId" || typeof body.ownerId !== "string") {
      return noStore({ error: "INVALID_INPUT", code: "INVALID_INPUT" }, { status: 400 });
    }
    return noStore(await revokeByokAllowlist({
      actorId: principal.userId,
      ownerId: body.ownerId,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
