import { beforeEach, describe, expect, test, vi } from "vitest";

import { requireAdminRequest } from "@/lib/authz";
import { loadByokOperationsHealth, reconcileStaleByokJob } from "@/lib/byok/operations";
import { GET, POST } from "./route";

vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()), requireAdminRequest: vi.fn(),
}));
vi.mock("@/lib/byok/operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/operations")>()),
  loadByokOperationsHealth: vi.fn(), reconcileStaleByokJob: vi.fn(),
}));

const mockAdmin = vi.mocked(requireAdminRequest);
const mockHealth = vi.mocked(loadByokOperationsHealth);
const mockReconcile = vi.mocked(reconcileStaleByokJob);

describe("admin BYOK health route", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns only the admin operations projection with no-store", async () => {
    mockAdmin.mockResolvedValue({ userId: "admin-1", role: "admin", authMethod: "cookie", scopes: [] });
    mockHealth.mockResolvedValue({ generatedAt: "now" } as never);
    const response = await GET(new Request("https://app.test/api/admin/byok-health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ generatedAt: "now" });
  });

  test("requires same-origin and forwards the exact reconciliation precondition", async () => {
    mockAdmin.mockResolvedValue({ userId: "admin-1", role: "admin", authMethod: "cookie", scopes: [] });
    mockReconcile.mockResolvedValue({
      jobId: "job-1", ownerId: "owner-1", action: "mark_uncertain", status: "failed",
    });
    const response = await POST(new Request("https://app.test/api/admin/byok-health", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: JSON.stringify({
        action: "mark_uncertain",
        expectedUpdatedAt: "2026-07-21T00:00:00.000Z",
        jobId: "job-1",
        ownerId: "owner-1",
      }),
    }));
    expect(response.status).toBe(200);
    expect(mockReconcile).toHaveBeenCalledWith({
      action: "mark_uncertain",
      actorId: "admin-1",
      expectedUpdatedAt: "2026-07-21T00:00:00.000Z",
      jobId: "job-1",
      ownerId: "owner-1",
    });
  });

  test("rejects cross-origin reconciliation before mutation", async () => {
    mockAdmin.mockResolvedValue({ userId: "admin-1", role: "admin", authMethod: "cookie", scopes: [] });
    const response = await POST(new Request("https://app.test/api/admin/byok-health", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.test" },
      body: "{}",
    }));
    expect(response.status).toBe(403);
    expect(mockReconcile).not.toHaveBeenCalled();
  });
});
