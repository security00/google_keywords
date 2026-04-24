import type { ComparisonResult, ComparisonSignalConfig } from "@/lib/types";
import {
  RECENT_POINTS,
  NEWNESS_BASELINE_MEAN_MAX,
  NEWNESS_BASELINE_PEAK_MAX,
  NEWNESS_SURGE_MULTIPLIER,
  MIN_RECENT_MEAN,
} from "../dataforseo-client";
import { mean } from "./trend-math";
import { buildFreshnessSignal, computeDecayRisk } from "./verdict-engine";
import {
  submitComparisonTasks,
  getComparisonResultsFromTasks,
  getComparisonResults,
  enrichComparisonResultsWithIntent,
} from "./compare-client";

export { submitComparisonTasks, getComparisonResultsFromTasks, getComparisonResults, enrichComparisonResultsWithIntent } from "./compare-client";
export { classifyVerdict, buildVerdictExplanation, buildFreshnessSignal, computeDecayRisk, isLikelyAiKeyword, resolveFallbackIntent, AI_HINTS } from "./verdict-engine";
export { mean, positiveMean, stdDev, linearSlope, countCrossings, nearOne, formatPercent, formatRatio, formatNumber, normalizeTrendTimestamp } from "./trend-math";

/* ── High-level functions ───────────────────────────────────── */

export const addFreshnessToComparisonResults = (
  results: ComparisonResult[]
): ComparisonResult[] =>
  results.map((item) => {
    if (item.freshness || !item.series?.values?.length) return item;

    const candidateSeries = item.series.values;
    const recentWindowSize = Math.min(RECENT_POINTS, candidateSeries.length);
    const recentSeries = candidateSeries.slice(-recentWindowSize);
    const baselineSeries = candidateSeries.slice(0, -recentWindowSize);
    const baselineMean = mean(baselineSeries);
    const baselinePeak = baselineSeries.length > 0 ? Math.max(...baselineSeries) : 0;
    const recentMean = mean(recentSeries);
    const baselineLow =
      baselineMean <= NEWNESS_BASELINE_MEAN_MAX &&
      baselinePeak <= NEWNESS_BASELINE_PEAK_MAX;
    const surge =
      baselineSeries.length === 0
        ? recentMean >= MIN_RECENT_MEAN
        : recentMean >=
          Math.max(MIN_RECENT_MEAN, baselineMean * NEWNESS_SURGE_MULTIPLIER);

    const freshness = buildFreshnessSignal({
      candidateSeries,
      recentSeries,
      baselineSeries,
      baselineLow,
      surge,
      ratioRecent: item.ratioRecent,
      ratioLastPoint: item.ratioLastPoint ?? 0,
      slopeDiff: item.slopeDiff,
    });
    const verdict =
      freshness.status === "stable_old" &&
      (item.verdict === "strong" || item.verdict === "pass" || item.verdict === "close")
        ? "watch"
        : item.verdict;

    const decayRisk = item.series?.values?.length
      ? computeDecayRisk(item.series.values)
      : undefined;

    const finalVerdict = decayRisk === "high" && verdict !== "watch" && verdict !== "fail"
      ? "close" as const
      : verdict;

    return { ...item, verdict: finalVerdict, freshness, decayRisk };
  });

export const resolveBenchmark = (override?: string) => {
  const envValue = process.env.BENCHMARK_KEYWORD;
  const cleanedOverride = typeof override === "string" ? override.trim() : "";
  const cleanedEnv = typeof envValue === "string" ? envValue.trim() : "";
  return cleanedOverride || cleanedEnv || "gpts";
};

const formatUtcDate = (date: Date) => date.toISOString().slice(0, 10);

const getDateRange = (days = 7) => {
  const now = new Date();
  const utcToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const sharedUpperBoundUtc = new Date(
    utcToday.getTime() - 24 * 60 * 60 * 1000
  );
  const dateTo = formatUtcDate(sharedUpperBoundUtc);
  const dateFrom = formatUtcDate(
    new Date(sharedUpperBoundUtc.getTime() - days * 24 * 60 * 60 * 1000)
  );
  return { dateFrom, dateTo };
};

export const resolveDateRange = (
  dateFrom?: string,
  dateTo?: string,
  fallbackDays = 7
) => {
  const fallback = getDateRange(fallbackDays);
  return {
    dateFrom:
      typeof dateFrom === "string" && dateFrom.trim()
        ? dateFrom.trim()
        : fallback.dateFrom,
    dateTo:
      typeof dateTo === "string" && dateTo.trim()
        ? dateTo.trim()
        : fallback.dateTo,
  };
};

export const resolveComparisonDateRange = (
  dateFrom?: string,
  dateTo?: string
) => resolveDateRange(dateFrom, dateTo, 90);

export const summarizeResults = (results: ComparisonResult[]) => {
  return results.reduce(
    (acc, result) => {
      acc[result.verdict] += 1;
      return acc;
    },
    { strong: 0, pass: 0, close: 0, watch: 0, fail: 0 }
  );
};
