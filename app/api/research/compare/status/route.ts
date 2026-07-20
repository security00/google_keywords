import { NextResponse } from "next/server";
import { isAuthzError, requireEffectiveUser } from "@/lib/authz";
import {
  getOwnedJobStatusSnapshot,
  isLegacyStatusGetExecutionEnabled,
} from "@/lib/research-jobs";
import { handleCompareStatusGet } from "./compare-status-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (request.method === "GET" && isLegacyStatusGetExecutionEnabled()) {
      console.warn(JSON.stringify({ event: "legacy_status_get_execution", jobType: "compare" }));
    }
    const principal = await requireEffectiveUser(request, {
      allowLegacyQueryKey: true,
    });
    if (isAuthzError(principal)) return principal;

    if (request.method === "GET" && !isLegacyStatusGetExecutionEnabled()) {
      const jobId = new URL(request.url).searchParams.get("jobId");
      if (!jobId) {
        return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
      }
      const snapshot = await getOwnedJobStatusSnapshot(
        jobId,
        principal.userId,
        "compare",
      );
      return snapshot
        ? NextResponse.json(snapshot)
        : NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return await handleCompareStatusGet(request, principal.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}

export const POST = GET;
