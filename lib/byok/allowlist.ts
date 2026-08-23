import "server-only";

import { randomUUID } from "crypto";

import { d1Batch, d1Query } from "@/lib/d1";
import { providerConnectionOwnerAllowed } from "@/lib/provider-connections/keyring";
import { getByokSpendControlPolicy } from "@/lib/byok/spend-controls";

const MICRO_USD = 1_000_000;
const TESTER_DEFAULT_DAILY_BUDGET_USD = 0.05;
const TESTER_DEFAULT_MAX_CONCURRENT_JOBS = 1;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

export const BYOK_TESTER_DEFAULT_DAILY_BUDGET_USD = TESTER_DEFAULT_DAILY_BUDGET_USD;
export const BYOK_TESTER_DEFAULT_MAX_CONCURRENT_JOBS = TESTER_DEFAULT_MAX_CONCURRENT_JOBS;

export type ByokAllowlistSource = "env" | "database" | "both";

export type ByokAllowlistEntry = Readonly<{
  ownerId: string;
  email: string;
  role: string | null;
  source: ByokAllowlistSource;
  createdBy: string | null;
  createdAt: string | null;
  dailyBudgetUsd: number | null;
  maxConcurrentJobs: number | null;
  removable: boolean;
}>;

export type ByokAllowlistErrorCode =
  | "INVALID_INPUT"
  | "USER_NOT_FOUND"
  | "USER_BANNED"
  | "ENV_PINNED"
  | "NOT_ON_ALLOWLIST"
  | "PERSISTENCE_ERROR";

export class ByokAllowlistError extends Error {
  readonly code: ByokAllowlistErrorCode;

  constructor(code: ByokAllowlistErrorCode) {
    super(code);
    this.name = "ByokAllowlistError";
    this.code = code;
  }
}

type AllowlistRow = {
  owner_id: string;
  email: string;
  created_by: string;
  created_at: string;
};

type UserRow = {
  id: string;
  email: string;
  role: string;
};

type SpendRow = {
  owner_id: string;
  daily_budget_micro_usd: number;
  max_concurrent_jobs: number;
};

