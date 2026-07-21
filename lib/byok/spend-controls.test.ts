import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import {
  ByokSpendControlError,
  commitByokCostReservation,
  createByokCostQuote,
  getByokSpendControls,
  reserveConfirmedByokCostQuote,
  updateByokSpendControls,
} from "./spend-controls";

vi.mock("@/lib/d1", () => ({ d1Query: vi.fn() }));

const mockQuery = vi.mocked(d1Query);
const now = new Date("2026-07-21T08:00:00.000Z");
const requestHash = "a".repeat(64);

const quoteRow = {
  quote_id: "quote-1",
  owner_id: "owner-1",
  capability: "trends" as const,
  request_hash: requestHash,
  idempotency_key: "trends:request-1",
  estimated_cost_micro_usd: 1000,
  status: "quoted" as const,
  expires_at: "2026-07-21T08:10:00.000Z",
  reservation_expires_at: null,
  research_job_id: null,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
};

const result = <T,>(rows: T[] = [], changes = 0) => ({
  rows,
  meta: { changes },
});

const expectCode = (code: string) => (error: unknown) => {
  expect(error).toBeInstanceOf(ByokSpendControlError);
  expect((error as ByokSpendControlError).code).toBe(code);
  return true;
};

describe("BYOK spend controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BYOK_DEFAULT_DAILY_BUDGET_USD", "1");
    vi.stubEnv("BYOK_MAX_DAILY_BUDGET_USD", "10");
    vi.stubEnv("BYOK_DEFAULT_MAX_CONCURRENT_JOBS", "1");
    vi.stubEnv("BYOK_MAX_CONCURRENT_JOBS", "2");
  });

  afterEach(() => vi.unstubAllEnvs());

  test("returns conservative defaults and clamps stored controls to operator caps", async () => {
    mockQuery.mockResolvedValueOnce(result());
    await expect(getByokSpendControls("owner-1")).resolves.toEqual({
      dailyBudgetUsd: 1,
      maxConcurrentJobs: 1,
    });

    mockQuery.mockResolvedValueOnce(result([{
      daily_budget_micro_usd: 50_000_000,
      max_concurrent_jobs: 8,
    }]));
    await expect(getByokSpendControls("owner-1")).resolves.toEqual({
      dailyBudgetUsd: 10,
      maxConcurrentJobs: 2,
    });
  });

  test("rejects owner settings above the operator ceiling", async () => {
    await expect(updateByokSpendControls({
      ownerId: "owner-1",
      dailyBudgetUsd: 11,
      maxConcurrentJobs: 1,
    })).rejects.toSatisfy(expectCode("INVALID_INPUT"));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("creates a short-lived server quote using integer micro-USD", async () => {
    mockQuery
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result([quoteRow], 1));

    const quote = await createByokCostQuote({
      ownerId: "owner-1",
      capability: "trends",
      requestHash,
      idempotencyKey: "trends:request-1",
      estimatedCostUsd: 0.001,
      now,
    });

    expect(quote).toMatchObject({
      quoteId: "quote-1",
      estimatedCostUsd: 0.001,
      status: "quoted",
    });
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain("estimated_cost_micro_usd");
    expect(insertCall[1]).toContain(1000);
  });

  test("makes quote idempotency fail closed when request or cost changes", async () => {
    mockQuery.mockResolvedValueOnce(result([quoteRow]));

    await expect(createByokCostQuote({
      ownerId: "owner-1",
      capability: "serp",
      requestHash,
      idempotencyKey: "trends:request-1",
      estimatedCostUsd: 0.001,
      now,
    })).rejects.toSatisfy(expectCode("QUOTE_CONFLICT"));
  });

  test("atomically reserves only an exact, explicitly confirmed quote", async () => {
    mockQuery
      .mockResolvedValueOnce(result([{
        daily_budget_micro_usd: 1_000_000,
        max_concurrent_jobs: 1,
      }]))
      .mockResolvedValueOnce(result([{
        ...quoteRow,
        status: "reserved" as const,
        reservation_expires_at: "2026-07-21T08:15:00.000Z",
      }], 1));

    const reserved = await reserveConfirmedByokCostQuote({
      ownerId: "owner-1",
      quoteId: "quote-1",
      requestHash,
      confirmedEstimatedCostUsd: 0.001,
      confirmation: "CONFIRM",
      now,
    });

    expect(reserved.status).toBe("reserved");
    expect(mockQuery.mock.calls[1][0]).toContain("status = 'quoted'");
    expect(mockQuery.mock.calls[1][0]).toContain("status = 'committed'");
    expect(mockQuery.mock.calls[1][0]).toContain("updated_at >= ?");
    expect(mockQuery.mock.calls[1][0]).not.toContain("created_at >= ?");
    expect(mockQuery.mock.calls[1][0]).toContain("LEFT JOIN research_jobs active_job");
    expect(mockQuery.mock.calls[1][0]).toContain("active_job.status IN ('pending', 'processing')");
  });

  test("returns an existing exact reservation instead of reserving or charging twice", async () => {
    mockQuery
      .mockResolvedValueOnce(result([{
        daily_budget_micro_usd: 1_000_000,
        max_concurrent_jobs: 1,
      }]))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result([{
        ...quoteRow,
        status: "reserved" as const,
        reservation_expires_at: "2026-07-21T08:15:00.000Z",
      }]));

    const existing = await reserveConfirmedByokCostQuote({
      ownerId: "owner-1",
      quoteId: "quote-1",
      requestHash,
      confirmedEstimatedCostUsd: 0.001,
      confirmation: "CONFIRM",
      now,
    });

    expect(existing.status).toBe("reserved");
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  test("rejects an expired reservation instead of reviving it", async () => {
    mockQuery
      .mockResolvedValueOnce(result([{
        daily_budget_micro_usd: 1_000_000,
        max_concurrent_jobs: 1,
      }]))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result([{
        ...quoteRow,
        status: "reserved" as const,
        reservation_expires_at: "2026-07-21T07:59:59.000Z",
      }]));

    await expect(reserveConfirmedByokCostQuote({
      ownerId: "owner-1",
      quoteId: "quote-1",
      requestHash,
      confirmedEstimatedCostUsd: 0.001,
      confirmation: "CONFIRM",
      now,
    })).rejects.toSatisfy(expectCode("QUOTE_EXPIRED"));
  });

  test("commits only a live reservation or an idempotent matching commit", async () => {
    mockQuery.mockResolvedValueOnce(result([], 1));
    await expect(commitByokCostReservation({
      ownerId: "owner-1", quoteId: "quote-1", researchJobId: "job-1",
    })).resolves.toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("reservation_expires_at > ?");
    expect(sql).toContain("status = 'committed' AND research_job_id = ?");
    expect(params?.[4]).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
  });

  test("distinguishes concurrency and daily-budget denials after an atomic miss", async () => {
    mockQuery
      .mockResolvedValueOnce(result([{
        daily_budget_micro_usd: 1_000_000,
        max_concurrent_jobs: 1,
      }]))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result([quoteRow]))
      .mockResolvedValueOnce(result([{
        spent_micro_usd: 10_000,
        concurrent_jobs: 1,
      }]));

    await expect(reserveConfirmedByokCostQuote({
      ownerId: "owner-1",
      quoteId: "quote-1",
      requestHash,
      confirmedEstimatedCostUsd: 0.001,
      confirmation: "CONFIRM",
      now,
    })).rejects.toSatisfy(expectCode("CONCURRENCY_LIMIT_REACHED"));
    expect(mockQuery.mock.calls[3][0]).toContain("updated_at >= ?");
    expect(mockQuery.mock.calls[3][0]).toContain("LEFT JOIN research_jobs active_job");

    vi.clearAllMocks();
    mockQuery
      .mockResolvedValueOnce(result([{
        daily_budget_micro_usd: 1000,
        max_concurrent_jobs: 2,
      }]))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result([quoteRow]))
      .mockResolvedValueOnce(result([{
        spent_micro_usd: 1000,
        concurrent_jobs: 0,
      }]));

    await expect(reserveConfirmedByokCostQuote({
      ownerId: "owner-1",
      quoteId: "quote-1",
      requestHash,
      confirmedEstimatedCostUsd: 0.001,
      confirmation: "CONFIRM",
      now,
    })).rejects.toSatisfy(expectCode("DAILY_BUDGET_EXCEEDED"));
  });
});
