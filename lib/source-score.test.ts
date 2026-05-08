import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSourceScoreStats } from "./source-score";
import { getSourceQualityStats } from "./source-quality";
import { d1Query } from "./d1";

vi.mock("./source-quality", () => ({
  getSourceQualityStats: vi.fn(),
}));

vi.mock("./d1", () => ({
  d1Query: vi.fn(),
}));

const mockQuality = vi.mocked(getSourceQualityStats);
const mockD1Query = vi.mocked(d1Query);

describe("getSourceScoreStats", () => {
  beforeEach(() => {
    mockQuality.mockReset();
    mockD1Query.mockReset();
  });

  it("combines source quality and manual opportunity feedback into observable source scores", async () => {
    mockQuality.mockResolvedValue({
      summary: { sourceCount: 2, totalChecked: 30, totalRecommended: 6, overallSnr: 0.2, bestSource: "steam" },
      gameSources: [
        {
          source_site: "steam",
          total_checked: 20,
          recommended_count: 5,
          hot_count: 1,
          rising_count: 2,
          niche_count: 2,
          skip_count: 15,
          avg_trend_ratio: 3,
          avg_trend_slope: 1.2,
          avg_serp_auth: 1,
          snr: 0.25,
          last_checked_at: "2026-05-08T10:00:00.000Z",
          status: { label: "当前来源", tone: "active", note: null },
        },
        {
          source_site: "poki",
          total_checked: 10,
          recommended_count: 1,
          hot_count: 0,
          rising_count: 0,
          niche_count: 1,
          skip_count: 9,
          avg_trend_ratio: 1,
          avg_trend_slope: 0.3,
          avg_serp_auth: 3,
          snr: 0.1,
          last_checked_at: "2026-05-08T09:00:00.000Z",
          status: { label: "当前来源", tone: "active", note: null },
        },
      ],
      sitemapSources: [],
    });
    mockD1Query.mockResolvedValue({
      rows: [
        { source_site: "steam", worth_count: 2, not_worth_count: 0, feedback_count: 2 },
        { source_site: "poki", worth_count: 0, not_worth_count: 1, feedback_count: 1 },
      ],
    });

    const stats = await getSourceScoreStats();

    expect(String(mockD1Query.mock.calls[0][0])).toContain("FROM game_opportunity_feedback");
    expect(String(mockD1Query.mock.calls[0][0])).toContain("JOIN game_keyword_pipeline");
    expect(stats.summary).toMatchObject({ sourceCount: 2, bestSource: "steam" });
    expect(stats.sources[0]).toMatchObject({
      sourceSite: "steam",
      recommendedCount: 5,
      worthCount: 2,
      notWorthCount: 0,
      feedbackScore: 1,
      confidence: "medium",
    });
    expect(stats.sources[0].sourceScore).toBeGreaterThan(stats.sources[1].sourceScore);
    expect(stats.sources[1]).toMatchObject({
      sourceSite: "poki",
      worthCount: 0,
      notWorthCount: 1,
      feedbackScore: -1,
      confidence: "low",
    });
  });
});
