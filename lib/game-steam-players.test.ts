import { describe, expect, it } from "vitest";

import { parseSteamPlayerCount, reasonWithoutSteamPlayerCount } from "./game-steam-players";

describe("game steam players", () => {
  it("parses the current-player suffix from reason text", () => {
    expect(parseSteamPlayerCount("Steam在线 12,345人 · 14d rising vs gpts")).toBe(12345);
    expect(parseSteamPlayerCount("14d rising vs gpts · Steam在线 263人")).toBe(263);
    expect(parseSteamPlayerCount("Steam在线 0人")).toBe(0);
    expect(parseSteamPlayerCount("14d rising vs gpts")).toBeNull();
    expect(parseSteamPlayerCount(null)).toBeNull();
  });

  it("strips the current-player prefix so truncated reason text stays useful", () => {
    expect(reasonWithoutSteamPlayerCount("Steam在线 12,345人 · 14d rising vs gpts")).toBe(
      "14d rising vs gpts",
    );
    expect(reasonWithoutSteamPlayerCount("14d rising vs gpts")).toBe("14d rising vs gpts");
    expect(reasonWithoutSteamPlayerCount("Steam在线 12,345人")).toBe("");
  });
});
