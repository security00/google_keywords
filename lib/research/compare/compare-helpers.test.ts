import { beforeEach, describe, expect, it, vi } from "vitest";

import { previewSemanticDedupCandidates, selectCandidatesForCompare } from "@/app/api/research/compare/compare-helpers";
import { d1Query } from "@/lib/d1";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);

const rows = [
  {
    id: "1",
    keyword: "Roblox Clicker Online",
    url: "https://example.com/a",
    extracted_at: "2026-05-08T10:00:00.000Z",
    source_id: "source-1",
    source_name: "Source 1",
  },
  {
    id: "2",
    keyword: "Roblox Clicker",
    url: "https://example.com/b",
    extracted_at: "2026-05-08T09:00:00.000Z",
    source_id: "source-1",
    source_name: "Source 1",
  },
  {
    id: "3",
    keyword: "Roblox Clicker codes",
    url: "https://example.com/c",
    extracted_at: "2026-05-08T08:00:00.000Z",
    source_id: "source-1",
    source_name: "Source 1",
  },
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
  });
});
