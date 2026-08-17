import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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

vi.mock("@/lib/lifecycle-emails", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue("sent"),
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
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_SIGNUP_ENABLED", "");
    vi.stubEnv("PUBLIC_SIGNUP_ENABLED", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  test("still requires an invite code while public signup is closed", async () => {
    const response = await postSignUp({
      email: "student@example.com",
      password: "password12",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "请输入邀请码" });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  test("opens a 14-day trial when public signup is enabled and no invite is provided", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_SIGNUP_ENABLED", "true");
    mockCreateUser.mockResolvedValueOnce({
      id: "user-1",
      email: "student@example.com",
      role: "student",
    });
    mockCreateSession.mockResolvedValueOnce({
      token: "session-1",
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    const response = await postSignUp({
      email: "student@example.com",
      password: "password12",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requiresActivation: false,
      message: "注册成功，免费试用 14 天",
    });
    expect(mockValidateInviteCode).not.toHaveBeenCalled();
    expect(mockConsumeInviteCode).not.toHaveBeenCalled();
    expect(mockCreateUser).toHaveBeenCalledWith("student@example.com", "password12", {
      role: "student",
      trialDays: 14,
      activateTrial: true,
    });
  });

  test("keeps the 90-day invite trial even when public signup is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_SIGNUP_ENABLED", "true");
    mockValidateInviteCode.mockResolvedValueOnce({ valid: true });
    mockCreateUser.mockResolvedValueOnce({
      id: "user-2",
      email: "invited@example.com",
      role: "student",
    });
    mockCreateSession.mockResolvedValueOnce({
      token: "session-2",
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    const response = await postSignUp({
      email: "invited@example.com",
      password: "password12",
      inviteCode: "SK-TEST-CODE",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: "注册成功，免费试用 90 天",
    });
    expect(mockCreateUser).toHaveBeenCalledWith("invited@example.com", "password12", {
      role: "student",
      trialDays: 90,
      activateTrial: true,
    });
    expect(mockConsumeInviteCode).toHaveBeenCalledWith("SK-TEST-CODE", "user-2");
  });
});
