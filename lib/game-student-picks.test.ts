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
      serp_auth: 0,
      recommendation: "🔥 hot",
      trend_checked_at: hoursAgo(10 * 24),
    },
    {
      keyword: "Weekly Hot",
      source_site: "steam-topsellers",
      trend_ratio: 12,
      serp_auth: 2,
      recommendation: "🔥 hot",
      trend_checked_at: hoursAgo(12),
    },
    {
      keyword: "Same Source Niche",
      source_site: "steam-topsellers",
      trend_ratio: 4,
      serp_auth: 0,
      recommendation: "🎯 niche",
      trend_checked_at: hoursAgo(20),
    },
    {
      keyword: "Poki Niche",
      source_site: "poki",
      trend_ratio: 1.1,
      serp_auth: 0,
      recommendation: "🎯 niche",
      trend_checked_at: hoursAgo(8),
    },
    {
      keyword: "Itch Niche",
      source_site: "itchio",
      trend_ratio: 0.9,
      serp_auth: 0,
      recommendation: "🎯 niche",
      trend_checked_at: hoursAgo(6),
    },
    {
      keyword: "Crazy Niche",
      source_site: "crazygames",
      trend_ratio: 0.8,
      serp_auth: 0,
      recommendation: "🎯 niche",
      trend_checked_at: hoursAgo(4),
    },
  ];

  it("pins the hottest game from the weekly window for every user", () => {
    const a = pickStudentGameKeywords(rows, "user-a", { nowMs: NOW, weeklyWindowDays: 7, count: 3 });
    const b = pickStudentGameKeywords(rows, "user-b", { nowMs: NOW, weeklyWindowDays: 7, count: 3 });

    expect(a[0]).toMatchObject({ keyword: "Weekly Hot", slot: "weekly_hot" });
    expect(b[0]).toMatchObject({ keyword: "Weekly Hot", slot: "weekly_hot" });
  });

  it("drops rows older than the recommendation window", () => {
    const picked = pickStudentGameKeywords(rows, "user-a", {
      nowMs: NOW,
      maxAgeDays: 14,
      weeklyWindowDays: 7,
      count: 3,
    });
    expect(picked.map((row) => row.keyword)).not.toContain("Old Champion");
  });

  it("fills the remaining slots from other sources and low-competition niches", () => {
    const picked = pickStudentGameKeywords(rows, "user-a", { nowMs: NOW, weeklyWindowDays: 7, count: 3 });
    const diverse = picked.filter((row) => row.slot === "diverse");

    expect(picked).toHaveLength(3);
    expect(diverse).toHaveLength(2);
    expect(diverse.every((row) => row.source_site !== "steam-topsellers")).toBe(true);
    expect(new Set(diverse.map((row) => row.source_site)).size).toBe(2);
  });

  it("staggers diverse picks across users but stays stable for the same user", () => {
    const a1 = pickStudentGameKeywords(rows, "user-a", { nowMs: NOW, count: 3 });
    const a2 = pickStudentGameKeywords(rows, "user-a", { nowMs: NOW, count: 3 });
    const b = pickStudentGameKeywords(rows, "user-b", { nowMs: NOW, count: 3 });

    expect(a1.map((row) => row.keyword)).toEqual(a2.map((row) => row.keyword));
    expect(a1.slice(1).map((row) => row.keyword)).not.toEqual(b.slice(1).map((row) => row.keyword));
  });

  it("falls back to the hottest remaining row when the weekly window is empty", () => {
    const stale = rows.map((row) => ({ ...row, trend_checked_at: hoursAgo(20 * 24) }));
    const picked = pickStudentGameKeywords(stale, "user-a", { nowMs: NOW, weeklyWindowDays: 7, count: 2 });
    expect(picked[0]).toMatchObject({ keyword: "Old Champion", slot: "weekly_hot" });
  });

  it("returns the available rows when the pool is smaller than the requested count", () => {
    const picked = pickStudentGameKeywords(rows.slice(1, 2), "user-a", { nowMs: NOW, count: 3 });
    expect(picked).toEqual([expect.objectContaining({ keyword: "Weekly Hot", slot: "weekly_hot" })]);
  });
});
