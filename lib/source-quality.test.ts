import { describe, expect, test } from "vitest";

import {
  buildSourceQualitySummary,
  calculateSnr,
  getGameSourceStatus,
  type GameSourceQualityRow,
} from "./source-quality";

const source = (overrides: Partial<GameSourceQualityRow>): GameSourceQualityRow => ({
  source_site: "example",
  total_checked: 0,
  recommended_count: 0,
  hot_count: 0,
  rising_count: 0,
  niche_count: 0,
  skip_count: 0,
  avg_trend_ratio: null,
  avg_trend_slope: null,
  avg_serp_auth: null,
  snr: 0,
  last_checked_at: null,
  status: { label: "当前来源", tone: "active", note: null },
  ...overrides,
});

describe("calculateSnr", () => {
  test("returns 0 when total is 0", () => {
    expect(calculateSnr(0, 0)).toBe(0);
    expect(calculateSnr(3, 0)).toBe(0);
  });

  test("returns recommended divided by total", () => {
    expect(calculateSnr(3, 10)).toBe(0.3);
  });
});

describe("getGameSourceStatus", () => {
  test("marks Steam as a disabled historical source", () => {
    expect(getGameSourceStatus("steam")).toEqual({
      label: "已停用历史源",
      tone: "muted",
      note: "Steam 曾接入过，但因付费游戏较多、对网页流量站价值低，已被 Poki/Addicting Games/itch.io 等来源替代。",
    });
  });

  test("marks active scanner sources as active", () => {
    expect(getGameSourceStatus("itchio")).toEqual({ label: "当前来源", tone: "active", note: null });
  });
});

describe("buildSourceQualitySummary", () => {
  test("returns safe defaults for empty source list", () => {
    expect(buildSourceQualitySummary([])).toEqual({
      sourceCount: 0,
      totalChecked: 0,
      totalRecommended: 0,
      overallSnr: 0,
      bestSource: null,
    });
  });

  test("aggregates totals and chooses best source by SNR then recommended count", () => {
    const summary = buildSourceQualitySummary([
      source({ source_site: "high-volume", total_checked: 100, recommended_count: 20, snr: 0.2 }),
      source({ source_site: "focused", total_checked: 10, recommended_count: 5, snr: 0.5 }),
      source({ source_site: "same-snr-more-rec", total_checked: 20, recommended_count: 10, snr: 0.5 }),
    ]);

    expect(summary).toEqual({
      sourceCount: 3,
      totalChecked: 130,
      totalRecommended: 35,
      overallSnr: 35 / 130,
      bestSource: "same-snr-more-rec",
    });
  });
});
