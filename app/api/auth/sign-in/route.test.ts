import { beforeEach, describe, expect, test, vi } from "vitest";

const mockValidateUser = vi.hoisted(() => vi.fn());
const mockCreateSession = vi.hoisted(() => vi.fn());
const mockSetSessionCookie = vi.hoisted(() => vi.fn());
const mockRejectIfAuthRateLimited = vi.hoisted(() => vi.fn());
const mockRecordAuthRateLimitFailure = vi.hoisted(() => vi.fn());
const mockRejectInvalidTurnstile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  validateUser: mockValidateUser,
  createSession: mockCreateSession,
  setSessionCookie: mockSetSessionCookie,
}));

vi.mock("@/lib/auth-rate-limit", () => ({
  rejectIfAuthRateLimited: mockRejectIfAuthRateLimited,
  recordAuthRateLimitFailure: mockRecordAuthRateLimitFailure,
}));

vi.mock("@/lib/turnstile", () => ({
  rejectInvalidTurnstile: mockRejectInvalidTurnstile,
}));

const { POST } = await import("./route");

const postSignIn = (body: Record<string, unknown>) =>
  POST(
    new Request("https://discoverkeywords.co/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

describe("POST /api/auth/sign-in", () => {
  beforeEach(() => {
    mockValidateUser.mockReset();
    mockCreateSession.mockReset();
    mockSetSessionCookie.mockReset();
    mockRejectIfAuthRateLimited.mockReset();
    mockRecordAuthRateLimitFailure.mockReset();
    mockRejectInvalidTurnstile.mockReset();
    mockRejectIfAuthRateLimited.mockResolvedValue(null);
    mockRejectInvalidTurnstile.mockResolvedValue(null);
    mockSetSessionCookie.mockImplementation((response) => response);
  });

  test("returns 429 when the client is already blocked", async () => {
    mockRejectIfAuthRateLimited.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "尝试次数过多，请稍后再试" }), { status: 429 })
    );

    const response = await postSignIn({
      email: "student@example.com",
      password: "password12",
    });

    expect(response.status).toBe(429);
    expect(mockValidateUser).not.toHaveBeenCalled();
  });

  test("records a failure and keeps a generic 401 for bad credentials", async () => {
    mockValidateUser.mockResolvedValueOnce(null);

    const response = await postSignIn({
      email: "student@example.com",
      password: "wrong-password",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "邮箱或密码不正确" });
    expect(mockRecordAuthRateLimitFailure).toHaveBeenCalledWith({
      scope: "sign_in",
      request: expect.any(Request),
      email: "student@example.com",
    });
  });

  test("creates a session after a successful password check", async () => {
    mockValidateUser.mockResolvedValueOnce({ id: "user-1", email: "student@example.com" });
    mockCreateSession.mockResolvedValueOnce({
      token: "session-token",
      expiresAt: new Date("2026-08-18T00:00:00.000Z"),
    });

    const response = await postSignIn({
      email: "student@example.com",
      password: "password12",
    });

    expect(response.status).toBe(200);
    expect(mockRecordAuthRateLimitFailure).not.toHaveBeenCalled();
    expect(mockSetSessionCookie).toHaveBeenCalledWith(expect.any(Response), "session-token");
  });
});
