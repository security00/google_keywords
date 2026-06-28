import { beforeEach, describe, expect, test, vi } from "vitest";

const mockD1Query = vi.hoisted(() => vi.fn());

vi.mock("@/lib/d1", () => ({
  d1Query: mockD1Query,
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
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("RESEND_API_KEY", "test-resend-key");
    vi.stubEnv("PUBLIC_BASE_URL", "https://discoverkeywords.co");
    mockD1Query.mockReset();
    global.fetch = vi.fn();
  });

  test("does not reveal whether an email is unknown", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [] });

    const response = await postForgotPassword("missing@example.com");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("creates one active token and sends a reset email for an existing user", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [{ id: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("{}", { status: 200 }));

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
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const emailPayload = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(emailPayload.to).toBe("student@example.com");
    expect(emailPayload.html).toContain("https://discoverkeywords.co/reset-password?token=");
  });

  test("retries email delivery and removes the token if all attempts fail", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [{ id: "user-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }))
      .mockResolvedValueOnce(new Response("temporary failure", { status: 503 }));

    const response = await postForgotPassword("student@example.com");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Failed to send email" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockD1Query).toHaveBeenLastCalledWith(
      "DELETE FROM password_reset_tokens WHERE user_id = ? AND token_hash = ?",
      expect.arrayContaining(["user-1"])
    );
  });
});
