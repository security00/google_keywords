import { NextResponse } from "next/server";

import { isAuthzError, requireAdminRequest } from "@/lib/authz";
import {
  ByokReconciliationError,
  loadByokOperationsHealth,
  reconcileStaleByokJob,
} from "@/lib/byok/operations";
import {
  ProviderConnectionApiError,
  readLimitedJsonObject,
} from "@/lib/provider-connections/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) {
    principal.headers.set("Cache-Control", "no-store");
    return principal;
  }
  try {
    return NextResponse.json(await loadByokOperationsHealth(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "BYOK operations health unavailable", code: "BYOK_HEALTH_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

const sameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    if (origin !== new URL(request.url).origin) return false;
    const fetchSite = request.headers.get("sec-fetch-site");
    return !fetchSite || fetchSite === "same-origin";
  }
  catch { return false; }
};

export async function POST(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) {
    principal.headers.set("Cache-Control", "no-store");
    return principal;
  }
  if (!principal.userId) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (principal.authMethod !== "cookie") {
    return NextResponse.json(
      { error: "Cookie authentication required", code: "COOKIE_AUTH_REQUIRED" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin request rejected", code: "CROSS_ORIGIN_REQUEST" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const record = await readLimitedJsonObject(request);
    const keys = Object.keys(record).sort();
    if (keys.join(",") !== "action,expectedUpdatedAt,jobId,ownerId"
      || (record.action !== "complete_from_private_cache" && record.action !== "mark_uncertain")
      || typeof record.ownerId !== "string" || !record.ownerId
      || typeof record.jobId !== "string" || !record.jobId
      || typeof record.expectedUpdatedAt !== "string" || !record.expectedUpdatedAt) {
      throw new Error("invalid");
    }
    const result = await reconcileStaleByokJob({
      actorId: principal.userId,
      ownerId: record.ownerId,
      jobId: record.jobId,
      expectedUpdatedAt: record.expectedUpdatedAt,
      action: record.action,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProviderConnectionApiError) {
      return NextResponse.json(
        { error: "BYOK reconciliation rejected", code: error.code },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    const code = error instanceof ByokReconciliationError ? error.code : "INVALID_REQUEST";
    const status = code === "JOB_NOT_FOUND" ? 404
      : code === "JOB_STATE_CONFLICT" || code === "JOB_NOT_STALE" ? 409
        : code === "INVALID_REQUEST" ? 400 : 503;
    return NextResponse.json(
      { error: "BYOK reconciliation rejected", code },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
