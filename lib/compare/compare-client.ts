import type { ComparisonSignalConfig, ComparisonResult, ComparisonSeries } from "@/lib/types";
import {
  RECENT_POINTS,
  RECENT_TAIL_POINTS,
  NEWNESS_BASELINE_MEAN_MAX,
  NEWNESS_BASELINE_PEAK_MAX,
  NEWNESS_SURGE_MULTIPLIER,
  MIN_RECENT_MEAN,
  roundTo,
  safeDivide,
  TASK_POST_URL,
  TASK_GET_URL,
  resolveComparisonSignalConfig,
  normalizeDate,
  buildPostbackUrl,
  buildAuthHeaders,
  requestWithRetry,
  extractDataForSeoCost,
  mergeCostSummaries,
} from "../dataforseo-client";
import { createBatches } from "../keyword-utils";
import type { SerpSummary } from "../serp";
import { mean, stdDev, linearSlope, countCrossings, nearOne, normalizeTrendTimestamp } from "./trend-math";
import { classifyVerdict, buildFreshnessSignal, computeDecayRisk, buildVerdictExplanation, resolveFallbackIntent } from "./verdict-engine";

export const submitComparisonTasksWithCost = async (
  keywords: string[],
  dateFrom: string,
  dateTo: string,
  benchmark = "gpts",
  options?: { postbackUrl?: string; cacheKey?: string }
) => {
  const batches = createBatches(keywords, 4);
  const postback = buildPostbackUrl(options?.postbackUrl, options?.cacheKey, "compare");
  const requestBatches = createBatches(batches, 25);
  const taskIds: string[] = [];
  const costs = [];

  for (const requestBatch of requestBatches) {
    const payload = requestBatch.map((batch) => ({
      keywords: [...batch, benchmark],
      date_from: normalizeDate(dateFrom),
      date_to: normalizeDate(dateTo),
      type: "web",
      ...(postback ? { postback_url: postback } : {}),
    }));

    const result = await requestWithRetry("post", TASK_POST_URL, {
      headers: buildAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (result?.status_code !== 20000) {
      throw new Error(result?.status_message || "Failed to create comparison tasks");
    }

    costs.push(extractDataForSeoCost(result));

    taskIds.push(
      ...(result.tasks || [])
        .filter((task: { status_code: number }) => task.status_code === 20100)
        .map((task: { id: string }) => task.id)
    );
  }

  return { taskIds, cost: mergeCostSummaries(costs) };
};

export const submitComparisonTasks = async (
  keywords: string[],
  dateFrom: string,
  dateTo: string,
  benchmark = "gpts",
  options?: { postbackUrl?: string; cacheKey?: string }
) => {
  const submission = await submitComparisonTasksWithCost(keywords, dateFrom, dateTo, benchmark, options);
  return submission.taskIds;
};

export const enrichComparisonResultsWithIntent = async (
  results: ComparisonResult[],
  options: { enableIntentLlm?: boolean } = {}
): Promise<ComparisonResult[]> => {
  if (results.length === 0) return results;
  const fallbackResults = results.map((item) => ({
    ...item,
    intent: resolveFallbackIntent(item.keyword),
  }));
  const enableIntentLlm =
    options.enableIntentLlm === true || process.env.COMPARE_INTENT_LLM_ENABLED === "true";
  if (!enableIntentLlm) {
    return fallbackResults;
  }

  const intentMaxKeywords = Math.min(
    Math.max(Number(process.env.COMPARE_INTENT_MAX_KEYWORDS ?? 20), 1),
    50
  );
  const keywordMap = new Map<string, string>();
  for (const item of results) {
    if (item.verdict === "fail") continue;
    const key = item.keyword.toLowerCase();
    if (!keywordMap.has(key)) {
      keywordMap.set(key, item.keyword);
    }
    if (keywordMap.size >= intentMaxKeywords) break;
  }
  const keywords = Array.from(keywordMap.values());
  if (keywords.length === 0) return fallbackResults;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return fallbackResults;
  }

  try {
    const { submitSerpTasks, waitForSerpTasks, getSerpResults } = await import("../serp");
    const { inferIntentWithModel } = await import("../ai-intent");

    const taskIds = await submitSerpTasks(keywords);
    const completed = await waitForSerpTasks(taskIds);
    const summariesMap = await getSerpResults(completed);
    const summaries = keywords
      .map((keyword) => summariesMap.get(keyword.toLowerCase()))
      .filter(Boolean) as SerpSummary[];

    const intentMap = await inferIntentWithModel(summaries);

    return results.map((item) => {
      const key = item.keyword.toLowerCase();
      return {
        ...item,
        intent: intentMap.get(key) ?? resolveFallbackIntent(item.keyword),
      };
    });
  } catch (error) {
    console.warn("Intent classification failed", error);
    return fallbackResults;
  }
};

export const getComparisonResultsFromTasks = async (
  taskPayloads: Array<Record<string, unknown>>,
  benchmark = "gpts",
  signalConfig: Partial<ComparisonSignalConfig> = {},
  options: { enableIntentLlm?: boolean } = {}
) => {
  const config = resolveComparisonSignalConfig(signalConfig);
  const results: ComparisonResult[] = [];
  const benchmarkLower = benchmark.toLowerCase();

  for (const task of taskPayloads) {
    if (Number(task?.status_code ?? 0) !== 20000) continue;

    const taskResult = Array.isArray(task.result) ? task.result[0] : undefined;
    const taskResultRecord =
      taskResult && typeof taskResult === "object"
        ? (taskResult as Record<string, unknown>)
        : null;
    const keywords = Array.isArray(taskResultRecord?.keywords)
      ? taskResultRecord.keywords.filter(
          (keyword): keyword is string => typeof keyword === "string"
        )
      : [];
    const items = Array.isArray(taskResultRecord?.items)
      ? taskResultRecord.items
      : [];

    for (const item of items) {
      const itemRecord =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : null;
      if (itemRecord?.type !== "google_trends_graph") continue;

      const dataPoints = Array.isArray(itemRecord.data)
        ? itemRecord.data.filter(
            (point): point is Record<string, unknown> =>
              Boolean(point) && typeof point === "object"
          )
        : [];
      if (!dataPoints.length || !keywords.length) continue;

      const series: number[][] = keywords.map(() => []);
      const timestamps = dataPoints.map((point, index) =>
        normalizeTrendTimestamp(point, index)
      );

      for (const point of dataPoints) {
        const values = Array.isArray(point.values) ? point.values : [];
        for (let i = 0; i < series.length; i += 1) {
          const value = Number(values[i] ?? 0);
          series[i].push(value);
        }
      }

      const benchmarkIndex = keywords.findIndex(
        (kw) => kw.toLowerCase() === benchmarkLower
      );
      const benchmarkSeries = series[benchmarkIndex] ?? [];
      const recentWindowSize = Math.min(RECENT_POINTS, benchmarkSeries.length);
      const recentBenchmarkSeries = benchmarkSeries.slice(-recentWindowSize);
      const benchmarkRecentMean = mean(recentBenchmarkSeries);
      const benchmarkRecentPeak =
        recentBenchmarkSeries.length > 0
          ? Math.max(...recentBenchmarkSeries)
          : benchmarkRecentMean;
      const benchmarkRecentSlope = linearSlope(recentBenchmarkSeries);

      for (let i = 0; i < keywords.length; i += 1) {
        const kw = keywords[i];
        if (kw.toLowerCase() === benchmarkLower) continue;

        const candidateSeries = series[i] ?? [];
        const candidateRecentSeries = candidateSeries.slice(-recentWindowSize);
        const candidateBaselineSeries = candidateSeries.slice(
          0,
          -recentWindowSize
        );
        const baselineMean = mean(candidateBaselineSeries);
        const baselinePeak =
          candidateBaselineSeries.length > 0
            ? Math.max(...candidateBaselineSeries)
            : 0;
        const recentMean = mean(candidateRecentSeries);
        const recentPeak =
          candidateRecentSeries.length > 0
            ? Math.max(...candidateRecentSeries)
            : recentMean;
        const baselineLow =
          baselineMean <= NEWNESS_BASELINE_MEAN_MAX &&
          baselinePeak <= NEWNESS_BASELINE_PEAK_MAX;
        const surge =
          candidateBaselineSeries.length === 0
            ? recentMean >= MIN_RECENT_MEAN
            : recentMean >=
              Math.max(MIN_RECENT_MEAN, baselineMean * NEWNESS_SURGE_MULTIPLIER);

        const tailWindowSize = Math.min(
          RECENT_TAIL_POINTS,
          candidateRecentSeries.length
        );
        const candidateTail = candidateRecentSeries.slice(-tailWindowSize);
        const benchmarkTail = recentBenchmarkSeries.slice(-tailWindowSize);

        const ratioMean = safeDivide(recentMean, benchmarkRecentMean);
        const candidateLastValue =
          candidateRecentSeries[candidateRecentSeries.length - 1] ?? 0;
        const benchmarkLastValue =
          recentBenchmarkSeries[recentBenchmarkSeries.length - 1] ?? 0;
        const ratioRecent = safeDivide(mean(candidateTail), mean(benchmarkTail));
        const ratioLastPoint = safeDivide(candidateLastValue, benchmarkLastValue);
        const ratioCoverage =
          candidateRecentSeries.length === 0
            ? 0
            : candidateRecentSeries.reduce(
                (count, value, idx) =>
                  count + (value >= (recentBenchmarkSeries[idx] ?? 0) ? 1 : 0),
                0
              ) / candidateRecentSeries.length;
        const ratioPeak = safeDivide(recentPeak, benchmarkRecentPeak);
        const candidateRecentSlope = linearSlope(candidateRecentSeries);
        const slopeDiff = candidateRecentSlope - benchmarkRecentSlope;
        const slopeRatio = Math.abs(benchmarkRecentSlope) > 1e-6
          ? candidateRecentSlope / benchmarkRecentSlope
          : candidateRecentSlope > 0
            ? 99
            : candidateRecentSlope < 0
              ? -99
              : 0;
        const nearOneLastPoint = nearOne(ratioLastPoint, config.nearOneTolerance);
        const isRisingStrong =
          slopeRatio >= config.risingStrongMinSlopeRatio &&
          ratioRecent >= config.risingStrongMinTailRatio &&
          slopeDiff > 0 &&
          nearOneLastPoint;
        const poolQualified =
          ratioMean > config.avgRatioMin ||
          ratioLastPoint > config.lastPointRatioMin ||
          ratioPeak > config.peakRatioMin ||
          isRisingStrong;
        const volatility =
          recentMean > 0 ? stdDev(candidateRecentSeries) / recentMean : 0;
        const crossings = countCrossings(
          candidateRecentSeries,
          recentBenchmarkSeries
        );
        let endStreak = 0;
        for (let j = candidateRecentSeries.length - 1; j >= 0; j -= 1) {
          if (candidateRecentSeries[j] >= (recentBenchmarkSeries[j] ?? 0)) {
            endStreak += 1;
          } else {
            break;
          }
        }
        const endValue =
          candidateRecentSeries[candidateRecentSeries.length - 1] ?? 0;
        const endVsPeak = recentPeak > 0 ? endValue / recentPeak : 0;

        const verdict = classifyVerdict({
          config,
          poolQualified,
          meanRatio: ratioMean,
          peakRatio: ratioPeak,
          slopeRatio,
          coverage: ratioCoverage,
          tailRatio: ratioRecent,
          endStreak,
          endVsPeak,
          volatility,
          slopeDiff,
        });
        const freshness = buildFreshnessSignal({
          candidateSeries,
          recentSeries: candidateRecentSeries,
          baselineSeries: candidateBaselineSeries,
          baselineLow,
          surge,
          ratioRecent,
          ratioLastPoint,
          slopeDiff,
        });
        const freshnessAdjustedVerdict =
          freshness.status === "stable_old" &&
          (verdict === "strong" || verdict === "pass" || verdict === "close")
            ? "watch"
            : verdict;
        const alignedLength = Math.min(
          timestamps.length,
          candidateSeries.length,
          benchmarkSeries.length
        );
        const seriesPayload: ComparisonSeries = {
          timestamps: timestamps.slice(-alignedLength),
          values: candidateSeries.slice(-alignedLength),
          benchmarkValues: benchmarkSeries.slice(-alignedLength),
        };
        const explanation = buildVerdictExplanation({
          verdict: freshnessAdjustedVerdict,
          poolQualified,
          config,
          baselineMean,
          baselinePeak,
          recentMean,
          recentPeak,
          ratioMean,
          ratioRecent,
          ratioCoverage,
          ratioPeak,
          ratioLastPoint,
          endStreak,
          endVsPeak,
          volatility,
          slopeRatio,
          slopeDiff,
        });

        if (!baselineLow && !surge && verdict === "fail") {
          // no-op
        }

        results.push({
          keyword: kw,
          avgValue: roundTo(recentMean, 2),
          benchmarkValue: roundTo(benchmarkRecentMean, 2),
          ratio: roundTo(ratioMean, 2),
          ratioMean: roundTo(ratioMean, 2),
          ratioRecent: roundTo(ratioRecent, 2),
          ratioCoverage: roundTo(ratioCoverage, 2),
          ratioPeak: roundTo(ratioPeak, 2),
          ratioLastPoint: roundTo(ratioLastPoint, 2),
          slopeDiff: roundTo(slopeDiff, 2),
          slopeRatio: roundTo(slopeRatio, 2),
          volatility: roundTo(volatility, 2),
          crossings,
          verdict: freshnessAdjustedVerdict,
          series: seriesPayload,
          explanation,
          freshness,
        });
      }
    }
  }

  const sorted = results.sort((a, b) => b.ratio - a.ratio);
  return enrichComparisonResultsWithIntent(sorted, options);
};

export const getComparisonResults = async (
  taskIds: string[],
  benchmark = "gpts",
  signalConfig: Partial<ComparisonSignalConfig> = {},
  options: { enableIntentLlm?: boolean } = {}
) => {
  const taskPayloads: Record<string, unknown>[] = [];

  for (const taskId of taskIds) {
    const result = await requestWithRetry("get", `${TASK_GET_URL}/${taskId}`, {
      headers: buildAuthHeaders(),
    });

    if (result?.status_code !== 20000 || !Array.isArray(result?.tasks)) continue;

    for (const task of result.tasks) {
      if (task && typeof task === "object") {
        taskPayloads.push(task as Record<string, unknown>);
      }
    }
  }

  return getComparisonResultsFromTasks(taskPayloads, benchmark, signalConfig, options);
};
