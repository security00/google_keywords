import { NextResponse } from "next/server";

import { isAuthzError, requireAdminRequest } from "@/lib/authz";
import { getSignalReviewQueue } from "@/lib/signal-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 20);
    const queue = await getSignalReviewQueue(searchParams.get("status"), limit);
    return NextResponse.json(queue);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Signal review query failed" },
      { status: 500 }
    );
  }
}
