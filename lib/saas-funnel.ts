import "server-only";

import { d1Query } from "@/lib/d1";

export type SaasFunnelSnapshot = {
  generatedAt: string;
  registeredStudents: number;
  pendingActivation: number;
  activatedTrials: number;
  activeTrials: number;
  expiredTrials: number;
  subscribed: number;
  invitedActivated: number;
  last7dRegistrations: number;
  last30dRegistrations: number;
};

type FunnelRow = {
  registered_students: number;
  pending_activation: number;
  activated_trials: number;
  active_trials: number;
  expired_trials: number;
  subscribed: number;
  invited_activated: number;
  last_7d_registrations: number;
  last_30d_registrations: number;
};

const toCount = (value: number | null | undefined) => Number(value ?? 0);

export async function loadSaasFunnelSnapshot(
  now = new Date()
): Promise<SaasFunnelSnapshot> {
  const { rows } = await d1Query<FunnelRow>(
    `SELECT
       (SELECT COUNT(*) FROM auth_users_v2 WHERE role = 'student') AS registered_students,
       (SELECT COUNT(*) FROM auth_users_v2 WHERE role = 'student' AND trial_started_at IS NULL) AS pending_activation,
       (SELECT COUNT(*) FROM auth_users_v2 WHERE role = 'student' AND trial_started_at IS NOT NULL) AS activated_trials,
       (SELECT COUNT(*)
          FROM auth_users_v2 u
         WHERE u.role = 'student'
           AND u.trial_started_at IS NOT NULL
           AND u.trial_expires_at IS NOT NULL
           AND julianday(u.trial_expires_at) >= julianday('now')
           AND NOT EXISTS (
             SELECT 1 FROM saas_subscriptions s
              WHERE s.user_id = u.id
                AND s.status IN ('active', 'trialing')
           )) AS active_trials,
       (SELECT COUNT(*)
          FROM auth_users_v2 u
         WHERE u.role = 'student'
           AND u.trial_expires_at IS NOT NULL
           AND julianday(u.trial_expires_at) < julianday('now')
           AND NOT EXISTS (
             SELECT 1 FROM saas_subscriptions s
              WHERE s.user_id = u.id
                AND s.status IN ('active', 'trialing')
           )) AS expired_trials,
       (SELECT COUNT(DISTINCT user_id)
          FROM saas_subscriptions
         WHERE status IN ('active', 'trialing')) AS subscribed,
       (SELECT COUNT(*)
          FROM auth_users_v2 u
         WHERE u.role = 'student'
           AND u.trial_started_at IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM invite_codes ic WHERE ic.used_by = u.id
           )) AS invited_activated,
       (SELECT COUNT(*)
          FROM auth_users_v2
         WHERE role = 'student'
           AND julianday(created_at) >= julianday('now', '-7 days')) AS last_7d_registrations,
       (SELECT COUNT(*)
          FROM auth_users_v2
         WHERE role = 'student'
           AND julianday(created_at) >= julianday('now', '-30 days')) AS last_30d_registrations`
  );

  const row = rows[0];
  return {
    generatedAt: now.toISOString(),
    registeredStudents: toCount(row?.registered_students),
    pendingActivation: toCount(row?.pending_activation),
    activatedTrials: toCount(row?.activated_trials),
    activeTrials: toCount(row?.active_trials),
    expiredTrials: toCount(row?.expired_trials),
    subscribed: toCount(row?.subscribed),
    invitedActivated: toCount(row?.invited_activated),
    last7dRegistrations: toCount(row?.last_7d_registrations),
    last30dRegistrations: toCount(row?.last_30d_registrations),
  };
}
