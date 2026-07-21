import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import {
  PROVIDER_VERIFY_MAX_ATTEMPTS,
  ProviderVerificationRateLimitError,
  claimProviderVerificationAttempt,
} from "./verification-rate-limit";

vi.mock("@/lib/d1", () => ({ d1Query: vi.fn() }));

const mockD1Query = vi.mocked(d1Query);

describe("Provider verification rate limit", () => {
  beforeEach(() => vi.clearAllMocks());

  test("claims an owner/provider attempt with one atomic upsert", async () => {
    mockD1Query.mockResolvedValue({
      rows: [{ attempt_count: 1, blocked_until: null }],
    });

    const result = await claimProviderVerificationAttempt(
      "owner-1",
      "openrouter",
      new Date("2026-07-21T00:00:00.000Z"),
    );

    const [sql, params] = mockD1Query.mock.calls[0];
    expect(sql).toContain("ON CONFLICT(owner_id, provider) DO UPDATE");
    expect(sql).toContain("RETURNING attempt_count, blocked_until");
    expect(params).toContain(PROVIDER_VERIFY_MAX_ATTEMPTS);
    expect(result).toEqual({ allowed: true, attemptCount: 1, blockedUntil: null });
  });

  test("returns a persistent block without another Provider decision", async () => {
    mockD1Query.mockResolvedValue({
      rows: [{
        attempt_count: 4,
        blocked_until: "2026-07-21T00:15:00.000Z",
      }],
    });

    await expect(claimProviderVerificationAttempt(
      "owner-1",
      "openrouter",
      new Date("2026-07-21T00:01:00.000Z"),
    )).resolves.toMatchObject({ allowed: false, attemptCount: 4 });
  });

  test("maps D1 failures to a stable error", async () => {
    mockD1Query.mockRejectedValue(new Error("SQL and credential-shaped noise"));

    await expect(claimProviderVerificationAttempt("owner-1", "openrouter"))
      .rejects.toBeInstanceOf(ProviderVerificationRateLimitError);
  });
});
