import { beforeEach, describe, expect, it, vi } from "vitest";

import { previewPipelineSemanticDedupCandidates, previewSemanticDedupCandidates, selectCandidatesForCompare } from "@/app/api/research/compare/compare-helpers";
import { d1Query } from "@/lib/d1";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);

const row = (id: string, keyword: string, extractedAt = "2026-05-08T10:00:00.000Z") => ({
  id,
  keyword,
  url: `https://example.com/${id}`,
  extracted_at: extractedAt,
  source_id: "source-1",
  source_name: "Source 1",
});

const rows = [
  row("1", "Roblox Clicker Online", "2026-05-08T10:00:00.000Z"),
  row("2", "Roblox Clicker", "2026-05-08T09:00:00.000Z"),
  row("3", "Roblox Clicker codes", "2026-05-08T08:00:00.000Z"),
];

describe("compare semantic dedupe preview", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-05-08T12:00:00.000Z"));
    mockD1Query.mockReset();
  });

  it("does not change existing candidate selection behavior", async () => {
    mockD1Query.mockResolvedValue({ rows });

    const result = await selectCandidatesForCompare("user-1", "priority", 10);

    expect(result.keywords).toEqual([
      "Roblox Clicker Online",
      "Roblox Clicker codes",
      "Roblox Clicker",
    ]);
    expect(result.keywordIds).toEqual(["1", "3", "2"]);
  });

  it("returns read-only semantic groups and summary without applying them", async () => {
    mockD1Query.mockResolvedValue({ rows });

    const result = await previewSemanticDedupCandidates("user-1", "priority", 10);

    expect(result.summary).toEqual({
      availableCount: 3,
      exactDedupedCount: 3,
      semanticGroupCount: 1,
      estimatedFoldedCount: 1,
    });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].semanticKey).toBe("roblox clicker");
    expect(result.groups[0].variants.map((item) => item.keyword)).toEqual([
      "Roblox Clicker Online",
      "Roblox Clicker",
    ]);
    expect(mockD1Query).toHaveBeenCalledTimes(1);
    expect(String(mockD1Query.mock.calls[0][0])).toMatch(/^\s*SELECT /);
    expect(String(mockD1Query.mock.calls[0][0])).toContain("dk.user_id = ?");
  });

  it("can preview a global admin candidate pool without filtering by admin user id", async () => {
    mockD1Query.mockResolvedValue({ rows });

    await previewSemanticDedupCandidates(null, "priority", 10);

    expect(String(mockD1Query.mock.calls[0][0])).not.toContain("dk.user_id = ?");
  });

  it("scans the full candidate pool before limiting displayed semantic groups", async () => {
    mockD1Query.mockResolvedValue({
      rows: [
        row("1", "Alpha"),
        row("2", "Beta"),
        row("3", "Gamma"),
        row("4", "Planet Clicker"),
        row("5", "Planet Clicker 2"),
      ],
    });

    const result = await previewSemanticDedupCandidates(null, "priority", 2);

    expect(result.summary.exactDedupedCount).toBe(5);
    expect(result.summary.semanticGroupCount).toBe(1);
    expect(result.groups.map((group) => group.semanticKey)).toEqual(["planet clicker"]);
  });

  it("falls back to historical rows only for the global admin preview when the lookback window is empty", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows });

    const result = await previewSemanticDedupCandidates(null, "priority", 10);

    expect(result.summary.availableCount).toBe(3);
    expect(result.summary.semanticGroupCount).toBe(1);
    expect(mockD1Query).toHaveBeenCalledTimes(2);
    expect(String(mockD1Query.mock.calls[0][0])).toContain("dk.extracted_at >= ?");
    expect(String(mockD1Query.mock.calls[1][0])).not.toContain("dk.extracted_at >= ?");
  });

  it("can preview semantic groups from the game keyword pipeline without touching discovered candidates", async () => {
    mockD1Query.mockResolvedValue({
      rows: [
        { id: 1, keyword: "Planet Clicker", source_site: "steam", trend_ratio: 2.4, discovered_at: "2026-05-08T10:00:00.000Z" },
        { id: 2, keyword: "Planet Clicker 2", source_site: "steam", trend_ratio: 2.1, discovered_at: "2026-05-08T09:00:00.000Z" },
        { id: 3, keyword: "Planet Clicker codes", source_site: "steam", trend_ratio: 3.0, discovered_at: "2026-05-08T08:00:00.000Z" },
      ],
    });

    const result = await previewPipelineSemanticDedupCandidates(10);

    expect(result.summary.availableCount).toBe(3);
    expect(result.summary.semanticGroupCount).toBe(1);
    expect(result.groups[0].semanticKey).toBe("planet clicker");
    expect(result.groups[0].variants.map((item) => item.keyword)).toEqual([
      "Planet Clicker",
      "Planet Clicker 2",
    ]);
    expect(mockD1Query).toHaveBeenCalledTimes(1);
    expect(String(mockD1Query.mock.calls[0][0])).toContain("FROM game_keyword_pipeline");
    expect(String(mockD1Query.mock.calls[0][0])).not.toContain("discovered_keywords");
  });

  it("keeps pipeline candidates visible even when no semantic groups exist", async () => {
    mockD1Query.mockResolvedValue({
      rows: [
        { id: 1, keyword: "So I Mine", source_site: "itchio", trend_ratio: 0.63, discovered_at: "2026-04-26T10:07:23.000Z" },
        { id: 2, keyword: "We Dont Know", source_site: "itchio", trend_ratio: 0.98, discovered_at: "2026-04-26T10:07:21.000Z" },
        { id: 3, keyword: "The Freak Circus", source_site: "itchio-free", trend_ratio: 4.53, discovered_at: "2026-04-25T09:47:21.000Z" },
      ],
    });

    const result = await previewPipelineSemanticDedupCandidates(10);

    expect(result.summary.availableCount).toBe(3);
    expect(result.summary.semanticGroupCount).toBe(0);
    expect(result.candidates?.map((item) => item.keyword)).toEqual([
      "So I Mine",
      "We Dont Know",
      "The Freak Circus",
    ]);
  });
});
