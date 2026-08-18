import { describe, expect, test } from "vitest";

import sitemap from "./sitemap";

describe("sitemap", () => {
  test("keeps marketing URLs and omits auth pages", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://discoverkeywords.co");
    expect(urls).toContain("https://discoverkeywords.co/pricing");
    expect(urls).not.toContain("https://discoverkeywords.co/login");
    expect(urls).not.toContain("https://discoverkeywords.co/register");
  });
});
