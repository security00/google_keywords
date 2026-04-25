import { NextResponse } from "next/server";

import { isAuthorized } from "./discovery-feed-helpers";
import { buildDiscoveryFeedResponse } from "./discovery-feed-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    return await buildDiscoveryFeedResponse(userId, url.searchParams);
  } catch (error) {
    console.error("[integrations/discovery-feed]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
