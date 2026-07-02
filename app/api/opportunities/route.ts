import { NextRequest, NextResponse } from "next/server";

import { getAuthUser } from "@/lib/auth";
import { getSaasEntitlement } from "@/lib/entitlements";
import { syncLatestCheckoutSubscriptionForUser } from "@/lib/stripe-billing";
import {
  listKeywordOpportunities,
  type OpportunityCategory,
  type OpportunityPipeline,
  type OpportunityStatus,
} from "@/lib/opportunities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const oneOf = <T extends string>(value: string | null, allowed: readonly T[]) =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const params = request.nextUrl.searchParams;
    let entitlement = await getSaasEntitlement(user.id);
    if (!entitlement.allowed) {
      const synced = await syncLatestCheckoutSubscriptionForUser(user.id).catch(() => false);
      if (synced) entitlement = await getSaasEntitlement(user.id);
    }
    const result = await listKeywordOpportunities(entitlement, {
      pipeline: oneOf<OpportunityPipeline>(params.get("pipeline"), ["google_new", "game_new", "validated_market"]),
      status: oneOf<OpportunityStatus>(params.get("status"), ["strong_pass", "pass", "close", "watch", "skip"]),
      category: oneOf<OpportunityCategory>(params.get("category"), ["ai_tools", "games", "saas", "tools", "templates", "other"]),
      q: params.get("q") || undefined,
      limit: Number(params.get("limit") || 60),
      offset: Number(params.get("offset") || 0),
    });

    return NextResponse.json({
      ...result,
      entitlement,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
