import { NextResponse } from "next/server";

import { getGameOpportunityEnrichmentPreview, clampOpportunityLimit } from "@/lib/game-opportunity-enrichment";
import { isAuthzError, requireAdminRequest } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  try {
    const { searchParams } = new URL(request.url);
    const limit = clampOpportunityLimit(Number(searchParams.get("limit") || 10));
    const preview = await getGameOpportunityEnrichmentPreview(limit);
    return NextResponse.json({ limit, ...preview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Opportunity enrichment failed" },
      { status: 500 }
    );
  }
}
