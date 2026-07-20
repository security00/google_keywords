import { describe, expect, test } from "vitest";

import { parseSerpSummariesResponse } from "./serp";

describe("SERP response core", () => {
  test("summarizes successful task results and ignores failed tasks", () => {
    const summaries = parseSerpSummariesResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [{
            keyword: "Alpha Tool",
            item_types: ["organic", "people_also_ask"],
            items: [
              {
                type: "organic",
                title: "Alpha",
                url: "https://example.test/alpha",
                domain: "example.test",
              },
              { type: "people_also_ask" },
            ],
          }],
        },
        { status_code: 50000, result: [] },
      ],
    });

    expect(summaries.get("alpha tool")).toEqual({
      keyword: "Alpha Tool",
      itemTypes: ["organic", "people_also_ask"],
      itemTypeCounts: { organic: 1, people_also_ask: 1 },
      topResults: [{
        title: "Alpha",
        url: "https://example.test/alpha",
        domain: "example.test",
      }],
    });
    expect(summaries.size).toBe(1);
  });
});
