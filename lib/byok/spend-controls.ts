import "server-only";

import { randomUUID } from "crypto";

import { d1Query } from "@/lib/d1";

export type ByokPaidCapability = "trends" | "serp" | "expand" | "compare";

export type ByokSpendControls = Readonly<{
  dailyBudgetUsd: number;
  maxConcurrentJobs: number;
}>;

export type ByokCostQuote = Readonly<{
  quoteId: string;
  capability: ByokPaidCapability;
  estimatedCostUsd: number;
  status: "quoted" | "reserved" | "committed" | "released";
  expiresAt: string;
  reservationExpiresAt: string | null;
}>;

export type ByokSpendControlErrorCode =
  | "INVALID_INPUT"
  | "QUOTE_CONFLICT"
  | "QUOTE_NOT_FOUND"
  | "QUOTE_EXPIRED"
  | "QUOTE_ALREADY_USED"
  | "COST_CONFIRMATION_MISMATCH"
  | "DAILY_BUDGET_EXCEEDED"
  | "CONCURRENCY_LIMIT_REACHED"
  | "PERSISTENCE_ERROR";

export class ByokSpendControlError extends Error {
  readonly code: ByokSpendControlErrorCode;

  constructor(code: ByokSpendControlErrorCode) {
    super(code);
    this.name = "ByokSpendControlError";
    this.code = code;
  }
}

type SpendControlRow = {
  daily_budget_micro_usd: number;
  max_concurrent_jobs: number;
};

type CostQuoteRow = {
  quote_id: string;
  owner_id: string;
  capability: ByokPaidCapability;
  request_hash: string;
  idempotency_key: string;
  estimated_cost_micro_usd: number;
  status: ByokCostQuote["status"];
  expires_at: string;
  reservation_expires_at: string | null;
  research_job_id: string | null;
  created_at: string;
  updated_at: string;
};

const MICRO_USD = 1_000_000;
const DEFAULT_DAILY_BUDGET_USD = 1;
const MAX_DAILY_BUDGET_USD = 10;
const DEFAULT_MAX_CONCURRENT_JOBS = 1;
const MAX_CONCURRENT_JOBS = 2;
const QUOTE_TTL_MS = 10 * 60 * 1000;
const RESERVATION_TTL_MS = 15 * 60 * 1000;
const SAFE_TOKEN = /^[A-Za-z0-9:_-]{8,160}$/;
const REQUEST_HASH = /^[a-f0-9]{64}$/;

const fail = (code: ByokSpendControlErrorCode): never => {
  throw new ByokSpendControlError(code);
};

const envNumber = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

const operatorLimits = () => ({
  defaultDailyBudgetUsd: envNumber(
    "BYOK_DEFAULT_DAILY_BUDGET_USD",
    DEFAULT_DAILY_BUDGET_USD,
    0.000001,
    MAX_DAILY_BUDGET_USD,
  ),
  maxDailyBudgetUsd: envNumber(
    "BYOK_MAX_DAILY_BUDGET_USD",
    MAX_DAILY_BUDGET_USD,
    0.000001,
    100,
  ),
  defaultMaxConcurrentJobs: Math.floor(envNumber(
    "BYOK_DEFAULT_MAX_CONCURRENT_JOBS",
    DEFAULT_MAX_CONCURRENT_JOBS,
    1,
    MAX_CONCURRENT_JOBS,
  )),
  maxConcurrentJobs: Math.floor(envNumber(
    "BYOK_MAX_CONCURRENT_JOBS",
    MAX_CONCURRENT_JOBS,
    1,
    10,
  )),
});

export const getByokSpendControlPolicy = () => {
  const limits = operatorLimits();
  return {
    maxDailyBudgetUsd: limits.maxDailyBudgetUsd,
    maxConcurrentJobs: limits.maxConcurrentJobs,
  } as const;
};

const usdToMicro = (value: number) => Math.round(value * MICRO_USD);
const microToUsd = (value: number) => Number((value / MICRO_USD).toFixed(6));

const toQuote = (row: CostQuoteRow): ByokCostQuote => ({
  quoteId: row.quote_id,
  capability: row.capability,
  estimatedCostUsd: microToUsd(Number(row.estimated_cost_micro_usd)),
  status: row.status,
  expiresAt: row.expires_at,
  reservationExpiresAt: row.reservation_expires_at,
});

const assertOwnerId = (ownerId: string) => {
  if (!ownerId || ownerId.length > 256) fail("INVALID_INPUT");
};

