import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/auth";
import { getAppUrl, getStripe, getStripeCustomerIdForUser } from "@/lib/stripe-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const customerId = await getStripeCustomerIdForUser(user.id);
    if (!customerId) {
      return NextResponse.json({ error: "No Stripe customer found" }, { status: 404 });
    }

    try {
      const session = await getStripe().billingPortal.sessions.create({
        customer: customerId,
        return_url: `${getAppUrl()}/dashboard/settings`,
      });

      return NextResponse.json({ url: session.url });
    } catch (error) {
      // A 404 means the stored customer belongs to another Stripe account/mode,
      // so there is no live billing relationship to manage yet.
      if ((error as { statusCode?: number })?.statusCode === 404) {
        return NextResponse.json({ error: "No Stripe customer found" }, { status: 404 });
      }
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
