import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Batch, d1Query } from "@/lib/d1";
import { quoteByokCompare, quoteByokCompareIntentRetry } from "@/lib/byok/compare";
import { loadPipelineConnections } from "@/lib/byok/pipeline-access";
import { getByokSpendControls } from "@/lib/byok/spend-controls";
import { quotePipelineCompare, quotePipelineRetry, startPipelineExecution } from "./pipeline";

vi.mock("@/lib/d1", () => ({ d1Batch: vi.fn(), d1Query: vi.fn() }));
vi.mock("@/lib/byok/pipeline-access", () => ({ loadPipelineConnections: vi.fn() }));
vi.mock("@/lib/byok/spend-controls", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/byok/spend-controls")>(),
  getByokSpendControls: vi.fn(),
}));
vi.mock("@/lib/byok/compare", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/byok/compare")>(),
  quoteByokCompare: vi.fn(),
  quoteByokCompareIntentRetry: vi.fn(),
  executeByokCompare: vi.fn(),
}));
vi.mock("@/lib/byok/expand", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/byok/expand")>(),
  quoteByokExpand: vi.fn(),
  executeByokExpand: vi.fn(),
}));
vi.mock("@/lib/byok/semantic-filter", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/byok/semantic-filter")>(),
  executeByokSemanticFilter: vi.fn(),
}));

const mockD1 = vi.mocked(d1Query);
const mockD1Batch = vi.mocked(d1Batch);
const mockConnections = vi.mocked(loadPipelineConnections);
const mockQuoteCompare = vi.mocked(quoteByokCompare);
const mockQuoteIntent = vi.mocked(quoteByokCompareIntentRetry);
const mockSpendControls = vi.mocked(getByokSpendControls);

