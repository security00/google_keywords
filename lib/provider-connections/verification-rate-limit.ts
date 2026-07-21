import "server-only";

import { d1Query } from "@/lib/d1";
import type { ProviderId } from "./credential-crypto";

export const PROVIDER_VERIFY_MAX_ATTEMPTS = 3;
export const PROVIDER_VERIFY_WINDOW_MS = 15 * 60 * 1000;

export type ProviderVerificationRateLimit = Readonly<{
  allowed: boolean;
  attemptCount: number;
  blockedUntil: string | null;
}>;

type RateLimitRow = {
  attempt_count: number;
  blocked_until: string | null;
};

export class ProviderVerificationRateLimitError extends Error {
  readonly code = "RATE_LIMIT_PERSISTENCE_ERROR" as const;

  constructor() {
    super("RATE_LIMIT_PERSISTENCE_ERROR");
    this.name = "ProviderVerificationRateLimitError";
  }
}

export const claimProviderVerificationAttempt = async (
  ownerId: string,
  provider: ProviderId,
  now = new Date(),
): Promise<ProviderVerificationRateLimit> => {
  const nowIso = now.toISOString();
  const windowCutoff = new Date(now.getTime() - PROVIDER_VERIFY_WINDOW_MS).toISOString();
  const newBlockedUntil = new Date(now.getTime() + PROVIDER_VERIFY_WINDOW_MS).toISOString();

  try {
    const { rows } = await d1Query<RateLimitRow>(
      `INSERT INTO provider_connection_verify_limits (
         owner_id, provider, window_started_at, attempt_count,
         blocked_until, updated_at
       ) VALUES (?, ?, ?, 1, NULL, ?)
       ON CONFLICT(owner_id, provider) DO UPDATE SET
         attempt_count = CASE
           WHEN provider_connection_verify_limits.blocked_until > excluded.updated_at
             THEN provider_connection_verify_limits.attempt_count
           WHEN provider_connection_verify_limits.window_started_at <= ? THEN 1
           ELSE provider_connection_verify_limits.attempt_count + 1
         END,
         window_started_at = CASE
           WHEN provider_connection_verify_limits.blocked_until > excluded.updated_at
             THEN provider_connection_verify_limits.window_started_at
           WHEN provider_connection_verify_limits.window_started_at <= ?
             THEN excluded.window_started_at
           ELSE provider_connection_verify_limits.window_started_at
         END,
         blocked_until = CASE
           WHEN provider_connection_verify_limits.blocked_until > excluded.updated_at
             THEN provider_connection_verify_limits.blocked_until
           WHEN provider_connection_verify_limits.window_started_at > ?
             AND provider_connection_verify_limits.attempt_count >= ?
             THEN ?
           ELSE NULL
         END,
         updated_at = excluded.updated_at
       RETURNING attempt_count, blocked_until`,
      [
        ownerId,
        provider,
        nowIso,
        nowIso,
        windowCutoff,
        windowCutoff,
        windowCutoff,
        PROVIDER_VERIFY_MAX_ATTEMPTS,
        newBlockedUntil,
      ],
    );
    const row = rows[0];
    if (!row) throw new ProviderVerificationRateLimitError();
    const blockedUntil = row.blocked_until;
    return {
      allowed: !blockedUntil || Date.parse(blockedUntil) <= now.getTime(),
      attemptCount: Number(row.attempt_count),
      blockedUntil,
    };
  } catch (error) {
    if (error instanceof ProviderVerificationRateLimitError) throw error;
    throw new ProviderVerificationRateLimitError();
  }
};
