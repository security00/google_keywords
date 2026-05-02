import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { buildCacheKey } from "./cache";

describe("buildCacheKey", () => {
  beforeEach(() => {
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
