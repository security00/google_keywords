import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(async () => ({ rows: [{ id: "poki" }] })),
}));

import { d1Query } from "@/lib/d1";
import { upsertGameRadarSource, updateGameRadarSource } from "@/lib/game-radar-sources";

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
