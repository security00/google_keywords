import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  clampSignalReviewLimit,
  countSignalEvidence,
  normalizeSignalReviewStatus,
  parseSignalSourceLabels,
  signalReviewAcceptedValue,
  signalReviewProcessedValue,
  signalReviewStatusClause,
  updateSignalReviewCandidate,
} from "./signal-review";
import { d1Query } from "./d1";

vi.mock("./d1", () => ({
  d1Query: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);

describe("signal review helpers", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
  });

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

  test("builds manual review status values", () => {
    expect(signalReviewAcceptedValue("approve")).toBe("accepted:manual:admin_review");
    expect(signalReviewProcessedValue("approve")).toBe(0);

    expect(signalReviewAcceptedValue("reject", "Weak Pipeline Fit!")).toBe(
      "rejected:manual:weak_pipeline_fit"
    );
    expect(signalReviewProcessedValue("reject")).toBe(1);
  });

  test("updates a candidate review decision in D1", async () => {
    mockD1Query.mockResolvedValue({ rows: [{ id: "sig_1" }] });

    await expect(
      updateSignalReviewCandidate({ id: "sig_1", action: "approve" })
    ).resolves.toEqual({
      id: "sig_1",
      accepted: "accepted:manual:admin_review",
      processed: 0,
    });

    expect(String(mockD1Query.mock.calls[0][0])).toContain("UPDATE signal_candidates");
    expect(mockD1Query.mock.calls[0][1]).toEqual([
      "accepted:manual:admin_review",
      0,
      "sig_1",
    ]);
  });

  test("rejects a missing candidate id before writing", async () => {
    await expect(
      updateSignalReviewCandidate({ id: " ", action: "reject" })
    ).rejects.toThrow("Candidate id is required");
    expect(mockD1Query).not.toHaveBeenCalled();
  });
});
