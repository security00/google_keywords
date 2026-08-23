import { beforeEach, describe, expect, test, vi } from "vitest";

import { requireAdminRequest } from "@/lib/authz";
import { grantByokAllowlist, listByokAllowlist, revokeByokAllowlist } from "@/lib/byok/allowlist";
import { DELETE, GET, POST } from "./route";

vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireAdminRequest: vi.fn(),
}));
vi.mock("@/lib/byok/allowlist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/byok/allowlist")>()),
  grantByokAllowlist: vi.fn(),
  listByokAllowlist: vi.fn(),
  revokeByokAllowlist: vi.fn(),
}));

const mockAdmin = vi.mocked(requireAdminRequest);
const mockList = vi.mocked(listByokAllowlist);
const mockGrant = vi.mocked(grantByokAllowlist);
const mockRevoke = vi.mocked(revokeByokAllowlist);

const cookieAdmin = {
  userId: "admin-1",
  role: "admin" as const,
  authMethod: "cookie" as const,
  scopes: [],
};

describe("admin BYOK allowlist route", () => {
  beforeEach(() => vi.clearAllMocks());

  test("lists testers for admins with no-store", async () => {
    mockAdmin.mockResolvedValue(cookieAdmin);
    mockList.mockResolvedValue([{ ownerId: "student-1" }] as never);
    const response = await GET(new Request("https://app.test/api/admin/byok-allowlist"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ items: [{ ownerId: "student-1" }] });
  });

  test("grants a tester from a same-origin cookie admin", async () => {
    mockAdmin.mockResolvedValue(cookieAdmin);
    mockGrant.mockResolvedValue({ ownerId: "student-1", email: "bote@example.com" } as never);
    const response = await POST(new Request("https://app.test/api/admin/byok-allowlist", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: JSON.stringify({ email: "bote@example.com" }),
    }));
    expect(response.status).toBe(200);
    expect(mockGrant).toHaveBeenCalledWith({
      actorId: "admin-1",
      email: "bote@example.com",
      dailyBudgetUsd: undefined,
      maxConcurrentJobs: undefined,
    });
  });

  test("rejects cross-origin and API-key grants before mutation", async () => {
    mockAdmin.mockResolvedValue(cookieAdmin);
    const crossOrigin = await POST(new Request("https://app.test/api/admin/byok-allowlist", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.test" },
      body: JSON.stringify({ email: "bote@example.com" }),
    }));
    expect(crossOrigin.status).toBe(403);
    expect(mockGrant).not.toHaveBeenCalled();

    mockAdmin.mockResolvedValue({ ...cookieAdmin, authMethod: "api_key" });
    const apiKey = await POST(new Request("https://app.test/api/admin/byok-allowlist", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: JSON.stringify({ email: "bote@example.com" }),
    }));
    expect(apiKey.status).toBe(403);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  test("revokes a database tester", async () => {
    mockAdmin.mockResolvedValue(cookieAdmin);
    mockRevoke.mockResolvedValue({ ownerId: "student-1", stillAllowed: false });
    const response = await DELETE(new Request("https://app.test/api/admin/byok-allowlist", {
      method: "DELETE",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: JSON.stringify({ ownerId: "student-1" }),
    }));
    expect(response.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledWith({
      actorId: "admin-1",
      ownerId: "student-1",
    });
  });
});
