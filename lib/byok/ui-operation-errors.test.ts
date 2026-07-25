import { describe, expect, test } from "vitest";
import { getByokOperationSection } from "./ui-operation-errors";

describe("getByokOperationSection", () => {
  test.each([
    ["run", "semantic"],
    ["quote-trends", "trends"],
    ["run-trends", "trends"],
    ["quote-serp", "serp"],
    ["run-serp", "serp"],
    ["quote-expand", "expand"],
    ["run-expand", "expand"],
    ["quote-compare", "compare"],
    ["run-compare", "compare"],
    ["quote-intent-retry", "compare"],
    ["run-intent-retry", "compare"],
  ])("maps %s to its inline section", (action, section) => {
    expect(getByokOperationSection(action)).toBe(section);
  });

  test("leaves connection-management actions on the page-level message", () => {
    expect(getByokOperationSection("save-openrouter")).toBeNull();
    expect(getByokOperationSection("save-spend-controls")).toBeNull();
  });
});
