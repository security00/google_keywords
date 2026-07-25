export type ByokOperationSection =
  | "semantic"
  | "trends"
  | "serp"
  | "expand"
  | "compare";

const OPERATION_SECTION_BY_ACTION: Record<string, ByokOperationSection> = {
  run: "semantic",
  "quote-trends": "trends",
  "run-trends": "trends",
  "quote-serp": "serp",
  "run-serp": "serp",
  "quote-expand": "expand",
  "run-expand": "expand",
  "quote-compare": "compare",
  "run-compare": "compare",
  "quote-intent-retry": "compare",
  "run-intent-retry": "compare",
};

export const getByokOperationSection = (
  action: string,
): ByokOperationSection | null => OPERATION_SECTION_BY_ACTION[action] ?? null;
