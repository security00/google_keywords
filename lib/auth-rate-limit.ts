import "server-only";

import { createHash } from "crypto";
import { NextResponse } from "next/server";

import { d1Query } from "@/lib/d1";

export type AuthRateLimitScope =
  | "sign_in"
  | "sign_up"
  | "forgot_password"
  | "reset_password";

export type AuthRateLimitDimension = "ip" | "email";

export const AUTH_RATE_LIMIT_MESSAGE = "尝试次数过多，请稍后再试";

const WINDOW_MS = 15 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

const POLICY: Record<
  AuthRateLimitScope,
  Partial<Record<AuthRateLimitDimension, number>>
> = {
  sign_in: { ip: 10, email: 5 },
  sign_up: { ip: 5, email: 5 },
  forgot_password: { ip: 5, email: 3 },
  reset_password: { ip: 10 },
};

type RateLimitRow = {
  attempt_count: number;
  blocked_until: string | null;
};

export class AuthRateLimitPersistenceError extends Error {
  readonly code = "AUTH_RATE_LIMIT_PERSISTENCE_ERROR" as const;

  constructor() {
    super("AUTH_RATE_LIMIT_PERSISTENCE_ERROR");
    this.name = "AuthRateLimitPersistenceError";
  }
}

export const getClientIp = (request: Request): string => {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
};

export const normalizeAuthEmail = (email: string): string => email.trim().toLowerCase();

export const hashAuthRateLimitKey = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const authRateLimitedResponse = (): NextResponse =>
  NextResponse.json({ error: AUTH_RATE_LIMIT_MESSAGE }, { status: 429 });

const persistenceFailureResponse = (): NextResponse =>
  NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 });

const dimensionsFor = (
  scope: AuthRateLimitScope,
  request: Request,
  email?: string
): Array<{ dimension: AuthRateLimitDimension; key: string; maxAttempts: number }> => {
  const configured = POLICY[scope];
  const dimensions: Array<{
    dimension: AuthRateLimitDimension;
    key: string;
    maxAttempts: number;
  }> = [];

  if (configured.ip) {
    dimensions.push({
      dimension: "ip",
      key: getClientIp(request),
      maxAttempts: configured.ip,
    });
  }

  const normalizedEmail = email ? normalizeAuthEmail(email) : "";
  if (configured.email && normalizedEmail) {
    dimensions.push({
      dimension: "email",
      key: normalizedEmail,
      maxAttempts: configured.email,
    });
  }

  return dimensions;
};

const isBlocked = (blockedUntil: string | null | undefined, now: Date): boolean =>
  Boolean(blockedUntil && Date.parse(blockedUntil) > now.getTime());

const peekDimension = async (
  scope: AuthRateLimitScope,
  dimension: AuthRateLimitDimension,
  keyHash: string,
  now: Date
): Promise<boolean> => {
  const { rows } = await d1Query<RateLimitRow>(
    `SELECT attempt_count, blocked_until
     FROM auth_attempt_limits
     WHERE scope = ? AND dimension = ? AND key_hash = ?
     LIMIT 1`,
    [scope, dimension, keyHash]
  );
  return !isBlocked(rows[0]?.blocked_until, now);
};

