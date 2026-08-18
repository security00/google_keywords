import { beforeEach, describe, expect, test, vi } from "vitest";

const mockRequireAdmin = vi.hoisted(() => vi.fn());
const mockLoadSaasFunnelSnapshot = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin", () => ({
  requireAdmin: mockRequireAdmin,
}));

vi.mock("@/lib/saas-funnel", () => ({
  loadSaasFunnelSnapshot: mockLoadSaasFunnelSnapshot,
}));

const { GET } = await import("./route");

describe("GET /api/admin/saas-funnel", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset();
    mockLoadSaasFunnelSnapshot.mockReset();
  });

  test("rejects non-admin callers before querying", async () => {
    mockRequireAdmin.mockResolvedValueOnce({ userId: "", error: "Unauthorized" });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mockLoadSaasFunnelSnapshot).not.toHaveBeenCalled();
  });

  test("returns the read-only snapshot for admins", async () => {
    mockRequireAdmin.mockResolvedValueOnce({ userId: "admin-1" });
    mockLoadSaasFunnelSnapshot.mockResolvedValueOnce({
      generatedAt: "2026-08-19T00:00:00.000Z",
      registeredStudents: 4,
      pendingActivation: 1,
      activatedTrials: 3,
      activeTrials: 2,
      expiredTrials: 1,
      subscribed: 0,
      invitedActivated: 3,
      last7dRegistrations: 1,
      last30dRegistrations: 2,
    });

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      registeredStudents: 4,
      subscribed: 0,
    });
  });
});
