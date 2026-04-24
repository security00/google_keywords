// Re-export all public API from the original expand.ts
export type { FilterConfig } from "./expand-helpers";
export {
  resolveFilterConfig,
  buildFilterCacheKey,
} from "./expand-helpers";

export {
  submitExpansionTasks,
  waitForTasks,
  getReadyTaskIds,
  getExpansionResults,
} from "./expand-client";

export {
  organizeCandidates,
  flattenOrganizedCandidates,
} from "./expand-organizer";

export {
  filterCandidatesWithModel,
  filterCandidatesWithKeywordModel,
} from "./ai-filter";
