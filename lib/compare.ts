import type { ComparisonSignalConfig, ComparisonFreshness, ComparisonExplanation, ComparisonResult, ComparisonSeries } from "@/lib/types";
import {
  RECENT_POINTS,
  RECENT_TAIL_POINTS,
  NEWNESS_BASELINE_MEAN_MAX,
  NEWNESS_BASELINE_PEAK_MAX,
  NEWNESS_SURGE_MULTIPLIER,
  MIN_RECENT_MEAN,
  MIN_COVERAGE_STRONG,
  MIN_COVERAGE_PASS,
  MIN_COVERAGE_CLOSE,
  MIN_END_STREAK_STRONG,
  MIN_END_STREAK_PASS,
  MIN_TAIL_RATIO_STRONG,
  MIN_TAIL_RATIO_PASS,
  MIN_TAIL_RATIO_CLOSE,
  MIN_END_VS_PEAK_STRONG,
  MIN_END_VS_PEAK_PASS,
  MIN_END_VS_PEAK_CLOSE,
  MAX_VOLATILITY_STRONG,
  MAX_VOLATILITY_PASS,
  roundTo,
  safeDivide,
} from "./dataforseo-client";
import type { SerpSummary } from "./serp";

/* ── Statistical helpers (used only by compare) ─────────────── */

const mean = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const positiveMean = (values: number[]) => {
  const positiveValues = values.filter((value) => value > 0);
  return mean(positiveValues);
};

const stdDev = (values: number[]) => {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
};

const linearSlope = (values: number[]) => {
  if (values.length < 2) return 0;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const x = i - meanX;
    const y = values[i] - meanY;
    numerator += x * y;
    denominator += x * x;
  }
  return denominator === 0 ? 0 : numerator / denominator;
};

const countCrossings = (a: number[], b: number[]) => {
  let crossings = 0;
  let prevSign = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - (b[i] ?? 0);
    const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    if (sign === 0) continue;
    if (prevSign !== 0 && sign !== prevSign) {
      crossings += 1;
    }
    prevSign = sign;
  }
  return crossings;
};

const nearOne = (value: number, tolerance = 0.1) =>
  Math.abs(value - 1) <= tolerance;

/* ── Formatting helpers ─────────────────────────────────────── */

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
const formatRatio = (value: number) => `${roundTo(value, 2)}x`;
const formatNumber = (value: number) => roundTo(value, 2);

/* ── Trend timestamp normalization ──────────────────────────── */