export const getByokSpendControls = async (
  ownerId: string,
): Promise<ByokSpendControls> => {
  assertOwnerId(ownerId);
  const limits = operatorLimits();
  try {
    const { rows } = await d1Query<SpendControlRow>(
      `SELECT daily_budget_micro_usd, max_concurrent_jobs
       FROM byok_spend_controls WHERE owner_id = ? LIMIT 1`,
      [ownerId],
    );
    const row = rows[0];
    return row
      ? {
        dailyBudgetUsd: Math.min(
          microToUsd(Number(row.daily_budget_micro_usd)),
          limits.maxDailyBudgetUsd,
        ),
        maxConcurrentJobs: Math.min(
          Number(row.max_concurrent_jobs),
          limits.maxConcurrentJobs,
        ),
      }
      : {
        dailyBudgetUsd: Math.min(
          limits.defaultDailyBudgetUsd,
          limits.maxDailyBudgetUsd,
        ),
        maxConcurrentJobs: Math.min(
          limits.defaultMaxConcurrentJobs,
          limits.maxConcurrentJobs,
        ),
      };
  } catch (error) {
    if (error instanceof ByokSpendControlError) throw error;
    return fail("PERSISTENCE_ERROR");
  }
};

export const updateByokSpendControls = async (input: Readonly<{
  ownerId: string;
  dailyBudgetUsd: number;
  maxConcurrentJobs: number;
}>): Promise<ByokSpendControls> => {
  assertOwnerId(input.ownerId);
  const limits = operatorLimits();
  if (
    !Number.isFinite(input.dailyBudgetUsd)
    || input.dailyBudgetUsd <= 0
    || input.dailyBudgetUsd > limits.maxDailyBudgetUsd
    || !Number.isInteger(input.maxConcurrentJobs)
    || input.maxConcurrentJobs < 1
    || input.maxConcurrentJobs > limits.maxConcurrentJobs
  ) {
    return fail("INVALID_INPUT");
  }
  const now = new Date().toISOString();
  const dailyBudgetMicroUsd = usdToMicro(input.dailyBudgetUsd);
  if (dailyBudgetMicroUsd < 1) return fail("INVALID_INPUT");
  try {
    await d1Query(
      `INSERT INTO byok_spend_controls
       (owner_id, daily_budget_micro_usd, max_concurrent_jobs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_id) DO UPDATE SET
         daily_budget_micro_usd = excluded.daily_budget_micro_usd,
         max_concurrent_jobs = excluded.max_concurrent_jobs,
         updated_at = excluded.updated_at`,
      [input.ownerId, dailyBudgetMicroUsd, input.maxConcurrentJobs, now, now],
    );
    return {
      dailyBudgetUsd: microToUsd(dailyBudgetMicroUsd),
      maxConcurrentJobs: input.maxConcurrentJobs,
    };
  } catch {
    return fail("PERSISTENCE_ERROR");
  }
};

