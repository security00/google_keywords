import { NextResponse } from "next/server";

import {
  DEFAULT_COMPARE_MAX_ITEMS,
  MAX_COMPARE_MAX_ITEMS,
  MIN_COMPARE_MAX_ITEMS,
  normalizeIntInRange,
  normalizeStrategy,
  previewSemanticDedupCandidates,
} from "@/app/api/research/compare/compare-helpers";
import { isAuthzError, requireAdminRequest } from "@/lib/authz";

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
    const strategy = normalizeStrategy(searchParams.get("strategy"));
    const autoStrategy = strategy === "manual" ? "priority" : strategy;
    const maxItems = normalizeIntInRange(
      searchParams.get("maxItems"),
      DEFAULT_COMPARE_MAX_ITEMS,
      MIN_COMPARE_MAX_ITEMS,
      MAX_COMPARE_MAX_ITEMS
    );

    const preview = await previewSemanticDedupCandidates(
      null,
      autoStrategy,
      maxItems
    );

    return NextResponse.json({ strategy: autoStrategy, maxItems, ...preview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Preview failed" },
      { status: 500 }
    );
  }
}
