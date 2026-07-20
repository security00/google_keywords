import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import { getEffectiveEntitlement } from "@/lib/entitlements";
import {
  generateApiKey,
  listApiKeys,
  validateApiKey,
} from "./api_keys";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

vi.mock("@/lib/entitlements", () => ({
  getEffectiveEntitlement: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);
const mockEntitlement = vi.mocked(getEffectiveEntitlement);

describe("API key security", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
    mockEntitlement.mockReset();
  });

  test("persists invalid attempts using a hashed client fingerprint", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const request = new Request("https://example.com/api/me", {
      headers: {
        "cf-connecting-ip": "203.0.113.9",
        "user-agent": "test-agent",
      },
    });

    const result = await validateApiKey("invalid", request);

    expect(result).toEqual({ valid: false, error: "Invalid API key" });
    expect(String(mockD1Query.mock.calls[2][0])).toContain(
      "api_key_auth_failures",
    );
    const storedFingerprint = String(mockD1Query.mock.calls[2][1]?.[0]);
    expect(storedFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(storedFingerprint).not.toContain("203.0.113.9");
  });

  test("returns role and scopes for an entitled API key", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [{ blocked_until: null }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            user_id: "user-1",
            expires_at: null,
            role: "student",
            scopes: '["cache:read"]',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    mockEntitlement.mockResolvedValue({
      allowed: true,
      source: "stripe",
      planKey: "founding",
      status: "active",
      expiresAt: "2026-08-01T00:00:00Z",
    });

    const result = await validateApiKey(
      `gk_live_${"a".repeat(32)}`,
      new Request("https://example.com/api/me"),
    );

    expect(result).toMatchObject({
      valid: true,
      userId: "user-1",
      apiKeyId: 7,
      role: "student",
      scopes: ["cache:read"],
    });
    expect(String(mockD1Query.mock.calls[2][0])).toContain("DELETE FROM");
  });

  test("new keys default to cache-only scope", async () => {
    mockEntitlement.mockResolvedValue({
      allowed: true,
      source: "stripe",
      planKey: "founding",
      status: "active",
      expiresAt: "2026-08-01T00:00:00Z",
    });
    mockD1Query
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const key = await generateApiKey("user-1", "automation");

    expect(key).toMatch(/^gk_live_[0-9a-f]{32}$/);
    const insertParams = mockD1Query.mock.calls[2][1] ?? [];
    expect(insertParams.at(-1)).toBe('["cache:read"]');
    expect(String(insertParams[0])).toMatch(/^hash:[0-9a-f]{64}$/);
  });

  test("lists masked keys with parsed scopes", async () => {
    mockD1Query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          key_prefix: "gk_live_abcd",
          key_last4: "1234",
          name: "default",
          created_at: "2026-07-20T00:00:00Z",
          expires_at: null,
          active: 1,
          scopes: '["cache:read"]',
        },
      ],
    });

    const keys = await listApiKeys("user-1");

    expect(keys[0]).toMatchObject({
      key: "gk_live_abcd...1234",
      scopes: ["cache:read"],
    });
  });
});
