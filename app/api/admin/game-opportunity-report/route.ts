import { NextResponse } from "next/server";

import { isAuthzError, requireAdminRequest } from "@/lib/authz";
import { clampOpportunityLimit } from "@/lib/game-opportunity-enrichment";
import { getGameOpportunityReport } from "@/lib/game-opportunity-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;
  if (!principal.userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = clampOpportunityLimit(Number(searchParams.get("limit") || 10));
    const report = await getGameOpportunityReport(principal.userId, limit);
    return NextResponse.json({ limit, ...report });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Opportunity report failed" },
      { status: 500 }
    );
  }
}
