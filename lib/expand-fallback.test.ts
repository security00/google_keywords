import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

import { d1Query } from "@/lib/d1";
import { findCachedExpandFallback } from "@/app/api/research/expand/expand-job-helpers";

const mockD1Query = vi.mocked(d1Query);

describe("findCachedExpandFallback", () => {
  it("uses a recent full shared result when no trimmed cache exists", async () => {
    const largePayload = {
      keywords: ["ai", "tool"],
      candidates: [],
      organized: { explosive: [], fastRising: [], steadyRising: [], slowRising: [] },
      flatList: [{ keyword: "ai tool", value: 250, type: "rising", source: "ai" }],
      filler: "x".repeat(220_000),
    };

    mockD1Query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            response_data: JSON.stringify(largePayload),
            cache_key: "2026-06-10:expand_result:ai,tool:dateFrom=2026-06-02,dateTo=2026-06-09",
            created_at: "2026-06-10T16:12:02.615Z",
          },
        ],
      });

    const fallback = await findCachedExpandFallback(["tool", "ai"]);

    expect(fallback).toMatchObject({
      cacheKey: "2026-06-10:expand_result:ai,tool:dateFrom=2026-06-02,dateTo=2026-06-09",
      mode: "keyword_exact_full",
    });
    expect(fallback?.response.flatList).toHaveLength(1);
  });
});
