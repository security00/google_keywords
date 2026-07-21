import "server-only";

import { NextResponse } from "next/server";

import { ByokSpendControlError } from "./spend-controls";

export type UpdateByokSpendControlsBody = Readonly<{
  dailyBudgetUsd: number;
  maxConcurrentJobs: number;
}>;

export class ByokSpendApiError extends Error {
  readonly code = "INVALID_REQUEST" as const;

  constructor() {
    super("INVALID_REQUEST");
    this.name = "ByokSpendApiError";
  }
}

export const parseUpdateByokSpendControlsBody = (
  body: Record<string, unknown>,
): UpdateByokSpendControlsBody => {
  const keys = Object.keys(body);
  if (
    keys.length !== 2
    || !keys.includes("dailyBudgetUsd")
    || !keys.includes("maxConcurrentJobs")
    || typeof body.dailyBudgetUsd !== "number"
    || !Number.isFinite(body.dailyBudgetUsd)
    || !Number.isInteger(body.maxConcurrentJobs)
  ) {
    throw new ByokSpendApiError();
  }
  return {
    dailyBudgetUsd: body.dailyBudgetUsd,
    maxConcurrentJobs: Number(body.maxConcurrentJobs),
  };
};

export const byokSpendErrorResponse = (error: unknown) => {
  let status = 500;
  let code = "INTERNAL_ERROR";
  if (error instanceof ByokSpendApiError) {
    status = 400;
    code = error.code;
  } else if (error instanceof ByokSpendControlError) {
    code = error.code;
    const statusByCode: Record<ByokSpendControlError["code"], number> = {
      INVALID_INPUT: 400,
      QUOTE_CONFLICT: 409,
      QUOTE_NOT_FOUND: 404,
      QUOTE_EXPIRED: 409,
      QUOTE_ALREADY_USED: 409,
      COST_CONFIRMATION_MISMATCH: 409,
      DAILY_BUDGET_EXCEEDED: 409,
      CONCURRENCY_LIMIT_REACHED: 409,
      PERSISTENCE_ERROR: 503,
    };
    status = statusByCode[error.code];
  }
  const response = NextResponse.json(
    { error: "BYOK spend control request failed", code },
    { status },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
};
