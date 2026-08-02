import { NextResponse } from "next/server";

import { requireByokLiveOwner } from "@/lib/byok/api";
import { loadPipelineReadiness } from "@/lib/byok/pipeline-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const owner = await requireByokLiveOwner(request);
  if (owner instanceof NextResponse) return owner;
  try {
    const response = NextResponse.json(await loadPipelineReadiness(owner.ownerId));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: "BYOK readiness unavailable", code: "PERSISTENCE_ERROR" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
