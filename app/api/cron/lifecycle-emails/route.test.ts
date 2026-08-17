import { beforeEach, describe, expect, test, vi } from "vitest";

const mockIsCronRequest = vi.hoisted(() => vi.fn());
const mockRunLifecycleEmailCron = vi.hoisted(() => vi.fn());

vi.mock("@/lib/authz", () => ({
  isCronRequest: mockIsCronRequest,
}));

vi.mock("@/lib/lifecycle-emails", () => ({
  runLifecycleEmailCron: mockRunLifecycleEmailCron,
}));

const { GET } = await import("./route");

describe("GET /api/cron/lifecycle-emails", () => {
  beforeEach(() => {
    mockIsCronRequest.mockReset();
    mockRunLifecycleEmailCron.mockReset();
  });

  test("rejects callers without a cron secret", async () => {
    mockIsCronRequest.mockResolvedValueOnce(false);
    const response = await GET(new Request("https://discoverkeywords.co/api/cron/lifecycle-emails"));
    expect(response.status).toBe(401);
    expect(mockRunLifecycleEmailCron).not.toHaveBeenCalled();
  });

  test("runs the daily reminder batch for cron callers", async () => {
    mockIsCronRequest.mockResolvedValueOnce(true);
    mockRunLifecycleEmailCron.mockResolvedValueOnce({ skipped: false, sent: 2, scanned: 4 });
    const response = await GET(new Request("https://discoverkeywords.co/api/cron/lifecycle-emails"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ skipped: false, sent: 2, scanned: 4 });
  });
});
