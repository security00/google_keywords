import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import {
  checkEffectiveAccess,
  getEffectiveEntitlement,
  getSaasEntitlement,
} from "./entitlements";
import {
  checkApiQuota,
  checkStudentAccess,
  getUserWithMeta,
  isTrialActive,
} from "@/lib/usage";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

vi.mock("@/lib/usage", () => ({
  checkApiQuota: vi.fn(),
  checkStudentAccess: vi.fn(),
  getUserWithMeta: vi.fn(),
  isTrialActive: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);
const mockCheckApiQuota = vi.mocked(checkApiQuota);
const mockCheckStudentAccess = vi.mocked(checkStudentAccess);
const mockGetUserWithMeta = vi.mocked(getUserWithMeta);
const mockIsTrialActive = vi.mocked(isTrialActive);

describe("getSaasEntitlement", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
    mockCheckApiQuota.mockReset();
    mockCheckStudentAccess.mockReset();
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
    expect(entitlement.reason).toContain("Subscribe from Settings");
  });

  test("resolves access entitlement without creating usage counters", async () => {
    mockGetUserWithMeta.mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      role: "student",
      trialStartedAt: null,
      trialExpiresAt: null,
    });
    mockD1Query.mockResolvedValueOnce({
      rows: [
        {
          plan_key: "builder",
          status: "active",
          current_period_end: "2026-08-01T00:00:00Z",
        },
      ],
    });

    const entitlement = await getEffectiveEntitlement("user-1");

    expect(entitlement).toMatchObject({
      allowed: true,
      source: "stripe",
      planKey: "builder",
    });
    expect(mockD1Query).toHaveBeenCalledTimes(1);
  });

  test("allows active Stripe subscribers through effective access after trial expiry", async () => {
    const user = {
      id: "user-1",
      email: "subscriber@example.com",
      role: "student" as const,
      trialStartedAt: "2026-01-01T00:00:00Z",
      trialExpiresAt: "2026-04-01T00:00:00Z",
    };
    mockGetUserWithMeta.mockResolvedValue(user);
    mockD1Query.mockResolvedValueOnce({
      rows: [
        {
          plan_key: "founding",
          status: "active",
          current_period_end: "2026-08-01T00:00:00Z",
        },
      ],
    });
    mockCheckApiQuota.mockResolvedValue({ allowed: true, used: 2, limit: 999 });
    mockIsTrialActive.mockReturnValue({
      active: false,
      expiresAt: user.trialExpiresAt,
      daysLeft: 0,
    });

    const access = await checkEffectiveAccess("user-1");

    expect(access).toMatchObject({
      allowed: true,
      user,
      quota: { used: 2, limit: 999 },
      entitlement: { source: "stripe", status: "active" },
    });
    expect(mockCheckStudentAccess).not.toHaveBeenCalled();
  });
});
