import { NextResponse } from "next/server";

import { isAuthzError, requireAdminRequest } from "@/lib/authz";
import { getSourceScoreStats } from "@/lib/source-score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  try {
    const stats = await getSourceScoreStats();
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Source score query failed" },
      { status: 500 }
    );
  }
}
