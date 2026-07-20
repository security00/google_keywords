import { NextResponse } from "next/server";
import { handleFinalizeGet } from "./finalize-service";
import { isLegacyStatusGetExecutionEnabled } from "@/lib/research-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (request.method === "GET" && !isLegacyStatusGetExecutionEnabled()) {
      return NextResponse.json(
        { error: "Use POST to execute finalization" },
        { status: 405, headers: { Allow: "POST" } },
      );
    }
    if (request.method === "GET") {
      console.warn(JSON.stringify({ event: "legacy_finalize_get_execution", jobType: "expand" }));
    }
    return await handleFinalizeGet(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}

export const POST = GET;