export const createByokCostQuote = async (input: Readonly<{
  ownerId: string;
  capability: ByokPaidCapability;
  requestHash: string;
  idempotencyKey: string;
  estimatedCostUsd: number;
  now?: Date;
}>): Promise<ByokCostQuote> => {
  assertOwnerId(input.ownerId);
  if (
    !["trends", "serp", "expand", "compare"].includes(input.capability)
    || !REQUEST_HASH.test(input.requestHash)
    || !SAFE_TOKEN.test(input.idempotencyKey)
    || !Number.isFinite(input.estimatedCostUsd)
    || input.estimatedCostUsd <= 0
  ) {
    return fail("INVALID_INPUT");
  }
  const estimatedCostMicroUsd = usdToMicro(input.estimatedCostUsd);
  if (estimatedCostMicroUsd < 1) return fail("INVALID_INPUT");
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS).toISOString();
  const quoteId = randomUUID();
  try {
    const existing = await d1Query<CostQuoteRow>(
      `SELECT * FROM byok_cost_quotes
       WHERE owner_id = ? AND idempotency_key = ? LIMIT 1`,
      [input.ownerId, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (row) {
      if (
        row.capability !== input.capability
        || row.request_hash !== input.requestHash
        || Number(row.estimated_cost_micro_usd) !== estimatedCostMicroUsd
      ) {
        return fail("QUOTE_CONFLICT");
      }
      return toQuote(row);
    }
    const inserted = await d1Query<CostQuoteRow>(
      `INSERT INTO byok_cost_quotes
       (quote_id, owner_id, capability, request_hash, idempotency_key,
        estimated_cost_micro_usd, status, expires_at, reservation_expires_at,
        research_job_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'quoted', ?, NULL, NULL, ?, ?)
       RETURNING *`,
      [
        quoteId,
        input.ownerId,
        input.capability,
        input.requestHash,
        input.idempotencyKey,
        estimatedCostMicroUsd,
        expiresAt,
        nowIso,
        nowIso,
      ],
    );
    if (!inserted.rows[0]) return fail("PERSISTENCE_ERROR");
    return toQuote(inserted.rows[0]);
  } catch (error) {
    if (error instanceof ByokSpendControlError) throw error;
    try {
      const raced = await d1Query<CostQuoteRow>(
        `SELECT * FROM byok_cost_quotes
         WHERE owner_id = ? AND idempotency_key = ? LIMIT 1`,
        [input.ownerId, input.idempotencyKey],
      );
      const row = raced.rows[0];
      if (
        row
        && row.capability === input.capability
        && row.request_hash === input.requestHash
        && Number(row.estimated_cost_micro_usd) === estimatedCostMicroUsd
      ) {
        return toQuote(row);
      }
    } catch {
      // Fall through to the stable persistence error below.
    }
    return fail("PERSISTENCE_ERROR");
  }
};

const STALE_JOB_MS = 90 * 1000;

export const failStaleByokConcurrencySlots = async (
  ownerId: string,
  now = new Date(),
  maxAgeMs = STALE_JOB_MS,
) => {
  assertOwnerId(ownerId);
  const staleBefore = new Date(now.getTime() - maxAgeMs).toISOString();
  const nowIso = now.toISOString();
  await d1Query(
    `UPDATE research_jobs
     SET status = 'failed', error = 'WORKER_TIMEOUT', provider_request_state = 'failed',
         claim_token = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE user_id = ? AND execution_mode = 'byok' AND credential_source = 'user'
       AND status IN ('pending', 'processing') AND updated_at < ?`,
    [nowIso, ownerId, staleBefore],
  );
};

export const reserveConfirmedByokCostQuote = async (input: Readonly<{
  ownerId: string;
  quoteId: string;
  requestHash: string;
  confirmedEstimatedCostUsd: number;
  confirmation: "CONFIRM";
  now?: Date;
}>): Promise<ByokCostQuote> => {
  assertOwnerId(input.ownerId);
  if (
    !input.quoteId
    || !REQUEST_HASH.test(input.requestHash)
    || input.confirmation !== "CONFIRM"
    || !Number.isFinite(input.confirmedEstimatedCostUsd)
  ) {
    return fail("INVALID_INPUT");
  }
  const now = input.now ?? new Date();
  await failStaleByokConcurrencySlots(input.ownerId, now);
  const controls = await getByokSpendControls(input.ownerId);
  const confirmedMicroUsd = usdToMicro(input.confirmedEstimatedCostUsd);
  const nowIso = now.toISOString();
  const dayStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )).toISOString();
  const reservationExpiresAt = new Date(
    now.getTime() + RESERVATION_TTL_MS,
  ).toISOString();
  try {
    const { rows } = await d1Query<CostQuoteRow>(
      `UPDATE byok_cost_quotes
       SET status = 'reserved', reservation_expires_at = ?, updated_at = ?
       WHERE quote_id = ? AND owner_id = ? AND request_hash = ?
         AND status = 'quoted' AND expires_at > ?
         AND estimated_cost_micro_usd = ?
         AND (
           SELECT COALESCE(SUM(estimated_cost_micro_usd), 0)
           FROM byok_cost_quotes
            WHERE owner_id = ? AND updated_at >= ?
             AND (
               status = 'committed'
               OR (status = 'reserved' AND reservation_expires_at > ?)
             )
         ) + estimated_cost_micro_usd <= ?
          AND (
            SELECT COUNT(*) FROM byok_cost_quotes active_quote
            LEFT JOIN research_jobs active_job
              ON active_job.id = active_quote.research_job_id
             AND active_job.user_id = active_quote.owner_id
             AND active_job.execution_mode = 'byok'
             AND active_job.credential_source = 'user'
            WHERE active_quote.owner_id = ? AND (
              (active_quote.status = 'reserved'
                AND active_quote.reservation_expires_at > ?)
              OR (active_quote.status = 'committed'
                AND active_job.status IN ('pending', 'processing'))
            )
          ) < ?
       RETURNING *`,
      [
        reservationExpiresAt,
        nowIso,
        input.quoteId,
        input.ownerId,
        input.requestHash,
        nowIso,
        confirmedMicroUsd,
        input.ownerId,
        dayStart,
        nowIso,
        usdToMicro(controls.dailyBudgetUsd),
        input.ownerId,
        nowIso,
        controls.maxConcurrentJobs,
      ],
    );
    if (rows[0]) return toQuote(rows[0]);

    const loaded = await d1Query<CostQuoteRow>(
      `SELECT * FROM byok_cost_quotes
       WHERE quote_id = ? AND owner_id = ? LIMIT 1`,
      [input.quoteId, input.ownerId],
    );
    const quote = loaded.rows[0];
    if (!quote) return fail("QUOTE_NOT_FOUND");
    if (quote.request_hash !== input.requestHash
      || Number(quote.estimated_cost_micro_usd) !== confirmedMicroUsd) {
      return fail("COST_CONFIRMATION_MISMATCH");
    }
    if (quote.status === "reserved" && quote.reservation_expires_at
      && quote.reservation_expires_at > nowIso) {
      return toQuote(quote);
    }
    if (quote.status === "reserved") return fail("QUOTE_EXPIRED");
    if (quote.status === "committed") return toQuote(quote);
    if (quote.status !== "quoted") return fail("QUOTE_ALREADY_USED");
    if (quote.expires_at <= nowIso) return fail("QUOTE_EXPIRED");

    const usage = await d1Query<{
      spent_micro_usd: number;
      concurrent_jobs: number;
    }>(
      `SELECT
         (SELECT COALESCE(SUM(estimated_cost_micro_usd), 0)
          FROM byok_cost_quotes
          WHERE owner_id = ? AND updated_at >= ? AND (
            status = 'committed' OR (status = 'reserved' AND reservation_expires_at > ?)
          )) AS spent_micro_usd,
         (SELECT COUNT(*) FROM byok_cost_quotes active_quote
          LEFT JOIN research_jobs active_job
            ON active_job.id = active_quote.research_job_id
           AND active_job.user_id = active_quote.owner_id
           AND active_job.execution_mode = 'byok'
           AND active_job.credential_source = 'user'
          WHERE active_quote.owner_id = ? AND (
            (active_quote.status = 'reserved' AND active_quote.reservation_expires_at > ?)
            OR (active_quote.status = 'committed'
              AND active_job.status IN ('pending', 'processing'))
          )) AS concurrent_jobs`,
      [input.ownerId, dayStart, nowIso, input.ownerId, nowIso],
    );
    const current = usage.rows[0] ?? { spent_micro_usd: 0, concurrent_jobs: 0 };
    if (Number(current.concurrent_jobs) >= controls.maxConcurrentJobs) {
      return fail("CONCURRENCY_LIMIT_REACHED");
    }
    if (Number(current.spent_micro_usd) + confirmedMicroUsd
      > usdToMicro(controls.dailyBudgetUsd)) {
      return fail("DAILY_BUDGET_EXCEEDED");
    }
    return fail("PERSISTENCE_ERROR");
  } catch (error) {
    if (error instanceof ByokSpendControlError) throw error;
    return fail("PERSISTENCE_ERROR");
  }
};

