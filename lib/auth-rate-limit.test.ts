import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import {
  AuthRateLimitPersistenceError,
  consumeAuthRateLimit,
  getClientIp,
  hashAuthRateLimitKey,
  peekAuthRateLimit,
  rejectIfAuthRateLimited,
} from "./auth-rate-limit";

vi.mock("@/lib/d1", () => ({ d1Query: vi.fn() }));

const mockD1Query = vi.mocked(d1Query);

const requestWith = (headers: Record<string, string>, email = "Student@Example.COM") =>
  ({
    request: new Request("https://discoverkeywords.co/api/auth/sign-in", {
      method: "POST",
      headers,
      body: JSON.stringify({ email }),
    }),
    email,
  });

describe("auth rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("prefers cf-connecting-ip over x-forwarded-for", () => {
    const request = new Request("https://discoverkeywords.co/api/auth/sign-in", {
      headers: {
        "cf-connecting-ip": "203.0.113.8",
        "x-forwarded-for": "198.51.100.10, 203.0.113.8",
      },
    });
    expect(getClientIp(request)).toBe("203.0.113.8");
  });

  test("peeks a block without incrementing the counter", async () => {
    mockD1Query.mockResolvedValue({
      rows: [{ attempt_count: 10, blocked_until: "2026-08-17T00:20:00.000Z" }],
    });

    await expect(
      peekAuthRateLimit({
        scope: "sign_in",
        ...requestWith({ "cf-connecting-ip": "203.0.113.8" }),
        now: new Date("2026-08-17T00:10:00.000Z"),
      })
    ).resolves.toBe(false);

    expect(mockD1Query).toHaveBeenCalledTimes(1);
    expect(mockD1Query.mock.calls[0][0]).toContain("SELECT attempt_count, blocked_until");
    expect(mockD1Query.mock.calls[0][1]).toEqual([
      "sign_in",
      "ip",
      hashAuthRateLimitKey("sign_in:ip:203.0.113.8"),
    ]);
  });

  test("claims an attempt with one atomic upsert per dimension", async () => {
    mockD1Query.mockResolvedValue({
      rows: [{ attempt_count: 1, blocked_until: null }],
    });

    const allowed = await consumeAuthRateLimit({
      scope: "sign_up",
      ...requestWith({ "cf-connecting-ip": "203.0.113.8" }),
      now: new Date("2026-08-17T00:00:00.000Z"),
    });

    expect(allowed).toBe(true);
    const writes = mockD1Query.mock.calls.filter(([sql]) =>
      String(sql).includes("ON CONFLICT(scope, dimension, key_hash)")
    );
    expect(writes).toHaveLength(2);
    expect(writes[0][1]).toContain(5);
    expect(writes[1][1]).toEqual(
      expect.arrayContaining([
        "sign_up",
        "email",
        hashAuthRateLimitKey("sign_up:email:student@example.com"),
      ])
    );
  });

  test("maps D1 failures to a stable persistence error", async () => {
    mockD1Query.mockRejectedValue(new Error("SQL noise"));

    await expect(
      consumeAuthRateLimit({
        scope: "forgot_password",
        ...requestWith({ "cf-connecting-ip": "203.0.113.8" }),
      })
    ).rejects.toBeInstanceOf(AuthRateLimitPersistenceError);
  });

  test("returns 429 when a claimed attempt is blocked", async () => {
    mockD1Query.mockResolvedValue({
      rows: [{ attempt_count: 6, blocked_until: "2026-08-17T00:15:00.000Z" }],
    });

    const response = await rejectIfAuthRateLimited({
      scope: "forgot_password",
      ...requestWith({ "cf-connecting-ip": "203.0.113.8" }),
      now: new Date("2026-08-17T00:01:00.000Z"),
    });

    expect(response?.status).toBe(429);
    await expect(response?.json()).resolves.toEqual({
      error: "尝试次数过多，请稍后再试",
    });
  });
});
