import { beforeEach, describe, expect, test, vi } from "vitest";

const mockD1Query = vi.hoisted(() => vi.fn());
const mockRejectIfAuthRateLimited = vi.hoisted(() => vi.fn());
const mockRejectInvalidTurnstile = vi.hoisted(() => vi.fn());
const mockGetCloudflareContext = vi.hoisted(() => vi.fn());

vi.mock("@/lib/d1", () => ({
  d1Query: mockD1Query,
}));

vi.mock("@/lib/auth-rate-limit", () => ({
  rejectIfAuthRateLimited: mockRejectIfAuthRateLimited,
}));

vi.mock("@/lib/turnstile", () => ({
  rejectInvalidTurnstile: mockRejectInvalidTurnstile,
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: mockGetCloudflareContext,
}));

const { POST } = await import("./route");

const postForgotPassword = (email: unknown) =>
  POST(
    new Request("https://discoverkeywords.co/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }) as never
  );

describe("POST /api/auth/forgot-password", () => {
  const mockInboxFetch = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("PUBLIC_BASE_URL", "https://discoverkeywords.co");
    mockD1Query.mockReset();
    mockRejectIfAuthRateLimited.mockReset();
    mockRejectInvalidTurnstile.mockReset();
    mockGetCloudflareContext.mockReset();
    mockInboxFetch.mockReset();
    mockRejectIfAuthRateLimited.mockResolvedValue(null);
    mockRejectInvalidTurnstile.mockResolvedValue(null);
    mockGetCloudflareContext.mockResolvedValue({
      env: {
        INBOX: {
          fetch: mockInboxFetch,
        },
      },
    });
  });

  test("returns the same accepted payload for an unregistered email", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [] });

    const response = await postForgotPassword("missing@example.com");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mockInboxFetch).not.toHaveBeenCalled();
  });

  test("creates one active token and sends a reset email for an existing user", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [{ id: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockInboxFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "email-1", status: "sent" }), { status: 202 })
    );

    const response = await postForgotPassword(" Student@Example.COM ");

    expect(response.status).toBe(200);
    expect(mockD1Query).toHaveBeenNthCalledWith(
      1,
      "SELECT id FROM auth_users_v2 WHERE email = ?",
      ["student@example.com"]
    );
    expect(mockD1Query).toHaveBeenNthCalledWith(
      2,
      "DELETE FROM password_reset_tokens WHERE user_id = ? AND used = 0",
      ["user-1"]
    );
    expect(mockD1Query).toHaveBeenNthCalledWith(
      3,
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
      expect.arrayContaining(["user-1"])
    );
    expect(mockInboxFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockInboxFetch.mock.calls[0];
    expect(url).toBe("https://inbox.internal/api/v1/mailboxes/support@discoverkeywords.co/emails");
    expect(options.method).toBe("POST");
    const emailPayload = JSON.parse(String(options.body));
    expect(emailPayload.to).toBe("student@example.com");
    expect(emailPayload.from).toEqual({
      email: "support@discoverkeywords.co",
      name: "DiscoverKeywords",
    });
    expect(emailPayload.html).toContain("https://discoverkeywords.co/reset-password?token=");
  });

  test("retries email delivery and removes the token if all attempts fail", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [{ id: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockInboxFetch
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }));

    const response = await postForgotPassword("student@example.com");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Failed to send email" });
    expect(mockInboxFetch).toHaveBeenCalledTimes(2);
    expect(mockD1Query).toHaveBeenLastCalledWith(
      "DELETE FROM password_reset_tokens WHERE user_id = ? AND token_hash = ?",
      expect.arrayContaining(["user-1"])
    );
  });

  test("returns 429 before looking up the user when rate limited", async () => {
    mockRejectIfAuthRateLimited.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "尝试次数过多，请稍后再试" }), { status: 429 })
    );

    const response = await postForgotPassword("student@example.com");

    expect(response.status).toBe(429);
    expect(mockD1Query).not.toHaveBeenCalled();
    expect(mockInboxFetch).not.toHaveBeenCalled();
  });
});
