import { beforeEach, describe, expect, test, vi } from "vitest";

const mockD1Query = vi.hoisted(() => vi.fn());
const mockCreatePasswordHash = vi.hoisted(() => vi.fn());
const mockRevokeUserSessions = vi.hoisted(() => vi.fn());
const mockRejectIfAuthRateLimited = vi.hoisted(() => vi.fn());
const mockRejectInvalidTurnstile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/d1", () => ({
  d1Query: mockD1Query,
}));

vi.mock("@/lib/auth", () => ({
  createPasswordHash: mockCreatePasswordHash,
  revokeUserSessions: mockRevokeUserSessions,
}));

vi.mock("@/lib/auth-rate-limit", () => ({
  rejectIfAuthRateLimited: mockRejectIfAuthRateLimited,
}));

vi.mock("@/lib/turnstile", () => ({
  rejectInvalidTurnstile: mockRejectInvalidTurnstile,
}));

const { POST } = await import("./route");

const postResetPassword = (body: Record<string, unknown>) =>
  POST(
    new Request("https://discoverkeywords.co/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  );

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
    mockCreatePasswordHash.mockReset();
    mockRevokeUserSessions.mockReset();
    mockRejectIfAuthRateLimited.mockReset();
    mockRejectInvalidTurnstile.mockReset();
    mockRejectIfAuthRateLimited.mockResolvedValue(null);
    mockRejectInvalidTurnstile.mockResolvedValue(null);
  });

  test("returns 429 before reading the reset token when rate limited", async () => {
    mockRejectIfAuthRateLimited.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "尝试次数过多，请稍后再试" }), { status: 429 })
    );

    const response = await postResetPassword({
      token: "reset-token",
      newPassword: "new-password",
    });

    expect(response.status).toBe(429);
    expect(mockD1Query).not.toHaveBeenCalled();
  });

  test("rejects passwords shorter than 8 characters", async () => {
    const response = await postResetPassword({
      token: "reset-token",
      newPassword: "short7",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Password must be at least 8 characters",
    });
    expect(mockD1Query).not.toHaveBeenCalled();
    expect(mockRevokeUserSessions).not.toHaveBeenCalled();
  });

  test("revokes existing sessions after a successful reset", async () => {
    mockD1Query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 11,
            user_id: "user-1",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            used: 0,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    mockCreatePasswordHash.mockResolvedValueOnce("hashed-password");

    const response = await postResetPassword({
      token: "reset-token",
      newPassword: "new-password",
    });

    expect(response.status).toBe(200);
    expect(mockRevokeUserSessions).toHaveBeenCalledWith("user-1");
  });
});
