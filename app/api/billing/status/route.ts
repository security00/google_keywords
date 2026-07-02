import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/auth";
import { getSaasEntitlement } from "@/lib/entitlements";
import { syncLatestCheckoutSubscriptionForUser } from "@/lib/stripe-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let entitlement = await getSaasEntitlement(user.id);
    if (!entitlement.allowed) {
      const synced = await syncLatestCheckoutSubscriptionForUser(user.id).catch(() => false);
      if (synced) entitlement = await getSaasEntitlement(user.id);
    }
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      entitlement,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
