import type { Candidate, FilterSummary } from "@/lib/types";
import type { FilterConfig } from "@/lib/keyword-research";
import { filterCandidatesWithKeywordModel } from "@/lib/keyword-research";
import { batchScoreKeywords } from "@/lib/rule-engine";
import { saveKeywordHistory } from "@/lib/history";
import { normalizeCandidateType, loadKeywordHistoryFirstSeen } from "./expand-helpers";

export interface CandidateInput {
  keyword: string;
  value: number;
  type: "top" | "rising";
  source: string;
}

export const parsePostbackCandidates = (postbackResults: string[]): CandidateInput[] => {
  const candidates: CandidateInput[] = [];
  for (const resultJson of postbackResults) {
    const parsed = JSON.parse(resultJson);
    const taskResult = parsed?.tasks?.[0]?.result;
    if (!Array.isArray(taskResult)) continue;

    for (const entry of taskResult) {
      const sourceKeyword = entry?.keywords?.[0] ?? "unknown";
      const items = Array.isArray(entry?.items) ? entry.items : [];

      for (const item of items) {
        if (item?.type !== "google_trends_queries_list") continue;
        const data = item?.data;

        if (Array.isArray(data)) {
          for (const qi of data) {
            const kw = qi?.query ?? "";
            if (kw) candidates.push({ keyword: kw, value: Number(qi?.value ?? 0), type: String(qi?.type ?? "").toLowerCase().includes("rising") ? "rising" as const : "top" as const, source: sourceKeyword });
          }
        } else if (data && typeof data === "object") {
          for (const qi of data.top ?? []) {
            const kw = qi?.query ?? "";
            if (kw) candidates.push({ keyword: kw, value: Number(qi?.value ?? 0), type: "top" as const, source: sourceKeyword });
          }
          for (const qi of data.rising ?? []) {
            const kw = qi?.query ?? "";
            if (kw) candidates.push({ keyword: kw, value: Number(qi?.value ?? 0), type: "rising" as const, source: sourceKeyword });
          }
        }
      }
    }
  }
  return candidates;
};

export interface FilterAndEnrichOptions {
  includeTop: boolean;
  enableLlmFilter: boolean;
  useFilter: boolean;
  filterConfig: FilterConfig | null;
  isSharedPrecomputeRequest: boolean;
  debug: boolean;
}

export interface FilterAndEnrichResult {
  enrichedCandidates: Candidate[];
  filteredOut: Candidate[];
  filterSummary: FilterSummary | undefined;
  ruleBlockedSet: Set<unknown>;
  ruleKeptMap: Map<unknown, unknown>;
}

export const filterAndEnrichCandidates = async (
  candidates: CandidateInput[],
  options: FilterAndEnrichOptions,
  log: (message: string, meta?: Record<string, unknown>) => void,
): Promise<FilterAndEnrichResult> => {
  const { includeTop, enableLlmFilter, useFilter, filterConfig, isSharedPrecomputeRequest, debug } = options;

  if (!includeTop) {
    candidates = candidates.filter((candidate) => candidate.type === "rising");
  }

  // === Optimization 1: Rule engine pre-filter ===
  const ruleResult = batchScoreKeywords(candidates.map(c => c.keyword));
  const ruleBlockedSet = new Set(ruleResult.blocked.map(k => k.toLowerCase()));
  const ruleKeptMap = new Map(ruleResult.kept.map(k => [k.keyword.toLowerCase(), k.score]));
  const ruleFilteredOut = candidates.filter(c => ruleBlockedSet.has(c.keyword.toLowerCase()));
  candidates = candidates.filter(c => !ruleBlockedSet.has(c.keyword.toLowerCase()));

  // Sort by rule score (descending)
  candidates.sort((a, b) => {
    const sa = Number(ruleKeptMap.get(a.keyword.toLowerCase())) || 0;
    const sb = Number(ruleKeptMap.get(b.keyword.toLowerCase())) || 0;
    return sb - sa;
  });

  let filteredCandidates = candidates;
  let modelFilteredOut: Candidate[] = [];
  let modelFilterSummary: FilterSummary | undefined;

  if (enableLlmFilter && useFilter && filterConfig) {
    try {
      const modelFilter = await filterCandidatesWithKeywordModel(
        filteredCandidates,
        filterConfig,
        { debug }
      );
      filteredCandidates = modelFilter.filtered;
      modelFilteredOut = modelFilter.blocked;
      modelFilterSummary = modelFilter.summary;
    } catch (filterError) {
      log("precompute LLM filter failed, falling back to rule filter", {
        message: filterError instanceof Error ? filterError.message : "Unexpected error",
      });
    }
  }

  const filteredOut: Candidate[] = [
    ...ruleFilteredOut,
    ...modelFilteredOut,
  ];
  const filterSummary: FilterSummary | undefined =
    useFilter && filterConfig
      ? {
          enabled: true,
          model: modelFilterSummary?.model ?? filterConfig.model,
          total: filteredCandidates.length + filteredOut.length,
          removed: filteredOut.length,
          kept: filteredCandidates.length,
          skippedReason: enableLlmFilter
            ? modelFilterSummary?.skippedReason
            : "AI filter deferred",
        }
      : undefined;

  // === Optimization 4: Save keyword history ===
  if (!isSharedPrecomputeRequest) {
    try {
      await saveKeywordHistory(candidates as Candidate[]);
    } catch (e) {
      console.warn("[history] save failed", e);
    }
  }

  // === Enrich candidates with score and isNew flag ===
  const today = new Date().toISOString().slice(0, 10);
  const trendsMap: Record<string, { ratio: number; ratioMean: number; ratioRecent: number; slopeRatio?: number; volatility: number; verdict: string; }> = {};
  const seenDates = new Map<string, Set<string>>();
  for (const c of candidates) {
    const norm = c.keyword.toLowerCase().trim();
    if (!seenDates.has(norm)) seenDates.set(norm, new Set());
  }
  if (!isSharedPrecomputeRequest && candidates.length > 0) {
    const norms = [...new Set(candidates.map(c => c.keyword.toLowerCase().trim()))];
    const historyRows = await loadKeywordHistoryFirstSeen(norms);
    for (const hr of historyRows) {
      if (seenDates.has(hr.keyword_normalized)) {
        seenDates.get(hr.keyword_normalized)!.add(hr.first_seen);
      }
    }
  }

  const enrichedCandidates: Candidate[] = filteredCandidates.map(c => {
    const norm = c.keyword.toLowerCase().trim();
    const dates = seenDates.get(norm);
    const firstSeen = dates?.size ? [...dates].sort()[0] : null;
    const isNew = !isSharedPrecomputeRequest && firstSeen === today;
    const score = Number(ruleKeptMap.get(norm)) || 0;
    const trends = trendsMap[norm];
    return { ...c, isNew, score, trends };
  });

  return { enrichedCandidates, filteredOut, filterSummary, ruleBlockedSet, ruleKeptMap };
};
