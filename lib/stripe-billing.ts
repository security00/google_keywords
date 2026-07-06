import "server-only";

import { randomUUID } from "crypto";
import Stripe from "stripe";

import { d1Query } from "@/lib/d1";

type CustomerRow = {
  stripe_customer_id: string;
};

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

export const getStripeSecretKey = () => {
  const value = requiredEnv("STRIPE_SECRET_KEY");
  if (/\s/.test(value)) {
    throw new Error("STRIPE_SECRET_KEY must be a single line without spaces or line breaks");
  }
  if (!/^(sk|rk)_(test|live)_/.test(value)) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe test or live secret key");
  }
  return value;
};

export const getStripe = () =>
  new Stripe(getStripeSecretKey(), {
    httpClient: Stripe.createFetchHttpClient(),
  });

export const getAppUrl = () => {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (!value) throw new Error("NEXT_PUBLIC_APP_URL or APP_URL is not configured");
  return value.replace(/\/$/, "");
};

export const getFoundingPriceId = () => {
  const value = requiredEnv("STRIPE_FOUNDING_PRICE_ID");
  if (!value.startsWith("price_")) {
    throw new Error("STRIPE_FOUNDING_PRICE_ID must be a Stripe Price ID that starts with price_");
  }
  return value;
};

export async function getStripeCustomerIdForUser(userId: string) {
  const stored = await d1Query<CustomerRow>(
    `SELECT stripe_customer_id
     FROM stripe_customers
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  );
  if (stored.rows[0]?.stripe_customer_id) return stored.rows[0].stripe_customer_id;

  const { rows } = await d1Query<CustomerRow>(
    `SELECT stripe_customer_id
     FROM saas_subscriptions
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0]?.stripe_customer_id ?? null;
}

export async function upsertStripeCustomerForUser({
  userId,
  email,
  stripeCustomerId,
}: {
  userId: string;
  email: string;
  stripeCustomerId: string;
}) {
  await d1Query(
    `INSERT INTO stripe_customers
     (id, user_id, stripe_customer_id, email, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       stripe_customer_id = excluded.stripe_customer_id,
       email = excluded.email,
       updated_at = excluded.updated_at`,
    [randomUUID(), userId, stripeCustomerId, email]
  );
}

export async function createStripeCustomerForUser({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const existing = await getStripeCustomerIdForUser(userId);
  if (existing) return existing;

  const customer = await getStripe().customers.create({
    email,
    metadata: { user_id: userId },
  });
  await upsertStripeCustomerForUser({
    userId,
    email,
    stripeCustomerId: customer.id,
  });
  return customer.id;
}

const timestampToIso = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;

export async function upsertStripeSubscription(subscription: Stripe.Subscription) {
  const raw = subscription as Stripe.Subscription & {
    current_period_start?: number;
    current_period_end?: number;
  };
  const userId = typeof subscription.metadata?.user_id === "string" ? subscription.metadata.user_id : "";
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;
  if (!userId || !customerId) {
    throw new Error("Stripe subscription is missing user metadata or customer id");
  }
  const customerEmail =
    typeof subscription.customer === "object" && subscription.customer && "email" in subscription.customer && subscription.customer.email
      ? subscription.customer.email
      : "";
  if (customerEmail) {
    await upsertStripeCustomerForUser({
      userId,
      email: customerEmail,
      stripeCustomerId: customerId,
    });
  }

  const priceId = subscription.items.data[0]?.price?.id ?? "";
  const planKey = priceId === process.env.STRIPE_FOUNDING_PRICE_ID ? "founding" : "founding";
  const now = new Date().toISOString();

  await d1Query(
    `INSERT INTO saas_subscriptions
     (id, user_id, stripe_customer_id, stripe_subscription_id, plan_key, status,
      current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(stripe_subscription_id) DO UPDATE SET
       user_id = excluded.user_id,
       stripe_customer_id = excluded.stripe_customer_id,
       plan_key = excluded.plan_key,
       status = excluded.status,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end,
       updated_at = excluded.updated_at`,
    [
      randomUUID(),
      userId,
      customerId,
      subscription.id,
      planKey,
      subscription.status,
      timestampToIso(raw.current_period_start),
      timestampToIso(raw.current_period_end),
      subscription.cancel_at_period_end ? 1 : 0,
      now,
      now,
    ]
  );
}

export async function upsertSubscriptionById(subscriptionId: string) {
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  await upsertStripeSubscription(subscription);
  return subscription;
}

export async function syncLatestCheckoutSubscriptionForUser(userId: string) {
  const customerId = await getStripeCustomerIdForUser(userId);
  if (!customerId) return false;

  const sessions = await getStripe().checkout.sessions.list({
    customer: customerId,
    limit: 5,
  });

  const session = sessions.data.find((item) =>
    item.status === "complete" &&
    item.payment_status === "paid" &&
    item.metadata?.user_id === userId &&
    item.subscription
  );
  const subscriptionId =
    typeof session?.subscription === "string"
      ? session.subscription
      : session?.subscription?.id;
  if (!subscriptionId) return false;

  await upsertSubscriptionById(subscriptionId);
  return true;
}
