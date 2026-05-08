import { beforeEach, describe, expect, it, vi } from "vitest";

import { getGameOpportunityEnrichmentPreview } from "@/lib/game-opportunity-enrichment";
import { d1Query } from "@/lib/d1";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);

describe("getGameOpportunityEnrichmentPreview", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
  });

  it("returns deterministic read-only enrichment for top non-skip game candidates", async () => {
    mockD1Query.mockResolvedValue({
      rows: [
        {
          id: 1,
          keyword: "Planet Clicker",
          source_site: "steam",
          trend_ratio: 2.4,
          trend_slope: 1.2,
          serp_auth: 0,
          recommendation: "🎯 niche",
          reason: "low authority competition",
          trend_checked_at: "2026-05-08T10:00:00.000Z",
          discovered_at: "2026-05-08T09:00:00.000Z",
          created_at: "2026-05-08T08:00:00.000Z",
        },
      ],
    });

    const result = await getGameOpportunityEnrichmentPreview(10);

    expect(result.summary).toEqual({ totalCandidates: 1, topCount: 1 });
    expect(result.items[0]).toMatchObject({
      id: "1",
      keyword: "Planet Clicker",
      sourceSite: "steam",
      recommendation: "🎯 niche",
      intent: "game discovery",
      format: "新游介绍 / 上手指南",
    });
    expect(result.items[0].whyWorthDoing).toContain("趋势强度约 2.4x");
    expect(result.items[0].contentAngle).toContain("Planet Clicker");
    expect(result.items[0].risk).toContain("低权威竞争");
    expect(mockD1Query).toHaveBeenCalledTimes(1);
    expect(String(mockD1Query.mock.calls[0][0])).toMatch(/^\s*SELECT /);
    expect(String(mockD1Query.mock.calls[0][0])).toContain("FROM game_keyword_pipeline");
    expect(String(mockD1Query.mock.calls[0][0])).toContain("recommendation != '⏭️ skip'");
  });

  it("clamps requested limit to keep preview small", async () => {
    mockD1Query.mockResolvedValue({ rows: [] });

    await getGameOpportunityEnrichmentPreview(999);

    expect(mockD1Query.mock.calls[0][1]).toEqual([50]);
  });
});