describe("BYOK batch pipeline quoting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockD1Batch.mockResolvedValue([]);
    mockSpendControls.mockResolvedValue({ dailyBudgetUsd: 1, maxConcurrentJobs: 1 });
    mockConnections.mockResolvedValue({
      dataforseo: { connectionId: "dfs-1", credentialVersion: 2 },
      openrouter: { connectionId: "or-1", credentialVersion: 3 },
    } as never);
    mockQuoteCompare.mockImplementation(async (input) => ({
      quote: {
        quoteId: `quote-${input.clientRequestId}`,
        capability: "compare",
        estimatedCostUsd: 0.012,
        status: "quoted",
        expiresAt: "2026-08-02T01:00:00.000Z",
        reservationExpiresAt: null,
      },
      request: {
        keywords: input.keywords,
        benchmark: input.benchmark ?? "gpts",
        dateFrom: "2026-05-01",
        dateTo: "2026-08-01",
      },
      requestHash: String(input.clientRequestId).padEnd(64, "a").slice(0, 64),
    }));
    mockQuoteIntent.mockImplementation(async (input) => ({
      quote: {
        quoteId: `intent-${input.clientRequestId}`,
        capability: "compare",
        estimatedCostUsd: 0.001,
        status: "quoted",
        expiresAt: "2026-08-02T01:00:00.000Z",
        reservationExpiresAt: null,
      },
      request: { baseJobId: input.baseJobId, retryToken: input.clientRequestId },
      requestHash: String(input.clientRequestId).padEnd(64, "b").slice(0, 64),
    }));
    let inserted: unknown[] = [];
    mockD1.mockImplementation(async (sql, params = []) => {
      if (String(sql).includes("INSERT OR IGNORE INTO byok_pipeline_quotes")) {
        inserted = params;
        return { rows: [] };
      }
      if (String(sql).includes("SELECT * FROM byok_pipeline_quotes")) {
        return { rows: [{
          quote_id: inserted[0], owner_id: inserted[1], operation: inserted[2],
          request_hash: inserted[3], idempotency_key: inserted[4],
          request_json: inserted[5], child_quotes_json: inserted[6],
          estimated_cost_micro_usd: inserted[7], status: "quoted",
          expires_at: inserted[8], parent_job_id: null,
          retry_of_job_id: inserted[9], created_at: inserted[10], updated_at: inserted[11],
        }] };
      }
      return { rows: [] };
    });
  });

  test("chunks fifty keywords into bounded four-keyword Provider calls and one aggregate quote", async () => {
    const keywords = Array.from({ length: 50 }, (_, index) => `keyword ${index + 1}`);

    const quote = await quotePipelineCompare("owner-1", "compare-batch-001", {
      keywords,
      benchmark: "gpts",
      days: 90,
    });

    expect(mockQuoteCompare).toHaveBeenCalledTimes(13);
    expect(mockQuoteCompare.mock.calls.every(([input]) => input.keywords.length <= 4)).toBe(true);
    expect(quote).toMatchObject({ operation: "compare", batchCount: 13, estimatedCostUsd: 0.156 });
  });

  test("rejects more than fifty comparison keywords before creating child quotes", async () => {
    await expect(quotePipelineCompare("owner-1", "compare-batch-002", {
      keywords: Array.from({ length: 51 }, (_, index) => `keyword ${index + 1}`),
      benchmark: "gpts",
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(mockQuoteCompare).not.toHaveBeenCalled();
  });

  test("atomically binds an execute idempotency key to the parent job", async () => {
    let parentJobId: string | null = null;
    const quoteRow = {
      quote_id: "aggregate-quote", owner_id: "owner-1", operation: "compare",
      request_hash: "r".repeat(64), idempotency_key: "quote-key-001",
      request_json: JSON.stringify({ keywords: ["alpha"], benchmark: "gpts", days: 90 }),
      child_quotes_json: JSON.stringify([{ kind: "compare", index: 0, quoteId: "child-1" }]),
      estimated_cost_micro_usd: 12000, status: "quoted",
      expires_at: "2099-01-01T00:00:00.000Z", parent_job_id: null,
      created_at: "2026-08-02T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z",
    };
    mockD1Batch.mockImplementation(async (statements) => {
      parentJobId = String(statements[0].params?.[0]);
      expect(statements[1].sql).toContain("INSERT INTO byok_pipeline_runs");
      expect(statements[1].sql).toContain("parent_job_id = ?");
      return [];
    });
    mockD1.mockImplementation(async (sql) => {
      const statement = String(sql);
      if (statement.includes("execute_idempotency_key")) return { rows: [] };
      if (statement.includes("FROM byok_cost_quotes")) return { rows: [{ spent: 0, active: 0 }] };
      if (statement.includes("FROM byok_pipeline_quotes")) {
        return { rows: [{ ...quoteRow, parent_job_id: parentJobId }] };
      }
      if (statement.includes("FROM byok_pipeline_runs")) {
        return { rows: [{
          job_id: parentJobId, owner_id: "owner-1", operation: "compare",
          quote_id: quoteRow.quote_id, request_hash: quoteRow.request_hash,
          execute_idempotency_key: "execute-key-001", execute_request_hash: "x",
          status: "processing", total_steps: 1, completed_steps: 0,
          result_cache_key: null, error_code: null,
          created_at: quoteRow.created_at, updated_at: quoteRow.updated_at,
        }] };
      }
      return { rows: [] };
    });

    const job = await startPipelineExecution({
      ownerId: "owner-1", operation: "compare", quoteId: quoteRow.quote_id,
      requestHash: quoteRow.request_hash, confirmedEstimatedCostUsd: 0.012,
      executeIdempotencyKey: "execute-key-001",
    });

    expect(parentJobId).toBeTruthy();
    expect(job).toMatchObject({ jobId: parentJobId, status: "processing" });
    expect(mockD1Batch).toHaveBeenCalledTimes(1);
  });

  test("re-quotes only the failed compare batch and marks successful batches non-chargeable", async () => {
    const sourceChildren = [0, 1].map((index) => ({
      kind: "compare", index, quoteId: `source-${index}`,
      request: {
        keywords: [`keyword ${index}`], benchmark: "gpts",
        dateFrom: "2026-05-01", dateTo: "2026-08-01",
      },
      requestHash: String(index).repeat(64), estimatedCostUsd: 0.012,
    }));
    const sourceQuote = {
      quote_id: "source-quote", owner_id: "owner-1", operation: "compare",
      request_hash: "a".repeat(64), idempotency_key: "source-key-001",
      request_json: JSON.stringify({ keywords: ["keyword 0", "keyword 1"], benchmark: "gpts", days: 90 }),
      child_quotes_json: JSON.stringify(sourceChildren), estimated_cost_micro_usd: 24000,
      status: "partial", expires_at: "2099-01-01T00:00:00.000Z",
      parent_job_id: "parent-1", retry_of_job_id: null,
      created_at: "2026-08-02T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z",
    };
    let inserted: unknown[] = [];
    mockD1.mockImplementation(async (sql, params = []) => {
      const statement = String(sql);
      if (statement.includes("FROM byok_pipeline_runs") && statement.includes("job_id = ?")) {
        return { rows: [{
          job_id: "parent-1", owner_id: "owner-1", operation: "compare",
          quote_id: "source-quote", request_hash: sourceQuote.request_hash,
          status: "partial", total_steps: 2, completed_steps: 2,
          result_cache_key: "private-result", error_code: "PARTIAL_SUCCESS",
          created_at: sourceQuote.created_at, updated_at: sourceQuote.updated_at,
        }] };
      }
      if (statement.includes("FROM byok_pipeline_steps")) {
        return { rows: [
          {
            parent_job_id: "parent-1", step_key: "compare:0", stage: "compare",
            status: "complete", child_job_id: "completed-child-0", error_code: null,
          },
          {
            parent_job_id: "parent-1", step_key: "compare:1", stage: "compare",
            status: "failed", child_job_id: null, error_code: "PROVIDER_FAILED",
          },
        ] };
      }
      if (statement.includes("WHERE quote_id = ?") && statement.includes("owner_id = ?")) {
        return { rows: [sourceQuote] };
      }
      if (statement.includes("INSERT OR IGNORE INTO byok_pipeline_quotes")) {
        inserted = params;
        return { rows: [] };
      }
      if (statement.includes("WHERE owner_id = ? AND operation = ? AND idempotency_key = ?")) {
        return { rows: [{
          ...sourceQuote,
          quote_id: inserted[0], request_hash: inserted[3], idempotency_key: inserted[4],
          request_json: inserted[5], child_quotes_json: inserted[6],
          estimated_cost_micro_usd: inserted[7], status: "quoted", expires_at: inserted[8],
          parent_job_id: null, retry_of_job_id: inserted[9],
          created_at: inserted[10], updated_at: inserted[11],
        }] };
      }
      return { rows: [] };
    });

    const quote = await quotePipelineRetry("owner-1", "parent-1", "retry-compare-001");

    expect(mockQuoteCompare).toHaveBeenCalledTimes(1);
    expect(mockQuoteCompare.mock.calls[0][0]).toMatchObject({ keywords: ["keyword 1"] });
    expect(mockQuoteCompare.mock.calls[0][0].retryAttempt).toMatch(/^retry-/);
    const savedChildren = JSON.parse(String(inserted[6]));
    expect(savedChildren[0]).toMatchObject({
      quoteId: "source-0", chargeable: false, checkpointJobId: "completed-child-0",
    });
    expect(savedChildren[1]).toMatchObject({ chargeable: true });
    expect(quote).toMatchObject({ estimatedCostUsd: 0.012, batchCount: 1 });
  });

  test("re-quotes only OpenRouter intent when DataForSEO compare data already succeeded", async () => {
    const sourceChild = {
      kind: "compare", index: 0, quoteId: "source-0",
      request: {
        keywords: ["keyword 0"], benchmark: "gpts",
        dateFrom: "2026-05-01", dateTo: "2026-08-01",
      },
      requestHash: "c".repeat(64), estimatedCostUsd: 0.012,
    };
    const sourceQuote = {
      quote_id: "source-partial", owner_id: "owner-1", operation: "compare",
      request_hash: "d".repeat(64), idempotency_key: "source-key-002",
      request_json: JSON.stringify({ keywords: ["keyword 0"], benchmark: "gpts", days: 90 }),
      child_quotes_json: JSON.stringify([sourceChild]), estimated_cost_micro_usd: 12000,
      status: "partial", expires_at: "2099-01-01T00:00:00.000Z",
      parent_job_id: "parent-partial", retry_of_job_id: null,
      created_at: "2026-08-02T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z",
    };
    let inserted: unknown[] = [];
    mockD1.mockImplementation(async (sql, params = []) => {
      const statement = String(sql);
      if (statement.includes("FROM byok_pipeline_runs") && statement.includes("job_id = ?")) {
        return { rows: [{
          job_id: "parent-partial", owner_id: "owner-1", operation: "compare",
          quote_id: sourceQuote.quote_id, request_hash: sourceQuote.request_hash,
          status: "partial", total_steps: 1, completed_steps: 1,
          result_cache_key: "private-result", error_code: "PARTIAL_SUCCESS",
          created_at: sourceQuote.created_at, updated_at: sourceQuote.updated_at,
        }] };
      }
      if (statement.includes("FROM byok_pipeline_steps")) {
        return { rows: [{
          parent_job_id: "parent-partial", step_key: "compare:0", stage: "compare",
          status: "failed", child_job_id: "partial-child-0", error_code: "PARTIAL_INTENT",
        }] };
      }
      if (statement.includes("WHERE quote_id = ?") && statement.includes("owner_id = ?")) {
        return { rows: [sourceQuote] };
      }
      if (statement.includes("INSERT OR IGNORE INTO byok_pipeline_quotes")) {
        inserted = params;
        return { rows: [] };
      }
      if (statement.includes("WHERE owner_id = ? AND operation = ? AND idempotency_key = ?")) {
        return { rows: [{
          ...sourceQuote,
          quote_id: inserted[0], request_hash: inserted[3], idempotency_key: inserted[4],
          request_json: inserted[5], child_quotes_json: inserted[6],
          estimated_cost_micro_usd: inserted[7], status: "quoted", expires_at: inserted[8],
          parent_job_id: null, retry_of_job_id: inserted[9],
          created_at: inserted[10], updated_at: inserted[11],
        }] };
      }
      return { rows: [] };
    });

    const quote = await quotePipelineRetry("owner-1", "parent-partial", "retry-intent-001");

    expect(mockQuoteIntent).toHaveBeenCalledWith(expect.objectContaining({
      baseJobId: "partial-child-0",
    }));
    expect(mockQuoteCompare).not.toHaveBeenCalled();
    expect(JSON.parse(String(inserted[6]))[0]).toMatchObject({
      kind: "compare-intent", estimatedCostUsd: 0.001, chargeable: true,
    });
    expect(quote).toMatchObject({
      estimatedCostUsd: 0.001,
      costSummary: { providers: { dataforseo: 0, openrouter: 0.001 } },
    });
  });
});
