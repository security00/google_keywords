import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(async () => ({ rows: [{ id: "poki" }] })),
}));

import { d1Query } from "@/lib/d1";
import { updateGameRadarSource } from "@/lib/game-radar-sources";

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
});