const fail = (code: ByokAllowlistErrorCode): never => {
  throw new ByokAllowlistError(code);
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const usdToMicro = (value: number) => Math.round(value * MICRO_USD);
const microToUsd = (value: number) => Number((value / MICRO_USD).toFixed(6));

export const envByokAllowlistOwners = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) =>
  (environment.BYOK_PROVIDER_CONNECTIONS_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

export const isByokOwnerAllowed = async (
  ownerId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<boolean> => {
  if (!ownerId || ownerId.length > 256) return false;
  if (providerConnectionOwnerAllowed(ownerId, environment)) return true;
  try {
    const { rows } = await d1Query<{ owner_id: string }>(
      `SELECT owner_id FROM byok_allowlist WHERE owner_id = ? LIMIT 1`,
      [ownerId],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
};

const lookupUsers = async (ownerIds: readonly string[]) => {
  if (ownerIds.length === 0) return new Map<string, UserRow>();
  const placeholders = ownerIds.map(() => "?").join(", ");
  const { rows } = await d1Query<UserRow>(
    `SELECT id, email, role FROM auth_users_v2 WHERE id IN (${placeholders})`,
    [...ownerIds],
  );
  return new Map(rows.map((row) => [row.id, row]));
};

const lookupSpend = async (ownerIds: readonly string[]) => {
  if (ownerIds.length === 0) return new Map<string, SpendRow>();
  const placeholders = ownerIds.map(() => "?").join(", ");
  const { rows } = await d1Query<SpendRow>(
    `SELECT owner_id, daily_budget_micro_usd, max_concurrent_jobs
     FROM byok_spend_controls WHERE owner_id IN (${placeholders})`,
    [...ownerIds],
  );
  return new Map(rows.map((row) => [row.owner_id, row]));
};

const toEntry = (
  ownerId: string,
  source: ByokAllowlistSource,
  user: UserRow | undefined,
  stored: AllowlistRow | undefined,
  spend: SpendRow | undefined,
): ByokAllowlistEntry => ({
  ownerId,
  email: stored?.email || user?.email || ownerId,
  role: user?.role ?? null,
  source,
  createdBy: stored?.created_by ?? null,
  createdAt: stored?.created_at ?? null,
  dailyBudgetUsd: spend
    ? microToUsd(Number(spend.daily_budget_micro_usd))
    : null,
  maxConcurrentJobs: spend ? Number(spend.max_concurrent_jobs) : null,
  removable: source !== "env",
});

export const listByokAllowlist = async (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ByokAllowlistEntry[]> => {
  const envOwners = envByokAllowlistOwners(environment);
  let stored: AllowlistRow[] = [];
  try {
    const result = await d1Query<AllowlistRow>(
      `SELECT owner_id, email, created_by, created_at
       FROM byok_allowlist
       ORDER BY created_at DESC`,
    );
    stored = result.rows;
  } catch {
    stored = [];
  }

  const ownerIds = [...new Set([...envOwners, ...stored.map((row) => row.owner_id)])];
  const [users, spend] = await Promise.all([
    lookupUsers(ownerIds),
    lookupSpend(ownerIds),
  ]);
  const storedByOwner = new Map(stored.map((row) => [row.owner_id, row]));
  const envSet = new Set(envOwners);

  return ownerIds
    .map((ownerId) => {
      const inEnv = envSet.has(ownerId);
      const inDb = storedByOwner.has(ownerId);
      const source: ByokAllowlistSource = inEnv && inDb
        ? "both"
        : inEnv
          ? "env"
          : "database";
      return toEntry(
        ownerId,
        source,
        users.get(ownerId),
        storedByOwner.get(ownerId),
        spend.get(ownerId),
      );
    })
    .sort((left, right) => left.email.localeCompare(right.email));
};

const parseBudget = (value: unknown, fallback: number, max: number) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) fail("INVALID_INPUT");
  return parsed;
};

const parseConcurrency = (value: unknown, fallback: number, max: number) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) fail("INVALID_INPUT");
  return parsed;
};

export const grantByokAllowlist = async (input: Readonly<{
  actorId: string;
  email: string;
  dailyBudgetUsd?: number;
  maxConcurrentJobs?: number;
}>): Promise<ByokAllowlistEntry> => {
  if (!input.actorId || input.actorId.length > 256) fail("INVALID_INPUT");
  const email = normalizeEmail(input.email);
  if (!EMAIL_PATTERN.test(email)) fail("INVALID_INPUT");

  const policy = getByokSpendControlPolicy();
  const dailyBudgetUsd = parseBudget(
    input.dailyBudgetUsd,
    TESTER_DEFAULT_DAILY_BUDGET_USD,
    policy.maxDailyBudgetUsd,
  );
  const maxConcurrentJobs = parseConcurrency(
    input.maxConcurrentJobs,
    TESTER_DEFAULT_MAX_CONCURRENT_JOBS,
    policy.maxConcurrentJobs,
  );

  const { rows } = await d1Query<UserRow>(
    `SELECT id, email, role FROM auth_users_v2 WHERE lower(email) = ? LIMIT 1`,
    [email],
  );
  const user = rows[0];
  if (!user) fail("USER_NOT_FOUND");
  if (user.role === "banned") fail("USER_BANNED");

  const now = new Date().toISOString();
  const dailyBudgetMicroUsd = usdToMicro(dailyBudgetUsd);
  if (dailyBudgetMicroUsd < 1) fail("INVALID_INPUT");

  try {
    await d1Batch([
      {
        sql: `INSERT INTO byok_allowlist (owner_id, email, created_by, created_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(owner_id) DO UPDATE SET email = excluded.email`,
        params: [user.id, user.email, input.actorId, now],
      },
      {
        sql: `INSERT INTO byok_spend_controls
                (owner_id, daily_budget_micro_usd, max_concurrent_jobs, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(owner_id) DO NOTHING`,
        params: [user.id, dailyBudgetMicroUsd, maxConcurrentJobs, now, now],
      },
      {
        sql: `INSERT INTO byok_allowlist_audit_events
                (id, actor_id, owner_id, action, email, created_at)
              VALUES (?, ?, ?, 'grant', ?, ?)`,
        params: [randomUUID(), input.actorId, user.id, user.email, now],
      },
    ]);
  } catch (error) {
    if (error instanceof ByokAllowlistError) throw error;
    return fail("PERSISTENCE_ERROR");
  }

  const entries = await listByokAllowlist();
  return entries.find((entry) => entry.ownerId === user.id)
    ?? toEntry(
      user.id,
      providerConnectionOwnerAllowed(user.id) ? "both" : "database",
      user,
      { owner_id: user.id, email: user.email, created_by: input.actorId, created_at: now },
      {
        owner_id: user.id,
        daily_budget_micro_usd: dailyBudgetMicroUsd,
        max_concurrent_jobs: maxConcurrentJobs,
      },
    );
};

export const revokeByokAllowlist = async (input: Readonly<{
  actorId: string;
  ownerId: string;
}>): Promise<{ ownerId: string; stillAllowed: boolean }> => {
  if (!input.actorId || input.actorId.length > 256) fail("INVALID_INPUT");
  if (!input.ownerId || input.ownerId.length > 256) fail("INVALID_INPUT");

  const { rows } = await d1Query<AllowlistRow>(
    `SELECT owner_id, email, created_by, created_at
     FROM byok_allowlist WHERE owner_id = ? LIMIT 1`,
    [input.ownerId],
  );
  const stored = rows[0];
  if (!stored) {
    if (providerConnectionOwnerAllowed(input.ownerId)) fail("ENV_PINNED");
    fail("NOT_ON_ALLOWLIST");
  }

  const now = new Date().toISOString();
  try {
    await d1Batch([
      {
        sql: `DELETE FROM byok_allowlist WHERE owner_id = ?`,
        params: [input.ownerId],
      },
      {
        sql: `INSERT INTO byok_allowlist_audit_events
                (id, actor_id, owner_id, action, email, created_at)
              VALUES (?, ?, ?, 'revoke', ?, ?)`,
        params: [randomUUID(), input.actorId, input.ownerId, stored.email, now],
      },
    ]);
  } catch (error) {
    if (error instanceof ByokAllowlistError) throw error;
    return fail("PERSISTENCE_ERROR");
  }

  return {
    ownerId: input.ownerId,
    stillAllowed: providerConnectionOwnerAllowed(input.ownerId),
  };
};
