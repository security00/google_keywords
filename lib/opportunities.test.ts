import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import { listKeywordOpportunities } from "./opportunities";
import type { SaasEntitlement } from "./entitlements";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);

const allowedEntitlement: SaasEntitlement = {
  allowed: true,
  source: "stripe",
  status: "active",
  planKey: "founding",
  reason: "Active subscription",
  expiresAt: "2026-08-01T00:00:00Z",
  briefLimit: 20,
  briefUsed: 0,
};

const blockedEntitlement: SaasEntitlement = {
  allowed: false,
  source: "none",
  status: "expired",
  planKey: null,
  reason: "Subscription required",
  expiresAt: "2026-04-01T00:00:00Z",
  briefLimit: 0,
  briefUsed: 0,
};

describe("listKeywordOpportunities", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
  });

  test("returns gated public samples when entitlement is not allowed", async () => {
    const result = await listKeywordOpportunities(blockedEntitlement, {
      pipeline: "game_new",
    });

    expect(result.gated).toBe(true);
    expect(mockD1Query).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      pipeline: "game_new",
      isPublicSample: true,
    });
  });

  test("combines opportunities from the active keyword pipelines", async () => {
    mockD1Query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "cmp-1",
            keyword: "ai workflow generator",
            ratio_recent: 2.2,
            ratio_peak: 3,
            slope_diff: 0.8,
            verdict: "pass",
            explanation: JSON.stringify({ summary: "Fresh comparison momentum." }),
            intent: JSON.stringify({ demand: "People want generated workflow tools." }),
            created_at: "2026-07-01T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 12,
            keyword: "roblox tycoon game",
            source_site: "steam",
            trend_ratio: 1.7,
            trend_slope: 0.4,
            trend_verdict: "rising",
            recommendation: "rising",
            reason: "Trend ratio and guide intent are both present.",
            trend_checked_at: "2026-07-01T01:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            keyword: "pricing calculator template",
            source_seed: "old-keywords",
            volume: 900,
            cpc: 3.2,
            kd: 18,
            competition: "medium",
            intent: "Template demand",
            score: 88,
            scan_date: "2026-07-01",
          },
        ],
      });

    const result = await listKeywordOpportunities(allowedEntitlement);

    expect(result.gated).toBe(false);
    expect(mockD1Query).toHaveBeenCalledTimes(3);
    expect(result.items.map((item) => item.pipeline)).toEqual([
      "game_new",
      "validated_market",
      "google_new",
    ]);
    expect(result.items[1]).toMatchObject({
      keyword: "pricing calculator template",
      status: "strong_pass",
      isPublicSample: false,
    });
  });

  test("sorts merged opportunities by newest timestamp before score", async () => {
    mockD1Query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "cmp-new",
            keyword: "new low score keyword",
            ratio_recent: 1,
            ratio_peak: 1.2,
            slope_diff: 0.1,
            verdict: "watch",
            explanation: null,
            intent: null,
            created_at: "2026-08-14T09:00:00Z",
          },
          {
            id: "cmp-old",
            keyword: "old high score keyword",
            ratio_recent: 4,
            ratio_peak: 5,
            slope_diff: 1,
            verdict: "strong",
            explanation: null,
            intent: null,
            created_at: "2026-08-12T09:00:00Z",
          },
          {
            id: "cmp-undated",
            keyword: "undated keyword",
            ratio_recent: 3,
            ratio_peak: 4,
            slope_diff: 0.8,
            verdict: "strong",
            explanation: null,
            intent: null,
            created_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await listKeywordOpportunities(allowedEntitlement);

    expect(result.items.map((item) => item.keyword)).toEqual([
      "new low score keyword",
      "old high score keyword",
      "undated keyword",
    ]);
  });

  test("applies filters and pagination after merging", async () => {
    mockD1Query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "cmp-1",
            keyword: "ai workflow generator",
            ratio_recent: 2,
            ratio_peak: 2.5,
            slope_diff: 0.6,
            verdict: "pass",
            explanation: null,
            intent: null,
            created_at: "2026-07-01T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            keyword: "pricing calculator template",
            source_seed: "old-keywords",
            volume: 900,
            cpc: 3.2,
            kd: 18,
            competition: "medium",
            intent: "Template demand",
            score: 88,
            scan_date: "2026-07-01",
          },
        ],
      });

    const result = await listKeywordOpportunities(allowedEntitlement, {
      category: "templates",
      limit: 1,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].keyword).toBe("pricing calculator template");
  });

  test("ignores optional source tables that are missing in local D1", async () => {
    mockD1Query
      .mockRejectedValueOnce(new Error("D1_ERROR: no such table: comparison_results: SQLITE_ERROR"))
      .mockResolvedValueOnce({
        rows: [
          {
            id: 12,
            keyword: "roblox tycoon game",
            source_site: "steam",
            trend_ratio: 1.7,
            trend_slope: 0.4,
            trend_verdict: "rising",
            recommendation: "rising",
            reason: "Trend ratio and guide intent are both present.",
            trend_checked_at: "2026-07-01T01:00:00Z",
          },
        ],
      })
      .mockRejectedValueOnce(new Error("D1_ERROR: no such table: old_keyword_opportunities: SQLITE_ERROR"));

    const result = await listKeywordOpportunities(allowedEntitlement);

    expect(result.gated).toBe(false);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      keyword: "roblox tycoon game",
      pipeline: "game_new",
    });
  });
});
