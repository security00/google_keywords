import { describe, expect, it } from "vitest";

import { buildSourceWeightSuggestions } from "./source-weight-suggestions";
import type { SourceScoreRow } from "./source-score";

const source = (overrides: Partial<SourceScoreRow>): SourceScoreRow => ({
  sourceSite: "steam",
  totalChecked: 100,
  recommendedCount: 20,
  snr: 0.2,
  worthCount: 0,
  notWorthCount: 0,
  feedbackCount: 0,
  feedbackScore: 0,
  sourceScore: 20,
  confidence: "low",
  lastCheckedAt: null,
  ...overrides,
});

describe("buildSourceWeightSuggestions", () => {
  it("suggests boost/downrank/watch decisions without applying weights", () => {
    const result = buildSourceWeightSuggestions([
      source({ sourceSite: "steam", feedbackCount: 10, worthCount: 8, notWorthCount: 2, recommendedCount: 12, snr: 0.24, sourceScore: 48, confidence: "high" }),
      source({ sourceSite: "poki", feedbackCount: 10, worthCount: 3, notWorthCount: 7, recommendedCount: 9, snr: 0.1, sourceScore: 2, confidence: "high" }),
      source({ sourceSite: "itchio", feedbackCount: 2, worthCount: 1, notWorthCount: 1, recommendedCount: 8, snr: 0.3, sourceScore: 31, confidence: "medium" }),
    ]);

    expect(result.summary).toEqual({ boostCount: 1, downrankCount: 1, watchCount: 1, total: 3 });
    expect(result.suggestions.map((item) => [item.sourceSite, item.action])).toEqual([
      ["steam", "boost"],
      ["poki", "downrank"],
      ["itchio", "watch"],
    ]);
    expect(result.suggestions[0]).toMatchObject({
      sourceSite: "steam",
      suggestedMultiplier: 1.2,
      canAutoApply: false,
    });
    expect(result.suggestions[1]).toMatchObject({
      sourceSite: "poki",
      suggestedMultiplier: 0.8,
      canAutoApply: false,
    });
    expect(result.suggestions[2].reason).toContain("反馈样本不足");
  });
});
