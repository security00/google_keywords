import { describe, expect, test } from "vitest";

import { addFreshnessToComparisonResults } from "./index";
import type { ComparisonResult } from "@/lib/types";

const baseResult = (overrides: Partial<ComparisonResult> = {}): ComparisonResult => ({
  keyword: "sample keyword",
  avgValue: 20,
  benchmarkValue: 5,
  ratio: 4,
  ratioMean: 4,
  ratioRecent: 4,
  ratioCoverage: 1,
  ratioPeak: 4,
  ratioLastPoint: 4,
  slopeDiff: 1,
  volatility: 0.2,
  crossings: 0,
  verdict: "strong",
  ...overrides,
});

describe("addFreshnessToComparisonResults", () => {
  test("downgrades stable old keywords out of the new-word pipeline", () => {
    const [result] = addFreshnessToComparisonResults([
      baseResult({
        freshness: {
          status: "stable_old",
          label: "稳定老词",
          window: "none",
          score: 30,
          reason: "历史和近期都有稳定需求。",
        },
      }),
    ]);

    expect(result.verdict).toBe("fail");
  });

  test("downgrades old-hot keywords out of the new-word pipeline", () => {
    const [result] = addFreshnessToComparisonResults([
      baseResult({
        freshness: {
          status: "old_hot",
          label: "老词新热",
          window: "7d",
          score: 90,
          reason: "最近一周相对前序均值提升。",
        },
      }),
    ]);

    expect(result.verdict).toBe("fail");
  });
});
