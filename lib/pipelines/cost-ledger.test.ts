import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import { recordPipelineCostEvent } from "./cost-ledger";

vi.mock("@/lib/d1", () => ({ d1Query: vi.fn() }));

const mockD1Query = vi.mocked(d1Query);

describe("pipeline cost attribution", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
  });

  test("defaults existing pipeline events to platform execution", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [], meta: { changes: 1 } });

    const result = await recordPipelineCostEvent({
      runId: "run-1",
      pipeline: "precompute-shared-expand",
      provider: "dataforseo",
      endpoint: "trends",
      unitType: "task",
      unitCount: 2,
      unitPriceUsd: 0.01,
    });

    expect(result.inserted).toBe(true);
    const [sql, params] = mockD1Query.mock.calls[0];
    expect(String(sql)).toContain(
      "credential_source, execution_mode",
    );
    expect(params?.slice(14, 17)).toEqual([
      "platform",
      "platform",
      null,
    ]);
    expect(params?.[7]).toBe(0.02);
  });

  test("retains explicit user attribution for future private execution", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [], meta: { changes: 1 } });

    await recordPipelineCostEvent({
      runId: "run-2",
      pipeline: "research-live",
      provider: "openrouter",
      endpoint: "chat",
      unitType: "request",
      unitCount: 1,
      credentialSource: "user",
      executionMode: "byok",
      ownerId: "user-1",
    });

    expect(mockD1Query.mock.calls[0][1]?.slice(14, 17)).toEqual([
      "user",
      "byok",
      "user-1",
    ]);
  });
});
