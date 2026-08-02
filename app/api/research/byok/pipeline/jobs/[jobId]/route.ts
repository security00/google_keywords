import { NextResponse } from "next/server";

import { requireByokLiveOwner } from "@/lib/byok/api";
import { ByokPipelineError, getPipelineJob } from "@/lib/byok/pipeline";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const owner = await requireByokLiveOwner(request);
  if (owner instanceof NextResponse) return owner;
  try {
    const { jobId } = await context.params;
    const response = NextResponse.json(await getPipelineJob(owner.ownerId, jobId));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const code = error instanceof ByokPipelineError ? error.code : "PERSISTENCE_ERROR";
    const status = error instanceof ByokPipelineError ? error.status : 503;
    return NextResponse.json(
      { error: "BYOK pipeline job unavailable", code },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
