import { beforeEach, describe, expect, it, vi } from "vitest";

import { listSemanticDedupeFeedback, upsertSemanticDedupeFeedback } from "./semantic-dedupe-feedback";
import { d1Query } from "./d1";

vi.mock("./d1", () => ({
  d1Query: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);

describe("semantic dedupe feedback", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
  });

  it("lists feedback for a user and parses variants", async () => {
    mockD1Query.mockResolvedValue({
      rows: [
        {
          semantic_key: "roblox clicker",
          verdict: "merge",
          representative_keyword: "Roblox Clicker",
          variants_json: '["Roblox Clicker","Roblox Clicker Online"]',
          note: "safe",
          updated_at: "2026-05-08T12:00:00.000Z",
        },
      ],
    });

    await expect(listSemanticDedupeFeedback("user-1")).resolves.toEqual([
      {
        semanticKey: "roblox clicker",
        verdict: "merge",
        representativeKeyword: "Roblox Clicker",
        variants: ["Roblox Clicker", "Roblox Clicker Online"],
        note: "safe",
        updatedAt: "2026-05-08T12:00:00.000Z",
      },
    ]);
    expect(String(mockD1Query.mock.calls[0][0])).toMatch(/^\s*SELECT /);
    expect(mockD1Query.mock.calls[0][1]).toEqual(["user-1"]);
  });

  it("upserts a bounded merge/separate verdict", async () => {
    mockD1Query.mockResolvedValue({ rows: [] });

    await upsertSemanticDedupeFeedback("user-1", {
      semanticKey: "roblox clicker",
      verdict: "separate",
      representativeKeyword: "Roblox Clicker",
      variants: ["Roblox Clicker", "Roblox Clicker Online", ""],
      note: "not same intent".repeat(40),
    });

    expect(String(mockD1Query.mock.calls[0][0])).toContain("INSERT INTO semantic_dedupe_feedback");
    expect(mockD1Query.mock.calls[0][1]).toEqual([
      "user-1",
      "roblox clicker",
      "separate",
      "Roblox Clicker",
      JSON.stringify(["Roblox Clicker", "Roblox Clicker Online"]),
      "not same intent".repeat(40).slice(0, 500),
    ]);
  });

  it("rejects invalid verdicts and empty semantic keys", async () => {
    await expect(
      upsertSemanticDedupeFeedback("user-1", {
        semanticKey: "",
        verdict: "merge",
        representativeKeyword: "Roblox Clicker",
        variants: ["Roblox Clicker"],
      })
    ).rejects.toThrow("semanticKey is required");

    await expect(
      upsertSemanticDedupeFeedback("user-1", {
        semanticKey: "roblox clicker",
        verdict: "maybe",
        representativeKeyword: "Roblox Clicker",
        variants: ["Roblox Clicker"],
      })
    ).rejects.toThrow("Invalid verdict");
  });
});
