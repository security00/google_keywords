import { beforeEach, describe, expect, it, vi } from "vitest";

import { getGameOpportunityReport } from "./game-opportunity-report";
import { getGameOpportunityEnrichmentPreview } from "./game-opportunity-enrichment";
import { listGameOpportunityFeedback } from "./game-opportunity-feedback";
import { getSourceQualityStats } from "./source-quality";

vi.mock("./game-opportunity-enrichment", () => ({
  getGameOpportunityEnrichmentPreview: vi.fn(),
}));

vi.mock("./game-opportunity-feedback", () => ({
  listGameOpportunityFeedback: vi.fn(),
}));

vi.mock("./source-quality", () => ({
  getSourceQualityStats: vi.fn(),
}));

const mockEnrichment = vi.mocked(getGameOpportunityEnrichmentPreview);
const mockFeedback = vi.mocked(listGameOpportunityFeedback);
const mockSourceQuality = vi.mocked(getSourceQualityStats);

describe("getGameOpportunityReport", () => {
  beforeEach(() => {
    mockEnrichment.mockReset();
    mockFeedback.mockReset();
    mockSourceQuality.mockReset();
  });

  it("combines top opportunities, admin feedback, and source quality into a read-only report", async () => {
    mockEnrichment.mockResolvedValue({
      summary: { totalCandidates: 2, topCount: 2 },
      items: [
        {
          id: "1",
          keyword: "Planet Clicker",
          sourceSite: "steam",
          recommendation: "🎯 niche",
          trendRatio: 2.4,
          trendSlope: 1.2,
          serpAuth: 0,
          reason: "low competition",
          checkedAt: "2026-05-08T10:00:00.000Z",
          priorityScore: 42,
          whyWorthDoing: "trend",
          intent: "game discovery",
          contentAngle: "intro",
          risk: "low",
          format: "新游介绍 / 上手指南",
        },
        {
          id: "2",
          keyword: "The Freak Circus",
          sourceSite: "itchio",
          recommendation: "📈 rising",
          trendRatio: 1.5,
          trendSlope: 0.8,
          serpAuth: 2,
          reason: null,
          checkedAt: "2026-05-08T09:00:00.000Z",
          priorityScore: 30,
          whyWorthDoing: "rising",
          intent: "game discovery",
          contentAngle: "intro",
          risk: "medium",
          format: "新游介绍 / 上手指南",
        },
      ],
    });
    mockFeedback.mockResolvedValue([
      {
        opportunityId: "1",
        keyword: "Planet Clicker",
        verdict: "worth_doing",
        note: "good fit",
        updatedAt: "2026-05-08T11:00:00.000Z",
      },
    ]);
    mockSourceQuality.mockResolvedValue({
      summary: { sourceCount: 2, totalChecked: 20, totalRecommended: 3, overallSnr: 0.15, bestSource: "steam" },
      gameSources: [
        {
          source_site: "steam",
          total_checked: 10,
          recommended_count: 2,
          hot_count: 0,
          rising_count: 1,
          niche_count: 1,
          skip_count: 8,
          avg_trend_ratio: 2,
          avg_trend_slope: 1,
          avg_serp_auth: 1,
          snr: 0.2,
          last_checked_at: "2026-05-08T10:00:00.000Z",
          status: { label: "当前来源", tone: "active", note: null },
        },
      ],
      sitemapSources: [],
    });

    const report = await getGameOpportunityReport("admin-1", 10);

    expect(report.summary).toMatchObject({
      totalCandidates: 2,
      topCount: 2,
      worthDoingCount: 1,
      notWorthDoingCount: 0,
      sourceCount: 2,
      bestSource: "steam",
    });
    expect(report.items[0]).toMatchObject({
      id: "1",
      keyword: "Planet Clicker",
      feedback: { verdict: "worth_doing", note: "good fit" },
    });
    expect(report.items[1].feedback).toBeNull();
    expect(report.topSources[0]).toMatchObject({ source_site: "steam", recommended_count: 2 });
    expect(mockEnrichment).toHaveBeenCalledWith(10);
    expect(mockFeedback).toHaveBeenCalledWith("admin-1");
    expect(mockSourceQuality).toHaveBeenCalledTimes(1);
  });
});
