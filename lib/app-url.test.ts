import { afterEach, describe, expect, test, vi } from "vitest";

import { appBaseUrl } from "./app-url";

describe("appBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("uses the runtime APP_URL instead of a baked localhost public URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("APP_URL", "https://www.discoverkeywords.co");

    expect(appBaseUrl()).toBe("https://www.discoverkeywords.co");
  });

  test("ignores a localhost APP_URL and falls back to the public site", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("PUBLIC_BASE_URL", "");

    expect(appBaseUrl()).toBe("https://www.discoverkeywords.co");
  });
});