const normalizeTrendTimestamp = (point: Record<string, unknown>, index: number) => {
  const rawDate =
    (typeof point?.date === "string" && point.date.trim()) ||
    (typeof point?.datetime === "string" && point.datetime.trim()) ||
    (typeof point?.date_time === "string" && point.date_time.trim()) ||
    (typeof point?.time === "string" && point.time.trim()) ||
    "";
  if (rawDate) return rawDate;

  const rawTimestamp =
    (typeof point?.timestamp === "number" && point.timestamp) ||
    (typeof point?.timestamp_gmt === "number" && point.timestamp_gmt) ||
    (typeof point?.timestamp_utc === "number" && point.timestamp_utc) ||
    (typeof point?.time === "number" && point.time) ||
    null;

  if (typeof rawTimestamp === "number") {
    const ms = rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  return `#${index + 1}`;
};

/* ── Verdict classification ─────────────────────────────────── */

const classifyVerdict = ({
  poolQualified,
  meanRatio,
  peakRatio,
  slopeRatio,
  config,
  coverage,
  tailRatio,
  endStreak,
  endVsPeak,
  volatility,
  slopeDiff,
}: {
  poolQualified: boolean;
  meanRatio: number;
  peakRatio: number;
  slopeRatio: number;
  config: ComparisonSignalConfig;
  coverage: number;
  tailRatio: number;
  endStreak: number;
  endVsPeak: number;
  volatility: number;
  slopeDiff: number;
}) => {
  if (!poolQualified) {
    return "fail" as const;
  }

  const strongStable =
    coverage >= MIN_COVERAGE_STRONG &&
    endStreak >= MIN_END_STREAK_STRONG &&
    tailRatio >= MIN_TAIL_RATIO_STRONG &&
    endVsPeak >= MIN_END_VS_PEAK_STRONG &&
    volatility <= MAX_VOLATILITY_STRONG &&
    slopeDiff >= -0.05;

  if (
    strongStable &&
    (meanRatio >= config.avgRatioMin || slopeRatio >= config.slopeRatioMinStrong) &&
    peakRatio >= config.peakRatioMin
  ) {
    return "strong" as const;
  }

  const passStable =
    coverage >= MIN_COVERAGE_PASS &&
    endStreak >= MIN_END_STREAK_PASS &&
    tailRatio >= MIN_TAIL_RATIO_PASS &&
    endVsPeak >= MIN_END_VS_PEAK_PASS &&
    volatility <= MAX_VOLATILITY_PASS &&
    slopeRatio >= config.slopeRatioMinPass &&
    slopeDiff >= -0.1;

  if (passStable && (meanRatio >= config.avgRatioMin * 0.9 || peakRatio >= config.peakRatioMin * 0.95)) {
    return "pass" as const;
  }

  if (
    coverage >= MIN_COVERAGE_CLOSE &&
    tailRatio >= MIN_TAIL_RATIO_CLOSE &&
    endVsPeak >= MIN_END_VS_PEAK_CLOSE
  ) {
    return "close" as const;
  }

  if (tailRatio >= 0.7 || slopeRatio >= config.slopeRatioMinPass || slopeDiff > 0) {
    return "watch" as const;
  }

  return "fail" as const;
};

/* ── Freshness signal ───────────────────────────────────────── */

const buildFreshnessSignal = ({
  candidateSeries,
  recentSeries,
  baselineSeries,
  baselineLow,
  surge,
  ratioRecent,
  ratioLastPoint,
  slopeDiff,
}: {
  candidateSeries: number[];
  recentSeries: number[];
  baselineSeries: number[];
  baselineLow: boolean;
  surge: boolean;
  ratioRecent: number;
  ratioLastPoint: number;
  slopeDiff: number;
}): ComparisonFreshness => {
  const lastValue = recentSeries[recentSeries.length - 1] ?? 0;
  const previousFourMean = positiveMean(candidateSeries.slice(-5, -1));
  const recentFourMean = positiveMean(candidateSeries.slice(-4));
  const priorMean = positiveMean(candidateSeries.slice(0, -4));
  const baselineMean = positiveMean(baselineSeries);
  const recentMean = positiveMean(recentSeries);

  const weekLift = safeDivide(lastValue, previousFourMean);
  const monthLift = safeDivide(recentFourMean, priorMean);
  const quarterLift = safeDivide(recentMean, baselineMean);

  if (baselineLow && surge) {
    return {
      status: "new",
      label: "新词",
      window: "90d",
      score: 100,
      reason: "历史基线很低，最近窗口明显起量。",
    };
  }

  if (
    lastValue >= MIN_RECENT_MEAN &&
    weekLift >= 1.8 &&
    ratioLastPoint >= 0.9 &&
    slopeDiff > 0
  ) {
    return {
      status: "old_hot",
      label: "老词新热",
      window: "7d",
      score: 90,
      reason: `最近一周相对前序均值提升 ${formatRatio(weekLift)}，且末端接近或超过基准。`,
    };
  }

  if (
    recentFourMean >= MIN_RECENT_MEAN &&
    monthLift >= 1.5 &&
    ratioRecent >= 0.8 &&
    slopeDiff > 0
  ) {
    return {
      status: "old_hot",
      label: "老词新热",
      window: "30d",
      score: 80,
      reason: `最近一个月相对历史均值提升 ${formatRatio(monthLift)}，趋势仍在上行。`,
    };
  }

  if (
    recentMean >= MIN_RECENT_MEAN &&
    quarterLift >= 1.5 &&
    ratioRecent >= 0.7 &&
    slopeDiff > 0
  ) {
    return {
      status: "old_hot",
      label: "老词新热",
      window: "90d",
      score: 70,
      reason: `最近三个月相对历史基线提升 ${formatRatio(quarterLift)}。`,
    };
  }

  if (baselineMean >= MIN_RECENT_MEAN && recentMean >= MIN_RECENT_MEAN) {
    return {
      status: "stable_old",
      label: "稳定老词",
      window: "none",
      score: 30,
      reason: "历史和近期都有稳定需求，但未检测到明显近期起势。",
    };
  }

  return {
    status: "unclear",
    label: "待观察",
    window: "none",
    score: 40,
    reason: "趋势信号不足，暂时无法判断是否近期起势。",
  };
};

/* ── Decay risk ─────────────────────────────────────────────── */

const computeDecayRisk = (values: number[]): "high" | "medium" | "low" => {
  if (values.length < 4) return "low";
  const tail = values.slice(-3);
  const head = values.slice(0, -3);
  const tailAvg = positiveMean(tail);
  const headAvg = positiveMean(head);
  if (headAvg <= 0) return "low";
  const ratio = tailAvg / headAvg;
  if (ratio < 0.5) return "high";
  if (ratio < 0.8) return "medium";
  return "low";
};

/* ── Verdict explanation builder ────────────────────────────── */

const buildVerdictExplanation = ({
  verdict,
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
}: {
  verdict: ComparisonResult["verdict"];
  poolQualified: boolean;
  config: ComparisonSignalConfig;
  baselineMean: number;
  baselinePeak: number;
  recentMean: number;
  recentPeak: number;
  ratioMean: number;
  ratioRecent: number;
  ratioCoverage: number;
  ratioPeak: number;
  ratioLastPoint: number;
  endStreak: number;
  endVsPeak: number;
  volatility: number;
  slopeRatio: number;
  slopeDiff: number;
}): ComparisonExplanation => {
  const reasons: string[] = [];
  const baselineLow =
    baselineMean <= NEWNESS_BASELINE_MEAN_MAX && baselinePeak <= NEWNESS_BASELINE_PEAK_MAX;
  const surgeThreshold = Math.max(
    MIN_RECENT_MEAN,
    baselineMean * NEWNESS_SURGE_MULTIPLIER
  );
  const surge = recentMean >= surgeThreshold;

  const metrics = {
    isNew: baselineLow && surge,
    poolQualified,
    baselineMean: formatNumber(baselineMean),
    baselinePeak: formatNumber(baselinePeak),
    recentMean: formatNumber(recentMean),
    recentPeak: formatNumber(recentPeak),
    ratioMean: formatNumber(ratioMean),
    ratioRecent: formatNumber(ratioRecent),
    ratioLastPoint: formatNumber(ratioLastPoint),
    ratioCoverage: formatNumber(ratioCoverage),
    ratioPeak: formatNumber(ratioPeak),
    endStreak,
    endVsPeak: formatNumber(endVsPeak),
    volatility: formatNumber(volatility),
    slopeRatio: formatNumber(slopeRatio),
    slopeDiff: formatNumber(slopeDiff),
  };

  const poolSignals = [
    `avg_ratio > ${formatRatio(config.avgRatioMin)}`,
    `last_point_ratio > ${formatRatio(config.lastPointRatioMin)}`,
    `peak_ratio > ${formatRatio(config.peakRatioMin)}`,
    `rising: slope_ratio > ${formatRatio(config.risingStrongMinSlopeRatio)} + tail_ratio > ${formatRatio(config.risingStrongMinTailRatio)} + last_point≈1(±${formatNumber(config.nearOneTolerance)})`,
  ];

  let summary = "未进入决策";

  if (!poolQualified) {
    summary = "未进入候选池";
    if (!baselineLow) {
      reasons.push(
        `基线偏高：历史均值 ${formatNumber(baselineMean)} / 历史峰值 ${formatNumber(baselinePeak)}`
      );
    }
    if (!surge) {
      reasons.push(
        `近期均值 ${formatNumber(recentMean)} 低于阈值 ${formatNumber(surgeThreshold)}`
      );
    }
    if (reasons.length === 0) {
      reasons.push(`未满足入池条件：${poolSignals.join("；")}`);
    } else {
      reasons.push(`入池条件：${poolSignals.join("；")}`);
    }
    return { summary, reasons, metrics };
  }

  reasons.push(
    `历史均值 ${formatNumber(baselineMean)} / 峰值 ${formatNumber(baselinePeak)}，近期均值 ${formatNumber(recentMean)} / 峰值 ${formatNumber(recentPeak)}`
  );
  reasons.push(`命中入池条件：${poolSignals.join("；")}`);

  if (verdict === "strong") {
    summary = "强通过";
    reasons.push(
      `满足强信号：覆盖率>=${MIN_COVERAGE_STRONG}，末端连续>=${MIN_END_STREAK_STRONG}，尾段比值>=${MIN_TAIL_RATIO_STRONG}，末端峰值>=${MIN_END_VS_PEAK_STRONG}，波动<=${MAX_VOLATILITY_STRONG}，斜率差>=-0.05`
    );
  } else if (verdict === "pass") {
    summary = "通过（可复核）";
    reasons.push(
      `通过（次优）：覆盖率>=${MIN_COVERAGE_PASS}，末端连续>=${MIN_END_STREAK_PASS}，尾段比值>=${MIN_TAIL_RATIO_PASS}，末端峰值>=${MIN_END_VS_PEAK_PASS}，波动<=${MAX_VOLATILITY_PASS}，斜率差>=-0.1`
    );
  } else if (verdict === "close") {
    summary = "接近通过";
    reasons.push(
      `接近通过：覆盖率>=${MIN_COVERAGE_CLOSE}，尾段比值>=${MIN_TAIL_RATIO_CLOSE}，末端峰值>=${MIN_END_VS_PEAK_CLOSE}`
    );
  } else if (verdict === "watch") {
    summary = "观察（watch）";
    reasons.push(
      "接近阈值：尾段比>=0.7 或 斜率比>=pass 阈值，或增长趋势仍为正。"
    );
  } else {
    summary = "不通过";
    reasons.push("未通过分级条件。");
  }

  reasons.push(
    `关键比值: avg=${formatRatio(ratioMean)}，recent=${formatRatio(ratioRecent)}，last_point=${formatRatio(ratioLastPoint)}，peak=${formatRatio(ratioPeak)}`
  );
  reasons.push(
    `形态：末端连续高于基准 ${endStreak} 天，末端峰值比 ${formatNumber(endVsPeak)}，波动率 ${formatNumber(volatility)}，斜率差 ${formatNumber(slopeDiff)}，斜率比 ${formatNumber(slopeRatio)}`
  );
  reasons.push(
    `当前参数: avg>${formatRatio(config.avgRatioMin)} / last_point>${formatRatio(config.lastPointRatioMin)} / peak>${formatRatio(config.peakRatioMin)} / risingSlope>${formatRatio(config.risingStrongMinSlopeRatio)}（tail>${formatRatio(config.risingStrongMinTailRatio)}）`
  );

  return { summary, reasons, metrics };
};

/* ── Fallback intent resolver ───────────────────────────────── */

const AI_HINTS = [
  "ai", "gpt", "llm", "agent", "chatbot", "prompt", "model", "rag",
  "embedding", "vector", "copilot", "assistant", "automation", "workflow",
  "sdk", "api",
];

const isLikelyAiKeyword = (keyword: string) => {
  const lower = keyword.toLowerCase();
  return AI_HINTS.some((hint) => lower.includes(hint));
};

const resolveFallbackIntent = (keyword: string) => {
  const text = keyword.trim();
  const lower = text.toLowerCase();

  const aiNewsHints = /(news|update|release|trend|analysis|report|新闻|资讯|报道|发布|更新)/i;
  const gameInfoHints = /(news|update|patch|guide|攻略|资讯|新闻|wiki|review|评测|测评|更新|补丁|版本|公告)/i;
  const gameHints = /(game|games|gaming|play|steam|itch|roblox|minecraft|fortnite|lol|dota|cs|valorant|pubg|手游|游戏|小游戏|联机|关卡|通关)/i;
  const toolHints = /(tool|calculator|converter|generator|editor|maker|builder|utility|模板|编辑|转换|生成|计算|制作|转换器|编辑器|工具)/i;
  const commerceHints = /(buy|price|deal|discount|shop|store|purchase|order|subscription|subscribe|官网|购买|订阅|价格|套餐|报价|客服|服务)/i;

  if (isLikelyAiKeyword(lower)) {
    if (aiNewsHints.test(lower)) {
      return {
        label: "AI News",
        demand: "User is looking for AI-related news, updates, or release information.",
        reason: "Keyword contains AI terms together with news or update hints.",
        confidence: 0.4,
      };
    }
    return {
      label: "AI Tools",
      demand: "User wants to find or use an AI tool or AI-powered service.",
      reason: "Keyword contains strong AI-related tool signals.",
      confidence: 0.45,
    };
  }

  if (gameHints.test(lower)) {
    if (gameInfoHints.test(lower)) {
      return {
        label: "Game Info",
        demand: "User wants game guides, reviews, patch notes, or update information.",
        reason: "Keyword combines game intent with news, guide, or review hints.",
        confidence: 0.4,
      };
    }
    return {
      label: "Games",
      demand: "User wants to find or play a game.",
      reason: "Keyword contains clear game or play-related hints.",
      confidence: 0.4,
    };
  }

  if (toolHints.test(lower)) {
    return {
      label: "Utility Tools",
      demand: "User wants a non-AI utility, builder, calculator, or editor.",
      reason: "Keyword contains strong tool, maker, converter, or editor hints.",
      confidence: 0.35,
    };
  }

  if (commerceHints.test(lower)) {
    return {
      label: "Commerce / Services",
      demand: "User wants to buy, subscribe to, or access a product or service.",
      reason: "Keyword contains buying, pricing, subscription, or service hints.",
      confidence: 0.35,
    };
  }

  return {
    label: "Other",
    demand: "Intent is ambiguous or spans multiple possible directions.",
    reason: "Keyword did not match any strong fallback intent pattern.",
    confidence: 0.2,
  };
};

/* ── Exported functions ─────────────────────────────────────── */

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

export const submitComparisonTasks = async (
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

  for (const requestBatch of requestBatches) {
    const payload = requestBatch.map((batch) => ({
      keywords: [...batch, benchmark],
      date_from: normalizeDate(dateFrom),
      date_to: normalizeDate(dateTo),
      type: "web",
      ...(options?.cacheKey ? { tag: options.cacheKey } : {}),
      ...(postback ? { postback_url: postback } : {}),
    }));

    const result = await requestWithRetry("post", TASK_POST_URL, {
      headers: buildAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (result?.status_code !== 20000) {
      throw new Error(result?.status_message || "Failed to create comparison tasks");
    }

    taskIds.push(
      ...(result.tasks || [])
        .filter((task: { status_code: number }) => task.status_code === 20100)
        .map((task: { id: string }) => task.id)
    );
  }

  return taskIds;
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
    const { submitSerpTasks, waitForSerpTasks, getSerpResults } = await import("./serp");
    const { inferIntentWithModel } = await import("./ai-intent");

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

export const resolveBenchmark = (override?: string) => {
  const envValue = process.env.BENCHMARK_KEYWORD;
  const cleanedOverride = typeof override === "string" ? override.trim() : "";
  const cleanedEnv = typeof envValue === "string" ? envValue.trim() : "";
  return cleanedOverride || cleanedEnv || "gpts";
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

/* ── Imports needed by the above (to avoid circular deps) ─── */

import {
  TASK_POST_URL,
  TASK_GET_URL,
  DEFAULT_COMPARISON_DAYS,
  COMPARISON_TASK_POST_BATCH_SIZE,
  resolveComparisonSignalConfig,
  normalizeDate,
  buildPostbackUrl,
  buildAuthHeaders,
  requestWithRetry,
} from "./dataforseo-client";
import { createBatches } from "./keyword-utils";

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
