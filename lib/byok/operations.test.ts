import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Batch, d1Query } from "@/lib/d1";
import {
  ByokReconciliationError,
  classifyByokReconciliation,
  reconcileStaleByokJob,
} from "./operations";

vi.mock("@/lib/d1", () => ({ d1Batch: vi.fn(), d1Query: vi.fn() }));

const mockD1Query = vi.mocked(d1Query);
const mockD1Batch = vi.mocked(d1Batch);
const staleJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  user_id: "owner-1",
  job_type: "trends",
  status: "processing",
  provider_request_state: "started",
  updated_at: "2026-07-21T00:00:00.000Z",
  result_cache_key: null,
  payload: "{}",
  error: null,
  pending_parent_count: 0,
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  quote_id: "quote-1", owner_id: "owner-1", capability: "compare",
  estimated_cost_usd: 0.012, research_job_id: "job-1", job_status: "complete",
  provider_request_state: "completed", event_count: 2,
  accounted_cost_usd: 0.0112, created_at: "now", ...overrides,
});

describe("BYOK operations reconciliation", () => {
  beforeEach(() => vi.clearAllMocks());

  test("classifies conservative estimates, missing evidence and uncertain checkpoints", () => {
    expect(classifyByokReconciliation(row())).toBe("under_estimate");
    expect(classifyByokReconciliation(row({ accounted_cost_usd: 0.012 }))).toBe("accounted");
    expect(classifyByokReconciliation(row({ accounted_cost_usd: 0.02 }))).toBe("over_estimate");
    expect(classifyByokReconciliation(row({ event_count: 0 }))).toBe("missing_cost_event");
    expect(classifyByokReconciliation(row({ research_job_id: null, job_status: null }))).toBe("orphan_quote");
    expect(classifyByokReconciliation(row({
      job_status: "processing", provider_request_state: "started",
    }))).toBe("provider_outcome_uncertain");
  });

  test("marks an exact stale owner job uncertain without replaying a provider", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [staleJob()] });
    mockD1Batch.mockResolvedValueOnce([
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
    ]);

    await expect(reconcileStaleByokJob({
      actorId: "admin-1",
      ownerId: "owner-1",
      jobId: "job-1",
      expectedUpdatedAt: "2026-07-21T00:00:00.000Z",
      action: "mark_uncertain",
      now: new Date("2026-07-21T00:10:00.000Z"),
    })).resolves.toEqual({
      jobId: "job-1", ownerId: "owner-1", action: "mark_uncertain", status: "failed",
    });
    expect(mockD1Query).toHaveBeenCalledTimes(1);
    expect(mockD1Batch).toHaveBeenCalledTimes(1);
    const statements = mockD1Batch.mock.calls[0]?.[0] ?? [];
    expect(statements[1]?.params).toContain("admin-1");
    expect(statements[2]?.sql).toContain("UPDATE byok_pipeline_steps");
    expect(statements[2]?.params).toContain("job-1");
    expect(statements[3]?.sql).toContain("UPDATE byok_pipeline_runs");
    expect(statements[3]?.sql).toContain("PROVIDER_OUTCOME_UNCERTAIN");
    expect(statements[4]?.sql).toContain("UPDATE byok_pipeline_quotes");
  });

  test("idempotently cascades an already uncertain child into its processing parent", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [staleJob({
      status: "failed",
      provider_request_state: "failed",
      error: "PROVIDER_OUTCOME_UNCERTAIN",
      pending_parent_count: 1,
    })] });
    mockD1Batch.mockResolvedValueOnce([
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
      { rows: [], meta: { changes: 1 } },
    ]);

    await expect(reconcileStaleByokJob({
      actorId: "admin-1",
      ownerId: "owner-1",
      jobId: "job-1",
      expectedUpdatedAt: "2026-07-21T00:00:00.000Z",
      action: "mark_uncertain",
      now: new Date("2026-07-21T00:10:00.000Z"),
    })).resolves.toMatchObject({ status: "failed" });

    const statements = mockD1Batch.mock.calls[0]?.[0] ?? [];
    expect(statements[0]?.sql).toContain("status = 'failed'");
    expect(statements[0]?.sql).toContain("EXISTS");
    expect(statements[2]?.sql).toContain("UPDATE byok_pipeline_steps");
    expect(statements[3]?.sql).toContain("UPDATE byok_pipeline_runs");
    expect(statements[4]?.sql).toContain("UPDATE byok_pipeline_quotes");
  });

  test("completes only when the expected private cache and cost evidence both exist", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [staleJob()] })
      .mockResolvedValueOnce({ rows: [{
        id: "cache-1",
        response_data: JSON.stringify({
          keyword: "ai tools", series: [{ date: "2026-07-20", value: 50 }],
          benchmarkSeries: [], cost: { estimatedCostUsd: 0.011, actualCostUsd: 0.011 },
        }),
      }] })
      .mockResolvedValueOnce({ rows: [{ event_count: 1 }] });
    mockD1Batch.mockResolvedValueOnce([
      { rows: [], meta: { changes: 1 } }, { rows: [], meta: { changes: 1 } },
    ]);

    await expect(reconcileStaleByokJob({
      actorId: "admin-1",
      ownerId: "owner-1",
      jobId: "job-1",
      expectedUpdatedAt: "2026-07-21T00:00:00.000Z",
      action: "complete_from_private_cache",
      now: new Date("2026-07-21T00:10:00.000Z"),
    })).resolves.toMatchObject({ status: "complete" });
    expect(mockD1Query.mock.calls[1]?.[1]).toEqual([
      "byok-trends:v1:job-1", "byok-trends", "owner-1", "2026-07-21T00:10:00.000Z",
    ]);
    expect(mockD1Query.mock.calls[2]?.[1]).toEqual([
      "job-1", "owner-1", "byok:job-1:dataforseo:trends:v1",
    ]);
  });

  test("refuses recovery when cost evidence is missing", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [staleJob()] })
      .mockResolvedValueOnce({ rows: [{
        id: "cache-1",
        response_data: JSON.stringify({
          keyword: "ai tools", series: [{ date: "2026-07-20", value: 50 }],
          benchmarkSeries: [], cost: { estimatedCostUsd: 0.011, actualCostUsd: null },
        }),
      }] })
      .mockResolvedValueOnce({ rows: [{ event_count: 0 }] });

    await expect(reconcileStaleByokJob({
      actorId: "admin-1",
      ownerId: "owner-1",
      jobId: "job-1",
      expectedUpdatedAt: "2026-07-21T00:00:00.000Z",
      action: "complete_from_private_cache",
      now: new Date("2026-07-21T00:10:00.000Z"),
    })).rejects.toMatchObject({ code: "COST_EVIDENCE_NOT_FOUND" } satisfies Partial<ByokReconciliationError>);
    expect(mockD1Query).toHaveBeenCalledTimes(3);
  });

  test("refuses a malformed private cache before checking cost evidence", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [staleJob()] })
      .mockResolvedValueOnce({ rows: [{ id: "cache-1", response_data: "{}" }] });

    await expect(reconcileStaleByokJob({
      actorId: "admin-1",
      ownerId: "owner-1",
      jobId: "job-1",
      expectedUpdatedAt: "2026-07-21T00:00:00.000Z",
      action: "complete_from_private_cache",
      now: new Date("2026-07-21T00:10:00.000Z"),
    })).rejects.toMatchObject({ code: "PRIVATE_CACHE_INVALID" });
    expect(mockD1Query).toHaveBeenCalledTimes(2);
    expect(mockD1Batch).not.toHaveBeenCalled();
  });
});
