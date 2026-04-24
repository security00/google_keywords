import { NextResponse } from "next/server";

import { authenticate } from "@/lib/auth_middleware";
import { getJob } from "@/lib/research-jobs";
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
    const auth = await authenticate(request as Parameters<typeof authenticate>[0]);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 });
    }
    const user = { id: auth.userId! };
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const result = await handleExpandStatus(request, user.id, jobId, log);
    return NextResponse.json(result.response, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
