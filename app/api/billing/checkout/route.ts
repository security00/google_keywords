import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/auth";
import {
  createStripeCustomerForUser,
  getAppUrl,
  getFoundingPriceId,
  getStripe,
} from "@/lib/stripe-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const stripe = getStripe();
    const appUrl = getAppUrl();
    const customerId = await createStripeCustomerForUser({
      userId: user.id,
      email: user.email,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getFoundingPriceId(), quantity: 1 }],
      success_url: `${appUrl}/dashboard/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/dashboard/settings?billing=cancelled`,
      metadata: {
        user_id: user.id,
        plan_key: "founding",
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan_key: "founding",
        },
      },
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
