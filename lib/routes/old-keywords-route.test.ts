import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { GET } from "@/app/api/old-keywords/route";
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

vi.mock("@/config/business-rules", () => ({
  OLD_WORD_PER_USER: 3,
}));

const mockD1Query = vi.mocked(d1Query);
const mockRequireEffectiveUser = vi.mocked(requireEffectiveUser);

describe("GET /api/old-keywords", () => {
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

  it("blocks pending students before reading old keyword recommendations", async () => {
    mockRequireEffectiveUser.mockResolvedValue(
      NextResponse.json(
        {
          error: "账号已注册，等待管理员开通 90 天使用期",
          code: "trial_inactive",
        },
        { status: 403 },
      ),
    );

    const response = await GET(new NextRequest("https://example.com/api/old-keywords"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("trial_inactive");
    expect(mockD1Query).not.toHaveBeenCalled();
  });
});
