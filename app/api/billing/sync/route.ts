import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { getAuthUser } from "@/lib/auth";
import { getStripe, getStripeCustomerIdForUser, syncLatestCheckoutSubscriptionForUser, upsertSubscriptionById } from "@/lib/stripe-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { sessionId?: string };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (sessionId && !sessionId.startsWith("cs_")) {
      return NextResponse.json({ error: "Missing or invalid checkout session id" }, { status: 400 });
    }

    const stripe = getStripe();
    let session: Stripe.Checkout.Session | null = sessionId ? await stripe.checkout.sessions.retrieve(sessionId) : null;
    if (!session) {
      const customerId = await getStripeCustomerIdForUser(user.id);
      if (customerId) {
        session = (
          await stripe.checkout.sessions.list({
            customer: customerId,
            limit: 5,
          })
        ).data.find((item) => item.metadata?.user_id === user.id && item.subscription) ?? null;
      }
    }

    if (!session) {
      const synced = await syncLatestCheckoutSubscriptionForUser(user.id);
      if (synced) return NextResponse.json({ ok: true });
      return NextResponse.json({ error: "No checkout session found for the current user" }, { status: 404 });
    }
    if (session.metadata?.user_id !== user.id) {
      return NextResponse.json({ error: "Checkout session does not belong to the current user" }, { status: 403 });
    }

    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    if (!subscriptionId) {
      return NextResponse.json({ error: "Checkout session has no subscription yet" }, { status: 409 });
    }

    await upsertSubscriptionById(subscriptionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
