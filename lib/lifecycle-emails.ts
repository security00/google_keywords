import "server-only";

import { d1Query } from "@/lib/d1";
import { appBaseUrl, sendTransactionalEmail } from "@/lib/email";

export const LIFECYCLE_EVENT_TYPES = [
  "welcome",
  "trial_expiring_7d",
  "trial_expiring_1d",
  "trial_expired",
  "payment_succeeded",
] as const;

export type LifecycleEventType = (typeof LIFECYCLE_EVENT_TYPES)[number];

type CandidateRow = {
  id: string;
  email: string;
  trial_expires_at: string;
};

const ACTIVE_STRIPE_STATUSES = ["active", "trialing", "past_due"];

const dayMs = 24 * 60 * 60 * 1000;

const startOfUtcDay = (value: Date) =>
  Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

export const daysUntil = (expiresAt: string, now = new Date()): number => {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return Number.POSITIVE_INFINITY;
  return Math.round((startOfUtcDay(new Date(expires)) - startOfUtcDay(now)) / dayMs);
};

export const claimLifecycleEmail = async ({
  userId,
  email,
  eventType,
  periodKey,
  now = new Date(),
}: {
  userId: string;
  email: string;
  eventType: LifecycleEventType;
  periodKey: string;
  now?: Date;
}): Promise<boolean> => {
  const inserted = await d1Query(
    `INSERT INTO email_events (user_id, event_type, period_key, email, sent_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, event_type, period_key) DO NOTHING`,
    [userId, eventType, periodKey, email, now.toISOString()]
  );
  return (inserted.meta?.changes ?? 0) > 0;
};

const settingsUrl = () => `${appBaseUrl()}/dashboard/settings`;

const wrap = (title: string, body: string, ctaLabel: string, ctaHref: string) => `
<div style="max-width:480px;margin:0 auto;font-family:system-ui,sans-serif;padding:32px 16px">
  <h2 style="font-size:20px;margin-bottom:16px">${title}</h2>
  <p style="color:#555;line-height:1.6">${body}</p>
  <a href="${ctaHref}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:500;margin:16px 0">${ctaLabel}</a>
  <p style="color:#888;font-size:13px;line-height:1.6">The $49 Founding Member price includes applicable tax.</p>
</div>`;

export const lifecycleEmailCopy = (
  eventType: LifecycleEventType
): { subject: string; html: string } => {
  switch (eventType) {
    case "welcome":
      return {
        subject: "Welcome to Discover Keywords",
        html: wrap(
          "Your trial is ready",
          "Your account is live. Start with Opportunity Radar, then subscribe from Settings before the trial ends. The $49/month Founding Member price includes applicable tax.",
          "Open the dashboard",
          `${appBaseUrl()}/dashboard/opportunities`
        ),
      };
    case "trial_expiring_7d":
      return {
        subject: "Your Discover Keywords trial ends in 7 days",
        html: wrap(
          "7 days left on your trial",
          "Subscribe from Settings to keep the full Opportunity Radar after your trial ends. Checkout shows $49/month with tax included.",
          "Subscribe",
          settingsUrl()
        ),
      };
    case "trial_expiring_1d":
      return {
        subject: "Your Discover Keywords trial ends tomorrow",
        html: wrap(
          "Trial ends tomorrow",
          "Subscribe now to avoid losing access. The Founding Member price stays $49/month, tax included.",
          "Subscribe",
          settingsUrl()
        ),
      };
    case "trial_expired":
      return {
        subject: "Your Discover Keywords trial has ended",
        html: wrap(
          "Trial ended",
          "Subscribe from Settings to restore access. You still pay $49/month; applicable tax is included in that price.",
          "Subscribe",
          settingsUrl()
        ),
      };
    case "payment_succeeded":
      return {
        subject: "Your Discover Keywords subscription is active",
        html: wrap(
          "Payment confirmed",
          "Founding Member access is active. Manage billing any time from Settings. The $49/month price you paid includes applicable tax.",
          "Manage billing",
          settingsUrl()
        ),
      };
  }
};

export const sendClaimedLifecycleEmail = async ({
  userId,
  email,
  eventType,
  periodKey,
}: {
  userId: string;
  email: string;
  eventType: LifecycleEventType;
  periodKey: string;
}): Promise<"sent" | "duplicate" | "failed"> => {
  const claimed = await claimLifecycleEmail({ userId, email, eventType, periodKey });
  if (!claimed) return "duplicate";
  try {
    const copy = lifecycleEmailCopy(eventType);
    await sendTransactionalEmail({ to: email, ...copy });
    return "sent";
  } catch (error) {
    await d1Query(
      `DELETE FROM email_events
       WHERE user_id = ? AND event_type = ? AND period_key = ?`,
      [userId, eventType, periodKey]
    );
    console.error("[lifecycle-email]", error);
    return "failed";
  }
};

export const sendWelcomeEmail = async (userId: string, email: string) =>
  sendClaimedLifecycleEmail({
    userId,
    email,
    eventType: "welcome",
    periodKey: "signup",
  });

export const sendPaymentSucceededEmail = async (
  userId: string,
  email: string,
  periodKey: string
) =>
  sendClaimedLifecycleEmail({
    userId,
    email,
    eventType: "payment_succeeded",
    periodKey,
  });

const eventForDaysLeft = (daysLeft: number): LifecycleEventType | null => {
  if (daysLeft === 7) return "trial_expiring_7d";
  if (daysLeft === 1) return "trial_expiring_1d";
  if (daysLeft === 0) return "trial_expired";
  return null;
};

export async function runLifecycleEmailCron(now = new Date()) {
  const windowStart = new Date(now.getTime() - dayMs).toISOString();
  const windowEnd = new Date(now.getTime() + 8 * dayMs).toISOString();
  const statusPlaceholders = ACTIVE_STRIPE_STATUSES.map(() => "?").join(", ");

  const { rows } = await d1Query<CandidateRow>(
    `SELECT u.id, u.email, u.trial_expires_at
     FROM auth_users_v2 u
     WHERE u.role = 'student'
       AND u.trial_expires_at IS NOT NULL
       AND u.trial_expires_at >= ?
       AND u.trial_expires_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM saas_subscriptions s
         WHERE s.user_id = u.id AND s.status IN (${statusPlaceholders})
       )
     ORDER BY u.trial_expires_at ASC
     LIMIT 50`,
    [windowStart, windowEnd, ...ACTIVE_STRIPE_STATUSES]
  );

  let sent = 0;
  let duplicate = 0;
  let failed = 0;

  for (const row of rows) {
    const eventType = eventForDaysLeft(daysUntil(row.trial_expires_at, now));
    if (!eventType) continue;
    const result = await sendClaimedLifecycleEmail({
      userId: row.id,
      email: row.email,
      eventType,
      periodKey: row.trial_expires_at.slice(0, 10),
    });
    if (result === "sent") sent += 1;
    else if (result === "duplicate") duplicate += 1;
    else failed += 1;
  }

  return { skipped: false, sent, duplicate, failed, scanned: rows.length };
}