const claimDimension = async (
  scope: AuthRateLimitScope,
  dimension: AuthRateLimitDimension,
  keyHash: string,
  maxAttempts: number,
  now: Date
): Promise<boolean> => {
  const nowIso = now.toISOString();
  const windowCutoff = new Date(now.getTime() - WINDOW_MS).toISOString();
  const blockedUntil = new Date(now.getTime() + WINDOW_MS).toISOString();
  const retentionCutoff = new Date(now.getTime() - RETENTION_MS).toISOString();

  await d1Query(`DELETE FROM auth_attempt_limits WHERE updated_at < ?`, [
    retentionCutoff,
  ]);

  const { rows } = await d1Query<RateLimitRow>(
    `INSERT INTO auth_attempt_limits (
       scope, dimension, key_hash, window_started_at, attempt_count,
       blocked_until, updated_at
     ) VALUES (?, ?, ?, ?, 1, NULL, ?)
     ON CONFLICT(scope, dimension, key_hash) DO UPDATE SET
       attempt_count = CASE
         WHEN auth_attempt_limits.blocked_until > excluded.updated_at
           THEN auth_attempt_limits.attempt_count
         WHEN auth_attempt_limits.window_started_at <= ? THEN 1
         ELSE auth_attempt_limits.attempt_count + 1
       END,
       window_started_at = CASE
         WHEN auth_attempt_limits.blocked_until > excluded.updated_at
           THEN auth_attempt_limits.window_started_at
         WHEN auth_attempt_limits.window_started_at <= ?
           THEN excluded.window_started_at
         ELSE auth_attempt_limits.window_started_at
       END,
       blocked_until = CASE
         WHEN auth_attempt_limits.blocked_until > excluded.updated_at
           THEN auth_attempt_limits.blocked_until
         WHEN auth_attempt_limits.window_started_at > ?
           AND auth_attempt_limits.attempt_count >= ?
           THEN ?
         ELSE NULL
       END,
       updated_at = excluded.updated_at
     RETURNING attempt_count, blocked_until`,
    [
      scope,
      dimension,
      keyHash,
      nowIso,
      nowIso,
      windowCutoff,
      windowCutoff,
      windowCutoff,
      maxAttempts,
      blockedUntil,
    ]
  );

  const row = rows[0];
  if (!row) throw new AuthRateLimitPersistenceError();
  return !isBlocked(row.blocked_until, now);
};

const runDimensions = async (
  scope: AuthRateLimitScope,
  request: Request,
  email: string | undefined,
  mode: "peek" | "claim",
  now: Date
): Promise<boolean> => {
  try {
    let allowed = true;
    for (const item of dimensionsFor(scope, request, email)) {
      const keyHash = hashAuthRateLimitKey(`${scope}:${item.dimension}:${item.key}`);
      const dimensionAllowed =
        mode === "peek"
          ? await peekDimension(scope, item.dimension, keyHash, now)
          : await claimDimension(
              scope,
              item.dimension,
              keyHash,
              item.maxAttempts,
              now
            );
      if (!dimensionAllowed) {
        allowed = false;
        if (mode === "peek") return false;
      }
    }
    return allowed;
  } catch (error) {
    if (error instanceof AuthRateLimitPersistenceError) throw error;
    throw new AuthRateLimitPersistenceError();
  }
};

export const peekAuthRateLimit = async (input: {
  scope: AuthRateLimitScope;
  request: Request;
  email?: string;
  now?: Date;
}): Promise<boolean> =>
  runDimensions(input.scope, input.request, input.email, "peek", input.now ?? new Date());

export const consumeAuthRateLimit = async (input: {
  scope: AuthRateLimitScope;
  request: Request;
  email?: string;
  now?: Date;
}): Promise<boolean> =>
  runDimensions(input.scope, input.request, input.email, "claim", input.now ?? new Date());

export const recordAuthRateLimitFailure = async (input: {
  scope: AuthRateLimitScope;
  request: Request;
  email?: string;
  now?: Date;
}): Promise<void> => {
  await consumeAuthRateLimit(input);
};

const toLimitResponse = async (
  work: () => Promise<boolean>
): Promise<NextResponse | null> => {
  try {
    return (await work()) ? null : authRateLimitedResponse();
  } catch {
    return persistenceFailureResponse();
  }
};

export const rejectIfAuthRateLimited = async (input: {
  scope: AuthRateLimitScope;
  request: Request;
  email?: string;
  mode?: "peek" | "claim";
  now?: Date;
}): Promise<NextResponse | null> => {
  const mode = input.mode ?? "claim";
  return toLimitResponse(() =>
    mode === "peek" ? peekAuthRateLimit(input) : consumeAuthRateLimit(input)
  );
};