export const commitByokCostReservation = async (input: Readonly<{
  ownerId: string;
  quoteId: string;
  researchJobId: string;
}>): Promise<boolean> => {
  if (!input.ownerId || !input.quoteId || !input.researchJobId) {
    return fail("INVALID_INPUT");
  }
  try {
    const nowIso = new Date().toISOString();
    const { meta } = await d1Query(
      `UPDATE byok_cost_quotes
       SET status = 'committed', research_job_id = ?, updated_at = ?
       WHERE quote_id = ? AND owner_id = ?
          AND (
            (status = 'reserved' AND reservation_expires_at > ?)
            OR (status = 'committed' AND research_job_id = ?)
          )`,
      [
        input.researchJobId,
        nowIso,
        input.quoteId,
        input.ownerId,
        nowIso,
        input.researchJobId,
      ],
    );
    return (meta?.changes ?? 0) === 1;
  } catch {
    return fail("PERSISTENCE_ERROR");
  }
};

export const releaseByokCostReservation = async (input: Readonly<{
  ownerId: string;
  quoteId: string;
}>): Promise<boolean> => {
  if (!input.ownerId || !input.quoteId) return fail("INVALID_INPUT");
  try {
    const { meta } = await d1Query(
      `UPDATE byok_cost_quotes
       SET status = 'released', reservation_expires_at = NULL, updated_at = ?
       WHERE quote_id = ? AND owner_id = ? AND status IN ('quoted', 'reserved')`,
      [new Date().toISOString(), input.quoteId, input.ownerId],
    );
    return (meta?.changes ?? 0) === 1;
  } catch {
    return fail("PERSISTENCE_ERROR");
  }
};
