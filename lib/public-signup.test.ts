import { afterEach, describe, expect, test, vi } from "vitest";

import { PUBLIC_SIGNUP_TRIAL_DAYS, isPublicSignupEnabled, publicSignupCta } from "./public-signup";

describe("public signup flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("stays closed unless the public flag is explicitly true", () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_SIGNUP_ENABLED", "");
    expect(isPublicSignupEnabled()).toBe(false);
    expect(publicSignupCta()).toBe("Request access");
    expect(PUBLIC_SIGNUP_TRIAL_DAYS).toBe(14);
  });

  test("opens the short trial CTA when the public flag is on", () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_SIGNUP_ENABLED", "true");
    expect(isPublicSignupEnabled()).toBe(true);
    expect(publicSignupCta()).toBe("Start free trial");
  });
});
