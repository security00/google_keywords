import { afterEach, describe, expect, test, vi } from "vitest";

import { trackGaEvent } from "./analytics";

describe("trackGaEvent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("no-ops when gtag is missing", () => {
    vi.stubGlobal("window", {});
    expect(() => trackGaEvent("sign_up")).not.toThrow();
  });

  test("forwards conversion events to gtag", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag });
    trackGaEvent("begin_checkout", { currency: "USD", value: 49 });
    expect(gtag).toHaveBeenCalledWith("event", "begin_checkout", {
      currency: "USD",
      value: 49,
    });
  });
});
