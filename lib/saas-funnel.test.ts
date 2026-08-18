import { beforeEach, describe, expect, test, vi } from "vitest";

const mockD1Query = vi.hoisted(() => vi.fn());

vi.mock("@/lib/d1", () => ({
  d1Query: mockD1Query,
}));

const { loadSaasFunnelSnapshot } = await import("./saas-funnel");

describe("loadSaasFunnelSnapshot", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
  });

  test("maps read-only funnel counts without writing", async () => {
    mockD1Query.mockResolvedValueOnce({
      rows: [
        {
          registered_students: 12,
          pending_activation: 2,
          activated_trials: 10,
          active_trials: 6,
          expired_trials: 3,
          subscribed: 1,
          invited_activated: 8,
          last_7d_registrations: 4,
          last_30d_registrations: 9,
        },
      ],
    });

    await expect(
      loadSaasFunnelSnapshot(new Date("2026-08-19T00:00:00.000Z"))
    ).resolves.toEqual({
      generatedAt: "2026-08-19T00:00:00.000Z",
      registeredStudents: 12,
      pendingActivation: 2,
      activatedTrials: 10,
      activeTrials: 6,
      expiredTrials: 3,
      subscribed: 1,
      invitedActivated: 8,
      last7dRegistrations: 4,
      last30dRegistrations: 9,
    });

    expect(String(mockD1Query.mock.calls[0][0])).toMatch(/SELECT/i);
    expect(String(mockD1Query.mock.calls[0][0])).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });
});
