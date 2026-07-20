import { NextResponse } from "next/server";

import { isAuthzError, requireEffectiveUser } from "@/lib/authz";
import {
  getOwnedJobStatusSnapshot,
  isLegacyStatusGetExecutionEnabled,
} from "@/lib/research-jobs";
import { handleExpandStatus } from "./expand-status-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const debug = process.env.DEBUG_API_LOGS === "true";
  const log = (message: string, meta?: Record<string, unknown>) => {
    if (!debug) return;
    if (meta) {
      console.log(`[api/expand] ${message}`, meta);
    } else {
      console.log(`[api/expand] ${message}`);
    }
  };

  try {
    if (request.method === "GET" && isLegacyStatusGetExecutionEnabled()) {
      console.warn(JSON.stringify({ event: "legacy_status_get_execution", jobType: "expand" }));
    }
    const principal = await requireEffectiveUser(request, {
      allowLegacyQueryKey: true,
    });
    if (isAuthzError(principal)) return principal;

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    if (request.method === "GET" && !isLegacyStatusGetExecutionEnabled()) {
      const snapshot = await getOwnedJobStatusSnapshot(
        jobId,
        principal.userId,
        "expand",
      );
      return snapshot
        ? NextResponse.json(snapshot)
        : NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const result = await handleExpandStatus(request, principal.userId, jobId, log);
    return NextResponse.json(result.response, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}

export const POST = GET;
