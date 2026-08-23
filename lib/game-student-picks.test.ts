import { describe, expect, it } from "vitest";

import { pickStudentGameKeywords } from "./game-student-picks";

const NOW = Date.parse("2026-08-23T15:00:00Z");
const hoursAgo = (hours: number) =>
  new Date(NOW - hours * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");

describe("pickStudentGameKeywords", () => {
  const rows = [
    {
      keyword: "Old Champion",
      source_site: "steam",
      trend_ratio: 20,
      trend_slope: 4,
      recommendation: "🔥 hot",
      trend_checked_at: hoursAgo(10 * 24),
    },
    {
      keyword: "Weekly Hot",
      source_site: "steam-topsellers",
      trend_ratio: 12,
      trend_slope: 5,
      recommendation: "🔥 hot",
      trend_checked_at: hoursAgo(12),
    },
    {
      keyword: "Weekly Rising",
      source_site: "poki",
      trend_ratio: 3.2,
      trend_slope: 6,
      recommendation: "📈 rising",
      trend_checked_at: hoursAgo(8),
    },
    {
      keyword: "Weekly Steam New",
      source_site: "steam-new",
      trend_ratio: 2.4,
      trend_slope: 3,
      recommendation: "🔥 hot",
      trend_checked_at: hoursAgo(6),
    },
    {
      keyword: "Weak Niche",
      source_site: "itchio",
      trend_ratio: 0.8,
      trend_slope: 2,
      recommendation: "🎯 niche",
      trend_checked_at: hoursAgo(4),
    },
    {
      keyword: "Strong Niche",
      source_site: "crazygames",
      trend_ratio: 1.4,
      trend_slope: 1.2,
      recommendation: "🎯 niche",
      trend_checked_at: hoursAgo(5),
    },
  ];

  it("staggers three weekly hot games instead of pinning the same title", () => {
    const a = pickStudentGameKeywords(rows, "user-a", { nowMs: NOW, weeklyWindowDays: 7, count: 3 });
    const b = pickStudentGameKeywords(rows, "user-b", { nowMs: NOW, weeklyWindowDays: 7, count: 3 });

    expect(a).toHaveLength(3);
    expect(a.every((row) => row.slot === "weekly_hot")).toBe(true);
    expect(a.map((row) => row.keyword)).not.toContain("Weak Niche");
    expect(a.map((row) => row.keyword)).not.toContain("Old Champion");
    expect(new Set(a.map((row) => row.source_site)).size).toBeGreaterThan(1);
    expect(a.map((row) => row.keyword)).toEqual(
      pickStudentGameKeywords(rows, "user-a", { nowMs: NOW, weeklyWindowDays: 7, count: 3 }).map(
        (row) => row.keyword,
      ),
    );
    expect(a.map((row) => row.keyword)).not.toEqual(b.map((row) => row.keyword));
  });

  it("drops weak niches and rows older than the recommendation window", () => {
    const picked = pickStudentGameKeywords(rows, "user-a", {
      nowMs: NOW,
      maxAgeDays: 14,
      weeklyWindowDays: 7,
      count: 3,
    });
    expect(picked.map((row) => row.keyword)).not.toContain("Old Champion");
    expect(picked.map((row) => row.keyword)).not.toContain("Weak Niche");
    expect(picked.map((row) => row.keyword)).toContain("Strong Niche");
  });

  it("fills from 14-day hot games when the weekly pool is too small", () => {
    const picked = pickStudentGameKeywords(rows, "user-a", {
      nowMs: NOW,
      maxAgeDays: 14,
      weeklyWindowDays: 7,
      count: 5,
    });
    expect(picked.some((row) => row.keyword === "Old Champion" && row.slot === "diverse")).toBe(true);
    expect(picked.filter((row) => row.slot === "weekly_hot").length).toBeGreaterThanOrEqual(3);
  });

  it("returns the available hot rows when the pool is smaller than the requested count", () => {
    const picked = pickStudentGameKeywords(rows.slice(1, 2), "user-a", { nowMs: NOW, count: 3 });
    expect(picked).toEqual([expect.objectContaining({ keyword: "Weekly Hot", slot: "weekly_hot" })]);
  });
});
