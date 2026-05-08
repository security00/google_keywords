import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteGameOpportunityFeedback, listGameOpportunityFeedback, upsertGameOpportunityFeedback } from "./game-opportunity-feedback";
import { d1Query } from "./d1";

vi.mock("./d1", () => ({
  d1Query: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);

describe("game opportunity feedback", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
  });

  it("lists opportunity feedback for the current admin", async () => {
    mockD1Query.mockResolvedValue({
      rows: [
        {
          opportunity_id: "42",
          keyword: "Planet Clicker",
          verdict: "worth_doing",
          note: "good angle",
          updated_at: "2026-05-08T14:00:00.000Z",
        },
      ],
    });

    await expect(listGameOpportunityFeedback("admin-1")).resolves.toEqual([
      {
        opportunityId: "42",
        keyword: "Planet Clicker",
        verdict: "worth_doing",
        note: "good angle",
        updatedAt: "2026-05-08T14:00:00.000Z",
      },
    ]);
    expect(String(mockD1Query.mock.calls[0][0])).toMatch(/^\s*SELECT /);
    expect(mockD1Query.mock.calls[0][1]).toEqual(["admin-1"]);
  });

  it("upserts a bounded worth/not-worth verdict without touching pipeline rows", async () => {
    mockD1Query.mockResolvedValue({ rows: [] });

    await upsertGameOpportunityFeedback("admin-1", {
      opportunityId: "42",
      keyword: "Planet Clicker",
      verdict: "not_worth_doing",
      note: "too generic".repeat(80),
    });

    expect(String(mockD1Query.mock.calls[0][0])).toContain("INSERT INTO game_opportunity_feedback");
    expect(String(mockD1Query.mock.calls[0][0])).not.toContain("game_keyword_pipeline");
    expect(mockD1Query.mock.calls[0][1]).toEqual([
      "admin-1",
      "42",
      "Planet Clicker",
      "not_worth_doing",
      "too generic".repeat(80).slice(0, 500),
    ]);
  });

  it("deletes a feedback record for the current admin only", async () => {
    mockD1Query.mockResolvedValue({ rows: [] });

    await deleteGameOpportunityFeedback("admin-1", "42");

    expect(String(mockD1Query.mock.calls[0][0])).toContain("DELETE FROM game_opportunity_feedback");
    expect(String(mockD1Query.mock.calls[0][0])).toContain("WHERE user_id = ? AND opportunity_id = ?");
    expect(mockD1Query.mock.calls[0][1]).toEqual(["admin-1", "42"]);
  });

  it("rejects invalid verdicts and empty inputs", async () => {
    await expect(
      upsertGameOpportunityFeedback("admin-1", {
        opportunityId: "",
        keyword: "Planet Clicker",
        verdict: "worth_doing",
      })
    ).rejects.toThrow("opportunityId is required");

    await expect(
      upsertGameOpportunityFeedback("admin-1", {
        opportunityId: "42",
        keyword: "Planet Clicker",
        verdict: "maybe",
      })
    ).rejects.toThrow("Invalid verdict");
  });
});
