import { beforeEach, describe, expect, test, vi } from "vitest";

const mockCreateUser = vi.hoisted(() => vi.fn());
const mockCreateSession = vi.hoisted(() => vi.fn());
const mockSetSessionCookie = vi.hoisted(() => vi.fn());
const mockValidateInviteCode = vi.hoisted(() => vi.fn());
const mockConsumeInviteCode = vi.hoisted(() => vi.fn());
const mockRejectIfAuthRateLimited = vi.hoisted(() => vi.fn());
const mockRejectInvalidTurnstile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  createUser: mockCreateUser,
  createSession: mockCreateSession,
  setSessionCookie: mockSetSessionCookie,
}));

vi.mock("@/lib/usage", () => ({
  validateInviteCode: mockValidateInviteCode,
  consumeInviteCode: mockConsumeInviteCode,
}));

vi.mock("@/lib/auth-rate-limit", () => ({
  rejectIfAuthRateLimited: mockRejectIfAuthRateLimited,
}));

vi.mock("@/lib/turnstile", () => ({
  rejectInvalidTurnstile: mockRejectInvalidTurnstile,
}));

const { POST } = await import("./route");

const postSignUp = (body: Record<string, unknown>) =>
  POST(
    new Request("https://discoverkeywords.co/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

describe("POST /api/auth/sign-up", () => {
  beforeEach(() => {
    mockCreateUser.mockReset();
    mockCreateSession.mockReset();
    mockSetSessionCookie.mockReset();
    mockValidateInviteCode.mockReset();
    mockConsumeInviteCode.mockReset();
    mockRejectIfAuthRateLimited.mockReset();
    mockRejectInvalidTurnstile.mockReset();
    mockRejectIfAuthRateLimited.mockResolvedValue(null);
    mockRejectInvalidTurnstile.mockResolvedValue(null);
    mockSetSessionCookie.mockImplementation((response) => response);
  });

  test("returns 429 before creating a user when rate limited", async () => {
    mockRejectIfAuthRateLimited.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "尝试次数过多，请稍后再试" }), { status: 429 })
    );

    const response = await postSignUp({
      email: "student@example.com",
      password: "password12",
      inviteCode: "SK-TEST-CODE",
    });

    expect(response.status).toBe(429);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  test("hides whether an email is already registered", async () => {
    mockValidateInviteCode.mockResolvedValueOnce({ valid: true });
    mockCreateUser.mockRejectedValueOnce(new Error("该邮箱已注册"));

    const response = await postSignUp({
      email: "student@example.com",
      password: "password12",
      inviteCode: "SK-TEST-CODE",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "无法完成注册。请尝试登录或使用其他邮箱。",
    });
  });

  test("still requires an invite code for public sign-up", async () => {
    const response = await postSignUp({
      email: "student@example.com",
      password: "password12",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "请输入邀请码" });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });
});
