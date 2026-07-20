import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { d1Query } from "./d1";
import { buildCacheKey, getCached, setCache } from "./cache";

vi.mock("./d1", () => ({
  d1Query: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);

describe("buildCacheKey", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("includes date, queryType, and sorted keywords", () => {
    const key = buildCacheKey("search", ["tool", "ai"]);
    expect(key).toBe("2026-05-02:search:ai,tool");
  });

  test("keyword order does not matter (deterministic)", () => {
    const a = buildCacheKey("search", ["z", "a", "m"]);
    const b = buildCacheKey("search", ["a", "m", "z"]);
    expect(a).toBe(b);
  });

  test("different query types produce different keys", () => {
    const a = buildCacheKey("expand", ["ai"]);
    const b = buildCacheKey("compare", ["ai"]);
    expect(a).not.toBe(b);
  });

  test("extra params are appended sorted", () => {
    const key = buildCacheKey("search", ["ai"], { location: "us", lang: "en" });
    expect(key).toBe("2026-05-02:search:ai:lang=en,location=us");
  });

  test("no extra params means no trailing colon", () => {
    const key = buildCacheKey("search", ["ai"]);
    expect(key).not.toContain("::");
  });

  test("single keyword works", () => {
    const key = buildCacheKey("expand", ["gpt"]);
    expect(key).toBe("2026-05-02:expand:gpt");
  });

  test("empty keywords array", () => {
    const key = buildCacheKey("expand", []);
    expect(key).toBe("2026-05-02:expand:");
  });
});

describe("versioned cache storage", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("writes a full SHA-256 identity with explicit metadata and expiry", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [], meta: { changes: 1 } });

    await setCache("logical-key", { value: 1 }, {
      namespace: "expand-result",
    });

    const [sql, params] = mockD1Query.mock.calls[0];
    expect(String(sql)).toContain("namespace, cache_version, cache_scope");
    expect(params?.[0]).toMatch(/^cache_v2_[0-9a-f]{64}$/);
    expect(params?.[2]).toBe("expand-result");
    expect(params?.[3]).toBe("logical-key");
    expect(params?.[6]).toBe("expand-result");
    expect(params?.[7]).toBe(2);
    expect(params?.[8]).toBe("shared");
    expect(params?.[9]).toBe("");
    expect(params?.[10]).toBe(String(params?.[0]).replace("cache_v2_", ""));
    expect(params?.[11]).toBe("2026-07-21T12:00:00.000Z");
  });

  test("partitions private cache identities by owner and never reads legacy rows", async () => {
    mockD1Query.mockResolvedValue({ rows: [] });

    await getCached("logical-key", {
      namespace: "provider-direct",
      scope: { type: "private", ownerId: "user-1" },
    });
    await getCached("logical-key", {
      namespace: "provider-direct",
      scope: { type: "private", ownerId: "user-2" },
    });

    expect(mockD1Query).toHaveBeenCalledTimes(2);
    expect(mockD1Query.mock.calls[0][1]?.[0]).not.toBe(
      mockD1Query.mock.calls[1][1]?.[0],
    );
    expect(mockD1Query.mock.calls[0][1]?.[4]).toBe("user-1");
    expect(mockD1Query.mock.calls[1][1]?.[4]).toBe("user-2");
  });

  test("keeps a bounded shared-only fallback for legacy cache rows", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "legacy-1",
            cache_key: "logical-key",
            response_data: '{"value":2}',
            created_at: "2026-07-20T11:00:00.000Z",
          },
        ],
      });

    const cached = await getCached<{ value: number }>("logical-key", {
      namespace: "expand-result",
    });

    expect(cached).toEqual({ value: 2 });
    expect(mockD1Query).toHaveBeenCalledTimes(2);
    expect(String(mockD1Query.mock.calls[1][0])).toContain(
      "namespace = 'legacy'",
    );
    expect(String(mockD1Query.mock.calls[1][0])).toContain(
      "cache_scope = 'shared'",
    );
  });
});
