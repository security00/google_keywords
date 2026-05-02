import { describe, test, expect } from "vitest";
import { scoreKeyword, batchScoreKeywords } from "./rule-engine";

describe("scoreKeyword", () => {
  // --- Hard blocks ---
  describe("blocks", () => {
    test.each([
      ["", "too_short"],
      ["ab", "too_short"],
      ["12345", "pure_number"],
      ["what is AI?", "question"],
      ["casino online", "gambling"],
      ["trump news", "politics"],
      ["porn site", "adult"],
      ["example.com", "domain_spam"],
      ["login page", "auth_page"],
      ["word meaning", "dictionary_query"],
      ["new york city", "place"],
      ["man arrested", "news_event"],
      ["wordle answer", "exam_or_puzzle"],
      ["bitcoin trading", "finance"],
      ["nba draft", "sports_or_game"],
      ["chelsea fc", "sports_team"],
      ["promo code free", "coupon_or_code"],
      ["how to build", "generic_query"],
      ["netflix movie trailer", "entertainment"],
    ])("blocks '%s' → reason: %s", (kw, reason) => {
      const r = scoreKeyword(kw);
      expect(r.action).toBe("block");
      expect(r.reason).toBe(reason);
      expect(r.score).toBeLessThan(0);
    });
  });

  // --- Length boundaries ---
  describe("length boundaries", () => {
    test("3 chars is allowed", () => {
      expect(scoreKeyword("abc").action).not.toBe("block");
    });

    test("2 chars is blocked", () => {
      expect(scoreKeyword("ab").action).toBe("block");
    });

    test("60 chars is allowed", () => {
      const kw = "a".repeat(60);
      expect(scoreKeyword(kw).action).not.toBe("block");
    });

    test("61 chars is blocked", () => {
      const kw = "a".repeat(61);
      expect(scoreKeyword(kw).action).toBe("block");
    });

    test("7 words is blocked", () => {
      expect(scoreKeyword("one two three four five six seven").action).toBe("block");
    });

    test("6 words is allowed", () => {
      expect(scoreKeyword("one two three four five six").action).not.toBe("block");
    });
  });

  // --- Positive signals ---
  describe("positive scoring", () => {
    test("tool keyword gets +40", () => {
      const r = scoreKeyword("pdf converter");
      expect(r.action).toBe("keep");
      expect(r.score).toBeGreaterThanOrEqual(40);
    });

    test("AI keyword gets +35", () => {
      const r = scoreKeyword("ai assistant");
      expect(r.action).toBe("keep");
      expect(r.score).toBeGreaterThanOrEqual(35);
    });

    test("AI + tool combo gets bonus", () => {
      const r = scoreKeyword("ai image generator");
      // tool(40) + ai(35) + bonus(20) + compound(10) = 105
      expect(r.score).toBeGreaterThanOrEqual(95);
    });

    test("SaaS pattern gets +20", () => {
      const r = scoreKeyword("workflow platform");
      expect(r.score).toBeGreaterThanOrEqual(20);
    });

    test("free/online gets +10", () => {
      const r = scoreKeyword("free resource");
      expect(r.score).toBeGreaterThanOrEqual(10);
    });

    test("2-4 word compound gets +10", () => {
      const base = scoreKeyword("uncommonword");
      const compound = scoreKeyword("uncommonword thing");
      expect(compound.score).toBeGreaterThan(base.score);
    });
  });

  // --- Demotions ---
  describe("demotions", () => {
    test("medical keyword is demoted", () => {
      const r = scoreKeyword("symptom checker guide");
      // "symptom" triggers medical demote, but "checker" triggers tool +40
      // The block/demote checks run before positive scoring, so medical demote returns early
      expect(r.action).toBe("demote");
      expect(r.reason).toBe("medical");
    });

    test("neutral keyword is demoted with score -10", () => {
      const r = scoreKeyword("randomthing");
      expect(r.action).toBe("demote");
      expect(r.reason).toBe("neutral");
      expect(r.score).toBe(-10);
    });
  });

  // --- Edge cases ---
  describe("edge cases", () => {
    test("whitespace-only is blocked", () => {
      expect(scoreKeyword("   ").action).toBe("block");
    });

    test("mixed case is handled", () => {
      const r = scoreKeyword("AI Image GENERATOR");
      expect(r.action).toBe("keep");
      expect(r.score).toBeGreaterThanOrEqual(95);
    });
  });
});

describe("batchScoreKeywords", () => {
  test("separates kept and blocked", () => {
    const { kept, blocked } = batchScoreKeywords([
      "casino",
      "ai tool builder",
      "free converter",
    ]);
    expect(blocked).toContain("casino");
    expect(kept).toHaveLength(2);
    expect(kept.every((k) => k.keyword !== "casino")).toBe(true);
  });

  test("kept is sorted by score descending", () => {
    const { kept } = batchScoreKeywords([
      "randomthing",
      "ai tool builder",
      "free converter",
    ]);
    for (let i = 1; i < kept.length; i++) {
      expect(kept[i - 1].score).toBeGreaterThanOrEqual(kept[i].score);
    }
  });

  test("empty input returns empty results", () => {
    const { kept, blocked } = batchScoreKeywords([]);
    expect(kept).toHaveLength(0);
    expect(blocked).toHaveLength(0);
  });
});
