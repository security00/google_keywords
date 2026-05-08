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
  });

  it("groups semantic variants with a stable representative and keeps singleton groups out", () => {
    const groups = groupSemanticKeywordCandidates([
      { id: "new", keyword: "Roblox Clicker Online", score: 80, extractedAt: "2026-05-08T10:00:00.000Z" },
      { id: "best", keyword: "Roblox Clicker", score: 95, extractedAt: "2026-05-08T09:00:00.000Z" },
      { id: "danger", keyword: "Roblox Clicker codes", score: 100, extractedAt: "2026-05-08T11:00:00.000Z" },
      { id: "punct", keyword: "roblox-clicker", score: 70, extractedAt: "2026-05-08T08:00:00.000Z" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      semanticKey: "roblox clicker",
      representative: { id: "best", keyword: "Roblox Clicker" },
      confidence: "high",
    });
    expect(groups[0].variants.map((item) => item.keyword)).toEqual([
      "Roblox Clicker",
      "Roblox Clicker Online",
      "roblox-clicker",
    ]);
  });
});
