import { describe, expect, test } from "vitest";

import { getExpansionResultsFromTasks } from "./expand-client";

describe("DataForSEO expansion parser", () => {
  test("turns both array and grouped query payloads into candidates", () => {
    const candidates = getExpansionResultsFromTasks([
      {
        status_code: 20000,
        result: [{
          keywords: ["seed"],
          items: [
            {
              type: "google_trends_queries_list",
              data: [
                { query: "alpha", value: 300, type: "rising" },
              ],
            },
            {
              type: "google_trends_queries_list",
              data: {
                top: [{ query: "beta", value: 90 }],
                rising: [{ query: "gamma", value: 120 }],
              },
            },
          ],
        }],
      },
    ]);

    expect(candidates).toEqual([
      { keyword: "alpha", value: 300, type: "rising", source: "seed" },
      { keyword: "beta", value: 90, type: "top", source: "seed" },
      { keyword: "gamma", value: 120, type: "rising", source: "seed" },
    ]);
  });
});
