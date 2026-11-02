import { describe, expect, test } from "vitest";

import { GAME_TREND_SCANNER_MAX_SILENCE_MS, gameTrendScannerSilence } from "./admin_health";

describe("gameTrendScannerSilence", () => {
  const now = Date.parse("2026-11-02T13:00:00Z");

  test("alerts when the scanner has never succeeded", () => {
    const alert = gameTrendScannerSilence(null, now);
    expect(alert.stale).toBe(true);
    expect(alert.pipeline).toBe("game-trend-scanner");
  });

  test("alerts after 36 hours without a successful run", () => {
    const last = new Date(now - GAME_TREND_SCANNER_MAX_SILENCE_MS - 60_000).toISOString();
    expect(gameTrendScannerSilence(last, now).stale).toBe(true);
  });

  test("stays quiet inside the 36 hour window", () => {
    const last = new Date(now - 12 * 60 * 60 * 1000).toISOString();
    expect(gameTrendScannerSilence(last, now).stale).toBe(false);
  });
});
