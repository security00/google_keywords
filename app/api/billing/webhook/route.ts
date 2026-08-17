import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { getStripe, upsertStripeSubscription, upsertSubscriptionById } from "@/lib/stripe-billing";
import {
  claimStripeWebhookEvent,
  completeStripeWebhookEvent,
  failStripeWebhookEvent,
} from "@/lib/stripe-webhook-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const webhookSecret = () => {
  const value = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!value) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  return value;
};

export async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (typeof session.subscription === "string") {
        await upsertSubscriptionById(session.subscription);
      }
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await upsertStripeSubscription(event.data.object as Stripe.Subscription);
      return;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice & {
        subscription?: string | Stripe.Subscription | null;
      };
      const subscriptionId =
        typeof invoice.subscription === "string"
          ? invoice.subscription
          : invoice.subscription?.id;
      if (subscriptionId) {
        await upsertSubscriptionById(subscriptionId);
      }
      return;
    }
    default:
      return;
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const body = await request.text();
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const claim = await claimStripeWebhookEvent(event.id, event.type);
    if (claim.kind === "duplicate") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (claim.kind === "in_flight") {
      return NextResponse.json({ error: "Event is already being processed" }, { status: 503 });
    }

    try {
      await handleStripeEvent(event);
      await completeStripeWebhookEvent(event.id);
      return NextResponse.json({ received: true });
    } catch (error) {
      await failStripeWebhookEvent(event.id);
      const message = error instanceof Error ? error.message : "Webhook failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch {
    return NextResponse.json({ error: "Webhook ledger unavailable" }, { status: 503 });
  }
}
