import "server-only";

import { randomUUID } from "crypto";

import { d1Query } from "@/lib/d1";
import { getUserWithMeta, isTrialActive } from "@/lib/usage";

export type PlanKey = "founding" | "scout" | "builder" | "studio" | "course" | "admin";
export type EntitlementSource = "stripe" | "course" | "admin" | "none";
export type EntitlementStatus = "active" | "trialing" | "past_due" | "canceled" | "expired" | "none";

export type SaasEntitlement = {
  allowed: boolean;
  source: EntitlementSource;
  planKey: PlanKey | null;
  status: EntitlementStatus;
  expiresAt: string | null;
  briefLimit: number;
  briefUsed: number;
  reason?: string;
};

type SubscriptionRow = {
  plan_key: string;
  status: string;
  current_period_end: string | null;
};

type UsageRow = {
  used: number;
  limit_value: number;
};

const ACTIVE_STRIPE_STATUSES = new Set(["active", "trialing"]);
const FOUNDER_BRIEF_LIMIT = 20;
const COURSE_BRIEF_LIMIT = 5;

const normalizePlanKey = (value: string | null | undefined): PlanKey =>
  value === "scout" || value === "builder" || value === "studio" || value === "course"
    ? value
    : value === "admin"
      ? "admin"
      : "founding";

const currentMonthWindow = () => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
};

const briefLimitFor = (planKey: PlanKey, source: EntitlementSource) => {
  if (source === "admin") return 999999;
  if (planKey === "course") return COURSE_BRIEF_LIMIT;
  if (planKey === "studio") return 100;
  if (planKey === "builder") return 50;
  if (planKey === "scout") return 10;
  return FOUNDER_BRIEF_LIMIT;
};

export async function getBriefUsage(userId: string, limitValue: number) {
  const { start, end } = currentMonthWindow();
  const { rows } = await d1Query<UsageRow>(
    `SELECT used, limit_value
     FROM saas_usage_counters
     WHERE user_id = ? AND counter_key = 'build_brief' AND period_start = ?
     LIMIT 1`,
    [userId, start]
  );

  if (!rows.length) {
    await d1Query(
      `INSERT INTO saas_usage_counters
       (id, user_id, counter_key, period_start, period_end, used, limit_value, created_at, updated_at)
       VALUES (?, ?, 'build_brief', ?, ?, 0, ?, datetime('now'), datetime('now'))`,
      [randomUUID(), userId, start, end, limitValue]
    );
    return { used: 0, limit: limitValue };
  }

  const row = rows[0];
  return { used: Number(row.used || 0), limit: Number(row.limit_value || limitValue) };
}

export async function getActiveStripeSubscription(userId: string) {
  const { rows } = await d1Query<SubscriptionRow>(
    `SELECT plan_key, status, current_period_end
     FROM saas_subscriptions
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId]
  );

  const row = rows[0];
  if (!row) return null;
  return {
    planKey: normalizePlanKey(row.plan_key),
    status: row.status,
    expiresAt: row.current_period_end,
    active: ACTIVE_STRIPE_STATUSES.has(row.status),
  };
}

export async function getSaasEntitlement(userId: string): Promise<SaasEntitlement> {
  const user = await getUserWithMeta(userId);
  if (!user) {
    return {
      allowed: false,
      source: "none",
      planKey: null,
      status: "none",
      expiresAt: null,
      briefLimit: 0,
      briefUsed: 0,
      reason: "User not found",
    };
  }

  if (user.role === "admin") {
    const limit = briefLimitFor("admin", "admin");
    const usage = await getBriefUsage(userId, limit);
    return {
      allowed: true,
      source: "admin",
      planKey: "admin",
      status: "active",
      expiresAt: null,
      briefLimit: usage.limit,
      briefUsed: usage.used,
    };
  }

  const stripe = await getActiveStripeSubscription(userId);
  if (stripe?.active) {
    const limit = briefLimitFor(stripe.planKey, "stripe");
    const usage = await getBriefUsage(userId, limit);
    return {
      allowed: true,
      source: "stripe",
      planKey: stripe.planKey,
      status: stripe.status as EntitlementStatus,
      expiresAt: stripe.expiresAt,
      briefLimit: usage.limit,
      briefUsed: usage.used,
    };
  }

  const trial = isTrialActive(user);
  if (trial.active) {
    const limit = briefLimitFor("course", "course");
    const usage = await getBriefUsage(userId, limit);
    return {
      allowed: true,
      source: "course",
      planKey: "course",
      status: "trialing",
      expiresAt: trial.expiresAt,
      briefLimit: usage.limit,
      briefUsed: usage.used,
    };
  }

  return {
    allowed: false,
    source: stripe ? "stripe" : "none",
    planKey: stripe?.planKey ?? null,
    status: (stripe?.status as EntitlementStatus | undefined) ?? "expired",
    expiresAt: stripe?.expiresAt ?? user.trialExpiresAt,
    briefLimit: 0,
    briefUsed: 0,
    reason: user.trialExpiresAt ? "Trial expired. Subscription required." : "Activation or subscription required.",
  };
}
