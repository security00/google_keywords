import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { GET } from "@/app/api/game-keywords/route";
import { d1Query } from "@/lib/d1";
import { requireEffectiveUser } from "@/lib/authz";

const allowedAccess = {
  allowed: true as const,
  user: {
    id: "user-1",
    email: "student@example.com",
    role: "student" as const,
    trialStartedAt: "2026-05-01T00:00:00Z",
    trialExpiresAt: "2026-08-01T00:00:00Z",
  },
  quota: { used: 0, limit: 999 },
  trial: { active: true, daysLeft: 60, expiresAt: "2026-08-01T00:00:00Z" },
  entitlement: {
    allowed: true as const,
    source: "course" as const,
    planKey: "course" as const,
    status: "trialing" as const,
    expiresAt: "2026-08-01T00:00:00Z",
  },
};

vi.mock("@/lib/authz", () => ({
  isAuthzError: vi.fn((value) => value instanceof Response),
  requireEffectiveUser: vi.fn(async () => ({
    userId: "user-1",
    role: "student",
    authMethod: "api_key",
    scopes: ["cache:read"],
    access: allowedAccess,
  })),
}));

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);
const mockRequireEffectiveUser = vi.mocked(requireEffectiveUser);

describe("GET /api/game-keywords", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
    mockRequireEffectiveUser.mockResolvedValue({
      userId: "user-1",
      role: "student",
      authMethod: "api_key",
      scopes: ["cache:read"],
      access: allowedAccess,
    });
  });

  it("queries only fully verified recommended game keywords", async () => {
    mockD1Query.mockResolvedValue({
      rows: [
        {
          keyword: "Planet Clicker",
          source_site: "steam",
          trend_ratio: 2.4,
          trend_slope: 1.2,
          trend_verdict: "watch",
          serp_organic: 8,
          serp_auth: 0,
          serp_featured: 0,
          recommendation: "🎯 niche",
          reason: "game SERP verified",
          trend_series: null,
          trend_checked_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        },
      ],
    });

    const response = await GET(new NextRequest("https://example.com/api/game-keywords"));
    const body = await response.json();

    expect(body.keywords).toHaveLength(1);
    const sql = String(mockD1Query.mock.calls[0][0]);
    expect(sql).toContain("status = 'recommended'");
    expect(sql).toContain("recommendation != '⏭️ skip'");
    expect(sql).toContain("serp_organic > 0");
    expect(sql).toContain("reason NOT LIKE '%⚠️ SERP首页缺少游戏相关结果%'");
    expect(sql).toContain("datetime(trend_checked_at) >= datetime('now', ?)");
    expect(mockD1Query.mock.calls[0][1]).toEqual(["-14 days"]);
    expect(body.keywords[0].slot).toBe("weekly_hot");
  });

  it("pins the weekly hottest game and staggers the rest by user", async () => {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    mockD1Query.mockResolvedValue({
      rows: [
        {
          keyword: "Weekly Hot",
          source_site: "steam-topsellers",
          trend_ratio: 9.1,
          trend_slope: 4,
          trend_verdict: "watch",
          serp_organic: 8,
          serp_auth: 1,
          serp_featured: 0,
          recommendation: "🔥 hot",
          reason: "high traffic",
          trend_series: null,
          trend_checked_at: now,
        },
        {
          keyword: "Poki Niche",
          source_site: "poki",
          trend_ratio: 1.2,
          trend_slope: 1,
          trend_verdict: "watch",
          serp_organic: 6,
          serp_auth: 0,
          serp_featured: 0,
          recommendation: "🎯 niche",
          reason: "low competition",
          trend_series: null,
          trend_checked_at: now,
        },
        {
          keyword: "Itch Niche",
          source_site: "itchio",
          trend_ratio: 0.9,
          trend_slope: 1,
          trend_verdict: "watch",
          serp_organic: 5,
          serp_auth: 0,
          serp_featured: 0,
          recommendation: "🎯 niche",
          reason: "low competition",
          trend_series: null,
          trend_checked_at: now,
        },
      ],
    });

    const response = await GET(new NextRequest("https://example.com/api/game-keywords"));
    const body = await response.json();

    expect(body.keywords).toHaveLength(3);
    expect(body.keywords[0]).toMatchObject({ keyword: "Weekly Hot", slot: "weekly_hot" });
    expect(body.keywords.slice(1).every((item: { slot: string }) => item.slot === "diverse")).toBe(true);
    expect(new Set(body.keywords.map((item: { source: string }) => item.source)).size).toBe(3);
  });

  it("blocks pending students before reading game recommendations", async () => {
    mockRequireEffectiveUser.mockResolvedValue(
      NextResponse.json(
        {
          error: "账号已注册，等待管理员开通 90 天使用期",
          code: "trial_inactive",
        },
        { status: 403 },
      ),
    );

    const response = await GET(new NextRequest("https://example.com/api/game-keywords"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("trial_inactive");
    expect(mockD1Query).not.toHaveBeenCalled();
  });
});
