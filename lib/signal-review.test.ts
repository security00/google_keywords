import { describe, expect, test } from "vitest";

import {
  clampSignalReviewLimit,
  countSignalEvidence,
  normalizeSignalReviewStatus,
  parseSignalSourceLabels,
  signalReviewStatusClause,
} from "./signal-review";

describe("signal review helpers", () => {
  test("normalizes unsupported statuses to pending", () => {
    expect(normalizeSignalReviewStatus("all")).toBe("all");
    expect(normalizeSignalReviewStatus("accepted")).toBe("accepted");
    expect(normalizeSignalReviewStatus("delete")).toBe("pending");
    expect(normalizeSignalReviewStatus(null)).toBe("pending");
  });

  test("builds read-only status clauses", () => {
    expect(signalReviewStatusClause("all")).toEqual({ clause: "", params: [] });
    expect(signalReviewStatusClause("pending")).toEqual({
      clause: "WHERE accepted IS NULL OR accepted = 'pending'",
      params: [],
    });
    expect(signalReviewStatusClause("rejected")).toEqual({
      clause: "WHERE accepted LIKE ?",
      params: ["rejected:%"],
    });
  });

  test("clamps page limits", () => {
    expect(clampSignalReviewLimit(Number.NaN)).toBe(20);
    expect(clampSignalReviewLimit(0)).toBe(1);
    expect(clampSignalReviewLimit(7.8)).toBe(7);
    expect(clampSignalReviewLimit(300)).toBe(100);
  });

  test("parses standardized evidence labels", () => {
    const payload = JSON.stringify({
      evidence: [
        { source_label: "Hacker News" },
        { source_label: "r/sideproject" },
        { source_label: "Hacker News" },
      ],
    });

    expect(parseSignalSourceLabels(payload)).toEqual(["Hacker News", "r/sideproject"]);
    expect(countSignalEvidence(payload)).toBe(3);
  });

  test("keeps legacy provider map compatible", () => {
    const payload = JSON.stringify({
      hackernews: "Show HN title",
      github_trending: "repo title",
    });

    expect(parseSignalSourceLabels(payload)).toEqual(["github_trending", "hackernews"]);
    expect(countSignalEvidence(payload)).toBe(2);
  });

  test("handles malformed JSON safely", () => {
    expect(parseSignalSourceLabels("{")).toEqual([]);
    expect(countSignalEvidence("{")).toBe(0);
  });
});
