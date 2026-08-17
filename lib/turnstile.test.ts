import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  TURNSTILE_FAILED_MESSAGE,
  isTurnstileEnforced,
  rejectInvalidTurnstile,
  verifyTurnstileToken,
} from "./turnstile";

describe("Turnstile verification", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("skips siteverify when the secret is not configured", async () => {
    expect(isTurnstileEnforced()).toBe(false);
    await expect(
      verifyTurnstileToken(
        undefined,
        new Request("https://discoverkeywords.co/api/auth/sign-in")
      )
    ).resolves.toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("rejects a missing token once the secret is configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");

    expect(isTurnstileEnforced()).toBe(true);
    const response = await rejectInvalidTurnstile(
      "",
      new Request("https://discoverkeywords.co/api/auth/sign-in")
    );

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: TURNSTILE_FAILED_MESSAGE,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("calls siteverify with the token and client IP", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    const request = new Request("https://discoverkeywords.co/api/auth/sign-in", {
      headers: { "cf-connecting-ip": "203.0.113.8" },
    });

    await expect(verifyTurnstileToken("token-1", request)).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" })
    );
    const body = String(vi.mocked(global.fetch).mock.calls[0][1]?.body);
    expect(body).toContain("secret=test-secret");
    expect(body).toContain("response=token-1");
    expect(body).toContain("remoteip=203.0.113.8");
  });
});
