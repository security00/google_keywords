import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mockExchangeGoogleCode = vi.hoisted(() => vi.fn());
const mockFetchGoogleUserInfo = vi.hoisted(() => vi.fn());
const mockFindUserByIdentity = vi.hoisted(() => vi.fn());
const mockFindUserByEmail = vi.hoisted(() => vi.fn());
const mockCreatePendingOAuthUser = vi.hoisted(() => vi.fn());
const mockLinkOAuthIdentity = vi.hoisted(() => vi.fn());
const mockCreateSession = vi.hoisted(() => vi.fn());
const mockSetSessionCookie = vi.hoisted(() => vi.fn((response) => response));

vi.mock("@/lib/google-oauth", () => ({
  exchangeGoogleCode: mockExchangeGoogleCode,
  fetchGoogleUserInfo: mockFetchGoogleUserInfo,
  GOOGLE_OAUTH_RETURN_COOKIE: "gk_google_oauth_return",
  GOOGLE_OAUTH_STATE_COOKIE: "gk_google_oauth_state",
}));

vi.mock("@/lib/auth", () => ({
  findUserByIdentity: mockFindUserByIdentity,
  findUserByEmail: mockFindUserByEmail,
  createPendingOAuthUser: mockCreatePendingOAuthUser,
  linkOAuthIdentity: mockLinkOAuthIdentity,
  createSession: mockCreateSession,
  setSessionCookie: mockSetSessionCookie,
}));

const { GET } = await import("./route");

const googleRequest = () =>
  new NextRequest("https://discoverkeywords.co/api/auth/google/callback?code=code-1&state=state-1", {
    headers: {
      cookie: "gk_google_oauth_state=state-1",
    },
  });

const googleCheckoutRequest = () =>
  new NextRequest("https://discoverkeywords.co/api/auth/google/callback?code=code-1&state=state-1", {
    headers: {
      cookie: "gk_google_oauth_state=state-1; gk_google_oauth_return=/pricing?checkout=founding",
    },
  });

describe("GET /api/auth/google/callback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockExchangeGoogleCode.mockReset();
    mockFetchGoogleUserInfo.mockReset();
    mockFindUserByIdentity.mockReset();
    mockFindUserByEmail.mockReset();
    mockCreatePendingOAuthUser.mockReset();
    mockLinkOAuthIdentity.mockReset();
    mockCreateSession.mockReset();
    mockSetSessionCookie.mockClear();

    mockExchangeGoogleCode.mockResolvedValue("access-token");
    mockFetchGoogleUserInfo.mockResolvedValue({
      sub: "google-sub-1",
      email: "Student@Gmail.com",
      email_verified: true,
    });
    mockFindUserByIdentity.mockResolvedValue(null);
    mockCreateSession.mockResolvedValue({
      token: "session-token",
      expiresAt: new Date("2026-08-01T00:00:00Z"),
    });
  });

  test("links a verified Google account to an existing local email user", async () => {
    mockFindUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "student@gmail.com",
      role: "student",
    });

    const response = await GET(googleRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://discoverkeywords.co/dashboard/expand");
    expect(mockCreatePendingOAuthUser).not.toHaveBeenCalled();
    expect(mockLinkOAuthIdentity).toHaveBeenCalledWith({
      userId: "user-1",
      provider: "google",
      providerSubject: "google-sub-1",
      providerEmail: "Student@Gmail.com",
      emailVerified: true,
    });
    expect(mockCreateSession).toHaveBeenCalledWith("user-1");
    expect(mockSetSessionCookie).toHaveBeenCalledWith(response, "session-token");
  });

  test("creates a pending local student account for a new verified Google email", async () => {
    mockFindUserByEmail.mockResolvedValue(null);
    mockCreatePendingOAuthUser.mockResolvedValue({
      id: "user-new",
      email: "student@gmail.com",
      role: "student",
    });

    await GET(googleRequest());

    expect(mockCreatePendingOAuthUser).toHaveBeenCalledWith("Student@Gmail.com");
    expect(mockLinkOAuthIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-new",
        provider: "google",
        providerSubject: "google-sub-1",
        emailVerified: true,
      })
    );
  });

  test("redirects Google checkout intent back to pricing auto-checkout", async () => {
    mockFindUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "student@gmail.com",
      role: "student",
    });

    const response = await GET(googleCheckoutRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://discoverkeywords.co/pricing?checkout=founding");
  });

  test("rejects unverified Google emails", async () => {
    mockFetchGoogleUserInfo.mockResolvedValue({
      sub: "google-sub-1",
      email: "student@gmail.com",
      email_verified: false,
    });

    const response = await GET(googleRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?error=Google+email+is+not+verified");
    expect(mockLinkOAuthIdentity).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});
