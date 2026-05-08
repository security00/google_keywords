import { describe, expect, it } from "vitest";

import {
  buildSemanticKeywordKey,
  groupSemanticKeywordCandidates,
  normalizeKeywords,
} from "./keyword-utils";

describe("keyword utils", () => {
  it("keeps normalizeKeywords exact and case-insensitive", () => {
    expect(normalizeKeywords([" Wordle ", "wordle", "Wordle answer"])).toEqual([
      "Wordle",
      "Wordle answer",
    ]);
  });

  it("builds a conservative semantic key for casing, punctuation, and lightweight game modifiers", () => {
    expect(buildSemanticKeywordKey("  Roblox: Clicker GAME! ").key).toBe("roblox clicker");
    expect(buildSemanticKeywordKey("roblox clicker online").key).toBe("roblox clicker");
    expect(buildSemanticKeywordKey("roblox-clicker").key).toBe("roblox clicker");
  });

  it("does not collapse high-intent modifiers into base game terms", () => {
    expect(buildSemanticKeywordKey("minecraft").key).toBe("minecraft");
    expect(buildSemanticKeywordKey("minecraft skins").key).toBe("minecraft skins");
    expect(buildSemanticKeywordKey("wordle").key).toBe("wordle");
    expect(buildSemanticKeywordKey("wordle answer").key).toBe("wordle answer");
    expect(buildSemanticKeywordKey("planet clicker 2 codes").key).toBe("planet clicker 2 codes");
  });

  it("groups numeric game sequel variants while keeping protected intents separate", () => {
    expect(buildSemanticKeywordKey("planet clicker").key).toBe("planet clicker");
    expect(buildSemanticKeywordKey("planet clicker 2").key).toBe("planet clicker");
    expect(buildSemanticKeywordKey("temple run 2 frozen shadows").key).toBe("temple run 2 frozen shadows");
  });

  it("groups semantic variants with a stable representative and keeps singleton groups out", () => {
    const groups = groupSemanticKeywordCandidates([
      { id: "new", keyword: "Roblox Clicker Online", score: 80, extractedAt: "2026-05-08T10:00:00.000Z" },
      { id: "best", keyword: "Roblox Clicker", score: 95, extractedAt: "2026-05-08T09:00:00.000Z" },
      { id: "danger", keyword: "Roblox Clicker codes", score: 100, extractedAt: "2026-05-08T11:00:00.000Z" },
      { id: "punct", keyword: "roblox-clicker", score: 70, extractedAt: "2026-05-08T08:00:00.000Z" },
      { id: "sequel", keyword: "Planet Clicker 2", score: 65, extractedAt: "2026-05-08T08:00:00.000Z" },
      { id: "base", keyword: "Planet Clicker", score: 60, extractedAt: "2026-05-08T08:00:00.000Z" },
    ]);

    expect(groups).toHaveLength(2);
    const planetGroup = groups.find((group) => group.semanticKey === "planet clicker");
    const robloxGroup = groups.find((group) => group.semanticKey === "roblox clicker");
    expect(planetGroup).toMatchObject({
      semanticKey: "planet clicker",
      representative: { id: "sequel", keyword: "Planet Clicker 2" },
      confidence: "medium",
    });
    expect(robloxGroup).toMatchObject({
      semanticKey: "roblox clicker",
      representative: { id: "best", keyword: "Roblox Clicker" },
      confidence: "high",
    });
    expect(robloxGroup?.variants.map((item) => item.keyword)).toEqual([
      "Roblox Clicker",
      "Roblox Clicker Online",
      "roblox-clicker",
    ]);
  });
});
