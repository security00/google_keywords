import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import { getSaasEntitlement } from "./entitlements";
import { getUserWithMeta, isTrialActive } from "@/lib/usage";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

vi.mock("@/lib/usage", () => ({
  getUserWithMeta: vi.fn(),
  isTrialActive: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);
const mockGetUserWithMeta = vi.mocked(getUserWithMeta);
const mockIsTrialActive = vi.mocked(isTrialActive);

describe("getSaasEntitlement", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
    mockGetUserWithMeta.mockReset();
    mockIsTrialActive.mockReset();
  });

  test("allows active course trial students", async () => {
    mockGetUserWithMeta.mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      role: "student",
      trialStartedAt: "2026-07-01T00:00:00Z",
      trialExpiresAt: "2026-10-01T00:00:00Z",
    });
    mockD1Query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockIsTrialActive.mockReturnValue({
      active: true,
      expiresAt: "2026-10-01T00:00:00Z",
      daysLeft: 90,
    });

    const entitlement = await getSaasEntitlement("user-1");

    expect(entitlement.allowed).toBe(true);
    expect(entitlement.source).toBe("course");
    expect(entitlement.planKey).toBe("course");
    expect(entitlement.briefLimit).toBe(5);
  });

  test("prefers active Stripe subscription over expired trial", async () => {
    mockGetUserWithMeta.mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      role: "student",
      trialStartedAt: "2026-01-01T00:00:00Z",
      trialExpiresAt: "2026-04-01T00:00:00Z",
    });
    mockD1Query
      .mockResolvedValueOnce({
        rows: [
          {
            plan_key: "founding",
            status: "active",
            current_period_end: "2026-08-01T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const entitlement = await getSaasEntitlement("user-1");

    expect(mockIsTrialActive).not.toHaveBeenCalled();
    expect(entitlement.allowed).toBe(true);
    expect(entitlement.source).toBe("stripe");
    expect(entitlement.planKey).toBe("founding");
    expect(entitlement.briefLimit).toBe(20);
  });

  test("blocks expired students without active subscription", async () => {
    mockGetUserWithMeta.mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      role: "student",
      trialStartedAt: "2026-01-01T00:00:00Z",
      trialExpiresAt: "2026-04-01T00:00:00Z",
    });
    mockD1Query.mockResolvedValueOnce({ rows: [] });
    mockIsTrialActive.mockReturnValue({
      active: false,
      expiresAt: "2026-04-01T00:00:00Z",
      daysLeft: 0,
    });

    const entitlement = await getSaasEntitlement("user-1");

    expect(entitlement.allowed).toBe(false);
    expect(entitlement.status).toBe("expired");
    expect(entitlement.reason).toContain("Subscription required");
  });
});
