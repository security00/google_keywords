import { describe, expect, it } from "vitest";

import { extractKeywordFromUrl, parseSitemapXml } from "./sitemap-utils";

describe("parseSitemapXml", () => {
  it("parses sitemap indexes with namespaces", () => {
    const result = parseSitemapXml(`<?xml version="1.0" encoding="UTF-8"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/games-1.xml</loc></sitemap>
        <sitemap><loc>https://example.com/games-2.xml</loc></sitemap>
      </sitemapindex>`);

    expect(result).toEqual({
      sitemaps: [
        "https://example.com/games-1.xml",
        "https://example.com/games-2.xml",
      ],
      urls: [],
    });
  });

  it("parses URL entries and optional last-modified values", () => {
    const result = parseSitemapXml(`<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
          <loc>https://example.com/games/planet-clicker</loc>
          <lastmod>2026-07-20</lastmod>
        </url>
        <url><loc>https://example.com/games/space-runner</loc></url>
      </urlset>`);

    expect(result.urls).toEqual([
      {
        loc: "https://example.com/games/planet-clicker",
        lastmod: "2026-07-20",
      },
      {
        loc: "https://example.com/games/space-runner",
        lastmod: undefined,
      },
    ]);
  });
});

describe("extractKeywordFromUrl", () => {
  it("keeps existing slug normalization behavior after the parser upgrade", () => {
    expect(
      extractKeywordFromUrl("https://example.com/games/planet-clicker-game"),
    ).toBe("planet clicker");
  });
});
