import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(async () => ({ rows: [{ id: "poki" }] })),
}));

import { d1Query } from "@/lib/d1";
import { analyzeGameRadarSource, upsertGameRadarSource, updateGameRadarSource } from "@/lib/game-radar-sources";

describe("updateGameRadarSource", () => {
  it("updates enabled state and note", async () => {
    await updateGameRadarSource({ id: "poki", enabled: false, statusNote: "pause" });

    expect(d1Query).toHaveBeenCalledWith(
      expect.stringContaining("enabled = ?"),
      [0, "pause", "poki"]
    );
  });

  it("rejects invalid quality tier", async () => {
    await expect(updateGameRadarSource({ id: "poki", qualityTier: 0 })).rejects.toThrow("Invalid quality tier");
  });

  it("analyzes source url samples", async () => {
    const analysis = analyzeGameRadarSource({
      baseUrl: "https://poki.com",
      sitemapUrl: "https://poki.com/en/sitemaps/games.xml",
      urls: [
        "https://poki.com/en/g/wheel-master",
        "https://poki.com/en/g/bubble-tower",
        "https://poki.com/en/category/action",
        "https://poki.com/privacy",
      ],
      lastmodCount: 2,
    });

    expect(analysis.urlIncludePatterns).toBe('["/en/g/"]');
    expect(analysis.urlExcludePatterns).toContain("/category/");
    expect(analysis.keywordExtractRule).toBe('{"type":"slug","stripPrefix":"/en/g/"}');
    expect(analysis.statusNote).toContain("lastmod");
  });

  it("upserts a curated source", async () => {
    await upsertGameRadarSource({
      id: "y8",
      name: "Y8",
      baseUrl: "https://www.y8.com",
      sitemapUrl: "https://www.y8.com/sitemap.xml",
      enabled: true,
      qualityTier: 2,
      urlIncludePatterns: '["/games/"]',
      urlExcludePatterns: '["/tags/"]',
      keywordExtractRule: '{"type":"slug"}',
      statusNote: "test source",
    });

    expect(d1Query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO game_radar_sources"),
      expect.arrayContaining(["y8", "Y8", "https://www.y8.com", "https://www.y8.com/sitemap.xml", 1, 2])
    );
  });
});
