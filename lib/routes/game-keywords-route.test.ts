import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/game-keywords/route";
import { d1Query } from "@/lib/d1";
import { checkStudentAccess } from "@/lib/usage";

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
};

vi.mock("@/lib/auth_middleware", () => ({
  authenticate: vi.fn(async () => ({ authenticated: true, userId: "user-1" })),
}));

vi.mock("@/lib/usage", () => ({
  checkStudentAccess: vi.fn(async () => allowedAccess),
}));

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

vi.mock("@/config/business-rules", () => ({
  GAME_KEYWORDS_PER_USER: 3,
}));

const mockD1Query = vi.mocked(d1Query);
const mockCheckStudentAccess = vi.mocked(checkStudentAccess);

describe("GET /api/game-keywords", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
    mockCheckStudentAccess.mockResolvedValue(allowedAccess);
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
  });

  it("blocks pending students before reading game recommendations", async () => {
    mockCheckStudentAccess.mockResolvedValue({
      allowed: false,
      reason: "账号已注册，等待管理员开通 90 天使用期",
      code: "trial_inactive",
    });

    const response = await GET(new NextRequest("https://example.com/api/game-keywords"));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.code).toBe("trial_inactive");
    expect(mockD1Query).not.toHaveBeenCalled();
  });
});
