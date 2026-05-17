import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/game-keywords/route";
import { d1Query } from "@/lib/d1";

vi.mock("@/lib/auth_middleware", () => ({
  authenticate: vi.fn(async () => ({ authenticated: true, userId: "user-1" })),
}));

vi.mock("@/lib/usage", () => ({
  checkStudentAccess: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

vi.mock("@/config/business-rules", () => ({
  GAME_KEYWORDS_PER_USER: 3,
}));

const mockD1Query = vi.mocked(d1Query);

describe("GET /api/game-keywords", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
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

    const response = await GET(new Request("https://example.com/api/game-keywords") as any);
    const body = await response.json();

    expect(body.keywords).toHaveLength(1);
    const sql = String(mockD1Query.mock.calls[0][0]);
    expect(sql).toContain("status = 'recommended'");
    expect(sql).toContain("recommendation != '⏭️ skip'");
    expect(sql).toContain("serp_organic > 0");
    expect(sql).toContain("reason NOT LIKE '%⚠️ SERP首页缺少游戏相关结果%'");
  });
});
