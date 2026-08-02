import { NextResponse } from "next/server";

import { requireByokLiveOwner } from "@/lib/byok/api";
import { listPipelineHistory } from "@/lib/byok/pipeline";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const owner = await requireByokLiveOwner(request);
  if (owner instanceof NextResponse) return owner;
  try {
    const url = new URL(request.url);
    const parsedLimit = Number(url.searchParams.get("limit") ?? 20);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 20;
    const result = await listPipelineHistory(owner.ownerId, limit, url.searchParams.get("cursor"));
    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: "BYOK pipeline history unavailable", code: "PERSISTENCE_ERROR" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
