import crypto from "crypto";

import type {
  Candidate,
  OrganizedCandidates,
  ComparisonResult,
  DecayRisk,
  FilterSummary,
  ComparisonExplanation,
  ComparisonSeries,
  ComparisonIntent,
  ComparisonFreshness,
  ComparisonSignalConfig,
} from "@/lib/types";

const TASK_POST_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/task_post";
const TASKS_READY_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/tasks_ready";
const TASK_GET_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/task_get";
const SERP_TASK_POST_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/task_post";
const SERP_TASKS_READY_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/tasks_ready";
const SERP_TASK_GET_ADV_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/task_get/advanced";

const POLL_INTERVAL_MS = (() => {
  const raw = Number(process.env.TASK_POLL_INTERVAL_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.max(5_000, raw);
  return 10_000;
})();
const MAX_WAIT_MS = (() => {
  const raw = Number(process.env.TASK_MAX_WAIT_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(Math.max(60_000, raw), 1_800_000);
  return 600_000;
})();
const REQUEST_TIMEOUT_MS = 30_000;
const OPENROUTER_REQUEST_TIMEOUT_MS = 60_000;


const RECENT_POINTS = 7;
const RECENT_TAIL_POINTS = 3;
const NEWNESS_BASELINE_MEAN_MAX = 5;
const NEWNESS_BASELINE_PEAK_MAX = 12;
const NEWNESS_SURGE_MULTIPLIER = 3;
const MIN_RECENT_MEAN = 8;
const MIN_COVERAGE_STRONG = 0.7;
const MIN_COVERAGE_PASS = 0.55;
const MIN_COVERAGE_CLOSE = 0.4;
const MIN_END_STREAK_STRONG = 3;
const MIN_END_STREAK_PASS = 2;
const MIN_TAIL_RATIO_STRONG = 1.0;
const MIN_TAIL_RATIO_PASS = 0.9;
const MIN_TAIL_RATIO_CLOSE = 0.8;
const MIN_END_VS_PEAK_STRONG = 0.7;
const MIN_END_VS_PEAK_PASS = 0.55;
const MIN_END_VS_PEAK_CLOSE = 0.45;
const MAX_VOLATILITY_STRONG = 1.2;
const MAX_VOLATILITY_PASS = 1.5;
const MIN_PEAK_RATIO_SIGNAL = 1.2;
const MIN_LAST_POINT_RATIO_SIGNAL = 1.0;
const MIN_LAST_POINT_NEAR_ONE = 0.9;
const MAX_LAST_POINT_NEAR_ONE = 1.2;
const MIN_SLOPE_RATIO_SIGNAL = 1.35;

const DEFAULT_COMPARISON_SIGNAL_CONFIG: ComparisonSignalConfig = {
  avgRatioMin: 1,
  lastPointRatioMin: 1,
  peakRatioMin: 1.2,
  slopeRatioMinStrong: 1.35,
  slopeRatioMinPass: 0.9,
  risingStrongMinSlopeRatio: 1.35,
  risingStrongMinTailRatio: 1,
  nearOneTolerance: 0.1,
};

const parseEnvFloat = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const parseEnvInt = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const parseOverrideFloat = (
  raw: unknown,
  fallback: number,
  min: number,
  max: number
) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

export const resolveComparisonSignalConfig = (
  override?: Partial<ComparisonSignalConfig>
): ComparisonSignalConfig => {
  const envConfig: ComparisonSignalConfig = {
    avgRatioMin: parseEnvFloat(
      process.env.COMPARISON_AVG_RATIO_MIN,
      DEFAULT_COMPARISON_SIGNAL_CONFIG.avgRatioMin,
      0.2,
      10
    ),
    lastPointRatioMin: parseEnvFloat(
      process.env.COMPARISON_LAST_POINT_RATIO_MIN,
      DEFAULT_COMPARISON_SIGNAL_CONFIG.lastPointRatioMin,
      0.2,
      10
    ),
    peakRatioMin: parseEnvFloat(
      process.env.COMPARISON_PEAK_RATIO_MIN,
      DEFAULT_COMPARISON_SIGNAL_CONFIG.peakRatioMin,
      0.2,
      10
    ),
    slopeRatioMinStrong: parseEnvFloat(
      process.env.COMPARISON_SLOPE_RATIO_STRONG,
      DEFAULT_COMPARISON_SIGNAL_CONFIG.slopeRatioMinStrong,
      0.5,
      20
    ),
    slopeRatioMinPass: parseEnvFloat(
      process.env.COMPARISON_SLOPE_RATIO_PASS,
      DEFAULT_COMPARISON_SIGNAL_CONFIG.slopeRatioMinPass,
      0.2,
      20
    ),
    risingStrongMinSlopeRatio: parseEnvFloat(
      process.env.COMPARISON_RISING_STRONG_MIN_SLOPE_RATIO,
      DEFAULT_COMPARISON_SIGNAL_CONFIG.risingStrongMinSlopeRatio,
      0.5,
      20
    ),
    risingStrongMinTailRatio: parseEnvFloat(
      process.env.COMPARISON_RISING_STRONG_MIN_TAIL_RATIO,
      DEFAULT_COMPARISON_SIGNAL_CONFIG.risingStrongMinTailRatio,
      0.2,
      10
    ),
    nearOneTolerance: parseEnvFloat(
      process.env.COMPARISON_NEAR_ONE_TOLERANCE,
      DEFAULT_COMPARISON_SIGNAL_CONFIG.nearOneTolerance,
      0.01,
      0.5
    ),
  };

  if (!override) return envConfig;

  return {
    avgRatioMin: parseOverrideFloat(override.avgRatioMin, envConfig.avgRatioMin, 0.2, 10),
    lastPointRatioMin: parseOverrideFloat(
      override.lastPointRatioMin,
      envConfig.lastPointRatioMin,
      0.2,
      10
    ),
    peakRatioMin: parseOverrideFloat(
      override.peakRatioMin,
      envConfig.peakRatioMin,
      0.2,
      10
    ),
    slopeRatioMinStrong: parseOverrideFloat(
      override.slopeRatioMinStrong,
      envConfig.slopeRatioMinStrong,
      0.5,
      20
    ),
    slopeRatioMinPass: parseOverrideFloat(
      override.slopeRatioMinPass,
      envConfig.slopeRatioMinPass,
      0.2,
      20
    ),
    risingStrongMinSlopeRatio: parseOverrideFloat(
      override.risingStrongMinSlopeRatio,
      envConfig.risingStrongMinSlopeRatio,
      0.5,
      20
    ),
    risingStrongMinTailRatio: parseOverrideFloat(
      override.risingStrongMinTailRatio,
      envConfig.risingStrongMinTailRatio,
      0.2,
      10
    ),
    nearOneTolerance: parseOverrideFloat(
      override.nearOneTolerance,
      envConfig.nearOneTolerance,
      0.01,
      0.5
    ),
  };
};

const DEFAULT_CACHE_EXPIRY_HOURS = 24;
const DEFAULT_COMPARISON_DAYS = 90;

const DEFAULT_BENCHMARK = "gpts";

const DEFAULT_FILTER_TERMS = [
  "赌博",
  "博彩",
  "赌场",
  "投注",
  "黄金",
  "金价",
  "股市",
  "股票",
  "证券",
  "期货",
  "期货交易",
  "期货市场",
  "交易市场",
  "登录",
  "登入",
  "注册",
  "门户",
  "门户网站",
  "ice agent",
  "链接",
  "新闻",
  "名人",
  "电影",
  "word puzzle",
  "字谜",
  "gambling",
  "casino",
  "betting",
  "sportsbook",
  "odds",
  "lottery",
  "gold",
  "gold price",
  "stock market",
  "stock trading",
  "stock price",
  "stocks",
  "equity",
  "equities",
  "futures",
  "futures market",
  "futures trading",
  "login",
  "log in",
  "log-in",
  "signin",
  "sign in",
  "sign-in",
  "signup",
  "sign up",
  "sign-up",
  "register",
  "registration",
  "portal",
  "ice agent",
  "cartel",
  "ambush",
  "ambushed",
  "news",
  "celebrity",
  "actor",
  "singer",
  "movie",
  "film",
  "tv show",
  "riddle",
  "word riddle",
  "word puzzle",
  "word game",
  "crossword",
  "home depot",
  "brand",
  "company",
  "retailer",
  "store",
  "shopping",
  "movie news",
  "trailer",
  "cast",
  "border 2",
];
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.2";
const OPENROUTER_BATCH_SIZE = 12;
const SERP_TASK_BATCH_SIZE = 100;
const SERP_TOP_RESULTS = 5;
const SERP_LLM_RESULTS = 3;
const FILTER_CACHE_VERSION = "v4";
const EXPANSION_TASK_POST_BATCH_SIZE = 10;
const COMPARISON_TASK_POST_BATCH_SIZE = 25;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildPostbackUrl = (
  postbackUrl: string | undefined,
  cacheKey: string | undefined,
  apiType: "expand" | "compare" | "serp"
) => {
  if (!postbackUrl || !cacheKey) return undefined;

  // DataForSEO expects base URL only — parameters come via POST body
  return postbackUrl;
};

const normalizeDate = (value: string) => value.trim();

const roundTo = (value: number, digits = 2) =>
  Number(value.toFixed(digits));

const safeDivide = (numerator: number, denominator: number) => {
  if (denominator > 0) return numerator / denominator;
  if (numerator > 0) return 99;
  return 0;
};

const nearOne = (value: number, tolerance = 0.1) =>
  Math.abs(value - 1) <= tolerance;

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

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
const formatRatio = (value: number) => `${roundTo(value, 2)}x`;
const formatNumber = (value: number) => roundTo(value, 2);

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

/**
 * Compute decay risk from a time series.
 * Compares the tail (last 3 points) against the head (everything before).
 * - tail < 50% of head → high
 * - tail < 80% of head → medium
 * - otherwise → low
 */
const computeDecayRisk = (values: number[]): DecayRisk => {
  if (values.length < 4) return "low"; // not enough data
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

    // Pre-compute decayRisk for downstream use
    const decayRisk = item.series?.values?.length
      ? computeDecayRisk(item.series.values)
      : undefined;

    // Downgrade verdict if high decay risk
    const finalVerdict = decayRisk === "high" && verdict !== "watch" && verdict !== "fail"
      ? "close" as const
      : verdict;

    return { ...item, verdict: finalVerdict, freshness, decayRisk };
  });

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
const normalizeFilterTerms = (terms: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const cleaned = term.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }
  return result;
};

const SHARED_CACHE_TIMEZONE = "Asia/Shanghai";

const getTimezoneDateParts = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const getPart = (type: "year" | "month" | "day") =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
  };
};

const formatUtcDate = (date: Date) => date.toISOString().slice(0, 10);

// @internal used by resolveDateRange
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

export const normalizeKeywords = (keywords: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of keywords) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }

  return result;
};


export const buildAuthHeaders = () => {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    throw new Error("Missing DataForSEO credentials in environment variables.");
  }

  const credentials = Buffer.from(`${login}:${password}`).toString("base64");
  return {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/json",
  } satisfies HeadersInit;
};

const fetchJsonWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    const trimmed = text.trim();
    const data = trimmed ? JSON.parse(trimmed) : null;

    if (!response.ok) {
      const message = data?.status_message || response.statusText;
      throw new Error(message || "Request failed");
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
};

export const requestWithRetry = async (
  method: "get" | "post",
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  timeoutMs = REQUEST_TIMEOUT_MS
) => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const data = await fetchJsonWithTimeout(url, {
        ...options,
        method: method.toUpperCase(),
      }, timeoutMs);
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
      if (attempt < maxRetries - 1) {
        await sleep((attempt + 1) * 5_000);
      }
    }
  }

  throw lastError ?? new Error("Request failed");
};

const createBatches = <T,>(items: T[], batchSize: number) => {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
};

const getFilterTerms = () => {
  const envTerms = process.env.OPENROUTER_FILTER_TERMS;
  if (envTerms) {
    const parsed = envTerms.split(/[,;\n]+/).map((term) => term.trim());
    const normalized = normalizeFilterTerms(parsed);
    if (normalized.length > 0) return normalized;
  }
  return DEFAULT_FILTER_TERMS;
};

const buildOpenRouterHeaders = () => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY in environment variables.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const referer = process.env.OPENROUTER_SITE_URL;
  const title = process.env.OPENROUTER_APP_NAME;

  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;

  return headers satisfies HeadersInit;
};

const getOpenRouterConfig = () => {
  const baseUrl = (process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL)
    .replace(/\/+$/, "");
  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  return { baseUrl, model };
};

const extractJsonBlock = (text: string) => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
};

const extractResponseText = (result: unknown) => {
  const response = result as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };

  if (typeof response?.output_text === "string" && response.output_text) {
    return response.output_text;
  }

  const output = response?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (item?.type !== "message" || !Array.isArray(item.content)) continue;
      const text = item.content.find(
        (content) => content?.type === "output_text"
      )?.text;
      if (text) return text;
    }
  }

  return (
    response?.choices?.[0]?.message?.content ??
    response?.choices?.[0]?.text ??
    ""
  );
};

const AI_HINTS = [
  "ai",
  "gpt",
  "llm",
  "agent",
  "chatbot",
  "prompt",
  "model",
  "rag",
  "embedding",
  "vector",
  "copilot",
  "assistant",
  "automation",
  "workflow",
  "sdk",
  "api",
];

const INTENT_CATEGORIES = [
  "AI Tools",
  "AI News",
  "Games",
  "Game Info",
  "Utility Tools",
  "Commerce / Services",
  "Other",
];
const INTENT_BATCH_SIZE = 6;

const isLikelyAiKeyword = (keyword: string) => {
  const lower = keyword.toLowerCase();
  return AI_HINTS.some((hint) => lower.includes(hint));
};

const resolveFallbackIntent = (keyword: string): ComparisonIntent => {
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

const normalizeIntentLabel = (label: string) => {
  const cleaned = label.trim();
  if (!cleaned) return "Other";
  const matched = INTENT_CATEGORIES.find(
    (item) => item === cleaned || cleaned.includes(item)
  );
  return matched ?? "Other";
};

const buildIntentPayload = (summaries: SerpSummary[]) => ({
  categories: INTENT_CATEGORIES,
  keywords: summaries.map((summary) => ({
    keyword: summary.keyword,
    item_types: summary.itemTypes,
    item_type_counts: summary.itemTypeCounts,
    top_results: summary.topResults.slice(0, SERP_LLM_RESULTS),
  })),
  output:
    'Return strict JSON: { "intents": [ { "keyword": "", "label": "", "demand": "", "reason": "", "confidence": 0.0 } ] }',
  rules: [
    "label must be one of the values in categories",
    "demand must be a single concise sentence describing the user intent",
    "reason must briefly cite the SERP evidence",
    "confidence must be a number between 0 and 1 and may be omitted",
    "Return JSON only with no extra explanation",
  ],
});

export const inferIntentWithModel = async (
  summaries: SerpSummary[]
): Promise<Map<string, ComparisonIntent>> => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || summaries.length === 0) return new Map();

  const { baseUrl, model } = getOpenRouterConfig();
  const intentMap = new Map<string, ComparisonIntent>();
  const batches = createBatches(summaries, INTENT_BATCH_SIZE);
  const systemPrompt = [
    "You are a keyword intent classification assistant.",
    "Infer the user intent from SERP evidence and map it to one of the provided categories.",
    "Return JSON only.",
  ].join("\n");

  for (const batch of batches) {
    const payload = {
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify(buildIntentPayload(batch), null, 2),
        },
      ],
    };

    try {
      const result = await requestWithRetry(
        "post",
        `${baseUrl}/chat/completions`,
        {
          headers: buildOpenRouterHeaders(),
          body: JSON.stringify(payload),
        },
        3,
        OPENROUTER_REQUEST_TIMEOUT_MS
      );
      const content = extractResponseText(result);
      const parsed = extractJsonBlock(content);
      const intents = Array.isArray(parsed?.intents) ? parsed.intents : [];
      for (const item of intents) {
        const keyword = typeof item?.keyword === "string" ? item.keyword.trim() : "";
        if (!keyword) continue;
        const label = normalizeIntentLabel(
          typeof item?.label === "string" ? item.label : ""
        );
        const demand =
          typeof item?.demand === "string" && item.demand.trim()
            ? item.demand.trim()
            : "用户需求未明确";
        const reason =
          typeof item?.reason === "string" && item.reason.trim()
            ? item.reason.trim()
            : "SERP 证据不足";
        const confidence =
          typeof item?.confidence === "number" ? item.confidence : undefined;
        intentMap.set(keyword.toLowerCase(), {
          label,
          demand,
          reason,
          confidence,
        });
      }
    } catch (error) {
      console.warn("OpenRouter intent batch failed", error);
    }
  }

  return intentMap;
};

const ruleBasedBlockKeyword = (keyword: string, terms: string[]) => {
  const text = keyword.trim();
  if (!text) return true;
  const lower = text.toLowerCase();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;

  if (wordCount >= 7 || lower.length >= 60) return true;
  if (lower.includes("?")) return true;
  if (/(含义|释义|字谜|猜字谜|meaning|definition|riddle|crossword|puzzle)/i.test(text)) return true;
  if (/(城市|国家|机场|车站|港口|景区|公园|寺庙|教堂|city|country|airport|station|port|park|temple|church)/i.test(text)) {
    return true;
  }
  if (/\b(meaning|definition|riddle|crossword|puzzle|word game|word puzzle)\b/.test(lower)) {
    return true;
  }
  if (/\b(how to|where to|what is|who is|best|top|review)\b/.test(lower)) {
    return true;
  }
  if (/\b(trailer|cast|episode|season|movie|film|tv|series|anime|manga|novel|book|author|comic)\b/.test(lower)) {
    return true;
  }
  if (/\b(news|outage|incident|killed|shot|arrest|crime|weather|forecast)\b/.test(lower)) {
    return true;
  }

  for (const term of terms) {
    const cleaned = term.trim().toLowerCase();
    if (cleaned && lower.includes(cleaned)) {
      return true;
    }
  }

  return false;
};

const shouldUseSerpForKeyword = (keyword: string) => {
  const text = keyword.trim();
  if (!text) return false;
  if (isLikelyAiKeyword(text)) return false;

  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const hasUpper = /[A-Z]/.test(text);
  const hasDigit = /\d/.test(text);

  if (hasUpper || hasDigit) return true;
  if (words.length >= 2) return true;

  const single = words[0] ?? "";
  if (single && /^[a-z]+$/.test(single) && single.length >= 3) {
    return true;
  }

  return false;
};

export type SerpSummary = {
  keyword: string;
  itemTypes: string[];
  itemTypeCounts: Record<string, number>;
  topResults: Array<{
    title: string;
    url?: string;
    domain?: string;
    description?: string;
  }>;
};

const getSerpConfig = () => {
  const locationCodeRaw = process.env.SERP_LOCATION_CODE;
  const locationCode = locationCodeRaw ? Number(locationCodeRaw) : undefined;
  const locationName =
    process.env.SERP_LOCATION_NAME || "United States";
  const languageCode = process.env.SERP_LANGUAGE_CODE || "en";
  const device = process.env.SERP_DEVICE || "desktop";
  const os = process.env.SERP_OS || "windows";
  const depthRaw = process.env.SERP_DEPTH;
  const depth = depthRaw ? Number(depthRaw) : 10;

  return {
    locationCode: Number.isFinite(locationCode) ? locationCode : undefined,
    locationName,
    languageCode,
    device,
    os,
    depth: Number.isFinite(depth) && depth > 0 ? depth : 10,
  };
};

const getSerpCacheKeyPart = () => {
  const config = getSerpConfig();
  const location = config.locationCode ?? config.locationName;
  return `serp:${location}:${config.languageCode}:${config.device}:${config.os}:${config.depth}`;
};

const buildSerpTask = (keyword: string) => {
  const config = getSerpConfig();
  const task: Record<string, unknown> = {
    keyword,
    language_code: config.languageCode,
    device: config.device,
    os: config.os,
    depth: config.depth,
  };

  if (config.locationCode) {
    task.location_code = config.locationCode;
  } else {
    task.location_name = config.locationName;
  }

  return task;
};

export const submitSerpTasks = async (
  keywords: string[],
  options?: { postbackUrl?: string; cacheKey?: string }
) => {
  const batches = createBatches(keywords, SERP_TASK_BATCH_SIZE);
  const taskIds: string[] = [];
  const postback = buildPostbackUrl(options?.postbackUrl, options?.cacheKey, "serp");

  for (const batch of batches) {
    const payload = batch.map((keyword) => ({
      ...buildSerpTask(keyword),
      ...(options?.cacheKey ? { tag: options.cacheKey } : {}),
      ...(postback ? { postback_url: postback } : {}),
    }));
    const result = await requestWithRetry("post", SERP_TASK_POST_URL, {
      headers: buildAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (result?.status_code !== 20000) {
      throw new Error(result?.status_message || "Failed to create SERP tasks");
    }

    for (const task of result.tasks ?? []) {
      if (task?.status_code === 20100 && task?.id) {
        taskIds.push(task.id);
      }
    }
  }

  return taskIds;
};

export const waitForSerpTasks = async (taskIds: string[]) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];
  const startedAt = Date.now();

  while (pending.size > 0 && Date.now() - startedAt < MAX_WAIT_MS) {
    const result = await requestWithRetry("get", SERP_TASKS_READY_URL, {
      headers: buildAuthHeaders(),
    });

    if (result?.status_code === 20000) {
      const readyTasks = result?.tasks?.[0]?.result ?? [];
      for (const task of readyTasks) {
        const id = task?.id;
        if (id && pending.has(id)) {
          pending.delete(id);
          completed.push(id);
        }
      }
    }

    if (pending.size > 0) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  return completed;
};

export const getReadySerpTaskIds = async (taskIds: string[]) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];

  if (pending.size === 0) return completed;

  const result = await requestWithRetry("get", SERP_TASKS_READY_URL, {
    headers: buildAuthHeaders(),
  });

  if (result?.status_code === 20000) {
    const readyTasks = result?.tasks?.[0]?.result ?? [];
    for (const task of readyTasks) {
      const id = task?.id;
      if (id && pending.has(id)) {
        completed.push(id);
      }
    }
  }

  return completed;
};

export const summarizeSerpResult = (taskResult: Record<string, unknown>): SerpSummary => {
  const itemsRaw = taskResult.items;
  const items = Array.isArray(itemsRaw) ? itemsRaw : [];
  const toRecord = (value: unknown) =>
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  const itemTypeCounts: Record<string, number> = {};
  for (const item of items) {
    const record = toRecord(item);
    const type = record && typeof record.type === "string" ? record.type : "unknown";
    itemTypeCounts[type] = (itemTypeCounts[type] ?? 0) + 1;
  }

  const organicItems = items
    .map((item) => toRecord(item))
    .filter(
      (item): item is Record<string, unknown> =>
        item !== null && item.type === "organic"
    );
  const topResults = organicItems.slice(0, SERP_TOP_RESULTS).map((item) => ({
    title: typeof item.title === "string" ? item.title : "",
    url: typeof item.url === "string" ? item.url : undefined,
    domain: typeof item.domain === "string" ? item.domain : undefined,
    description:
      typeof item.description === "string" ? item.description : undefined,
  }));

  const itemTypes =
    Array.isArray(taskResult.item_types)
      ? taskResult.item_types
          .filter((type): type is string => typeof type === "string")
      : Object.keys(itemTypeCounts);

  return {
    keyword: typeof taskResult.keyword === "string" ? taskResult.keyword : "",
    itemTypes,
    itemTypeCounts,
    topResults,
  };
};

export const getSerpResults = async (taskIds: string[]) => {
  const summaries = new Map<string, SerpSummary>();

  for (const taskId of taskIds) {
    const result = await requestWithRetry(
      "get",
      `${SERP_TASK_GET_ADV_URL}/${taskId}`,
      {
        headers: buildAuthHeaders(),
      }
    );

    if (result?.status_code !== 20000) {
      continue;
    }

    for (const task of result?.tasks ?? []) {
      if (task?.status_code !== 20000) continue;
      const taskResult = task?.result?.[0];
      if (!taskResult) continue;
      const summary = summarizeSerpResult(taskResult);
      if (summary.keyword) {
        summaries.set(summary.keyword.toLowerCase(), summary);
      }
    }
  }

  return summaries;
};

export type FilterConfig = {
  enabled: boolean;
  model: string;
  terms: string[];
  prompt?: string;
};

export const resolveFilterConfig = ({
  useFilter,
  overrideTerms,
  prompt,
}: {
  useFilter: boolean;
  overrideTerms?: string[];
  prompt?: string;
}) => {
  const terms = overrideTerms?.length
    ? normalizeFilterTerms(overrideTerms)
    : getFilterTerms();
  const cleanedPrompt =
    typeof prompt === "string" && prompt.trim() ? prompt.trim() : undefined;

  if (!useFilter) {
    return {
      enabled: false,
      model: DEFAULT_OPENROUTER_MODEL,
      terms,
      prompt: cleanedPrompt,
    } satisfies FilterConfig;
  }

  const { model } = getOpenRouterConfig();
  return {
    enabled: true,
    model,
    terms,
    prompt: cleanedPrompt,
  } satisfies FilterConfig;
};

export const buildFilterCacheKey = (config: FilterConfig) => {
  if (!config.enabled) return "filter:off";
  const terms = config.terms.map((term) => term.toLowerCase()).sort().join("|");
  const promptKey = config.prompt ? `:prompt:${config.prompt.toLowerCase()}` : "";
  const serpKey = getSerpCacheKeyPart();
  return `filter:on:${FILTER_CACHE_VERSION}:${config.model}:${serpKey}:${terms}${promptKey}`;
};

const getCacheExpiryHours = () => {
  const raw = process.env.CACHE_EXPIRY_HOURS;
  const parsed = raw ? Number(raw) : DEFAULT_CACHE_EXPIRY_HOURS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_EXPIRY_HOURS;
};

// File cache removed — Workers don't have filesystem. Use D1 cache via lib/cache.ts.

export const submitExpansionTasks = async (
  keywords: string[],
  dateFrom: string,
  dateTo: string,
  options?: { postbackUrl?: string; cacheKey?: string }
) => {
  const postback = buildPostbackUrl(options?.postbackUrl, options?.cacheKey, "expand");
  const batches = createBatches(keywords, EXPANSION_TASK_POST_BATCH_SIZE);
  const taskIds: string[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const payload = batch.map((keyword) => ({
      keywords: [keyword],
      date_from: normalizeDate(dateFrom),
      date_to: normalizeDate(dateTo),
      type: "web",
      item_types: ["google_trends_queries_list"],
      ...(postback ? { postback_url: postback } : {}),
    }));

    const result = await requestWithRetry("post", TASK_POST_URL, {
      headers: buildAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (result?.status_code !== 20000) {
      console.error("[dataforseo/expand] task_post failed", {
        batchIndex: batchIndex + 1,
        totalBatches: batches.length,
        keywords: batch,
        statusCode: result?.status_code,
        statusMessage: result?.status_message,
        tasksCount: Array.isArray(result?.tasks) ? result.tasks.length : 0,
      });
      throw new Error(result?.status_message || "Failed to create expansion tasks");
    }

    const createdTaskIds = (result.tasks || [])
      .filter((task: { status_code: number }) => task.status_code === 20100)
      .map((task: { id: string }) => task.id);

    if (createdTaskIds.length === 0) {
      const taskDetails = (result.tasks || []).map((task: {
        status_code?: number;
        status_message?: string;
      }) => `${task.status_code ?? "unknown"}:${task.status_message ?? "unknown"}`);
      console.error("[dataforseo/expand] batch created 0 tasks", {
        batchIndex: batchIndex + 1,
        totalBatches: batches.length,
        keywords: batch,
        taskDetails,
        rawStatusCode: result?.status_code,
        rawStatusMessage: result?.status_message,
      });
      throw new Error(
        `Expansion batch ${batchIndex + 1}/${batches.length} created 0 tasks (${taskDetails.join("; ") || "no task details"})`
      );
    }

    taskIds.push(...createdTaskIds);
  }

  return taskIds;
};

export const waitForTasks = async (taskIds: string[]) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];
  const startedAt = Date.now();

  while (pending.size > 0 && Date.now() - startedAt < MAX_WAIT_MS) {
    const result = await requestWithRetry("get", TASKS_READY_URL, {
      headers: buildAuthHeaders(),
    });

    if (result?.status_code === 20000) {
      const readyTasks = result?.tasks?.[0]?.result ?? [];
      for (const task of readyTasks) {
        const id = task?.id;
        if (id && pending.has(id)) {
          pending.delete(id);
          completed.push(id);
        }
      }
    }

    if (pending.size > 0) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  return completed;
};

export const getReadyTaskIds = async (taskIds: string[]) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];

  if (pending.size === 0) return completed;

  const result = await requestWithRetry("get", TASKS_READY_URL, {
    headers: buildAuthHeaders(),
  });

  if (result?.status_code === 20000) {
    const readyTasks = result?.tasks?.[0]?.result ?? [];
    for (const task of readyTasks) {
      const id = task?.id;
      if (id && pending.has(id)) {
        completed.push(id);
      }
    }
  }

  return completed;
};

export const getExpansionResults = async (taskIds: string[]) => {
  const allCandidates: Candidate[] = [];

  for (const taskId of taskIds) {
    const result = await requestWithRetry("get", `${TASK_GET_URL}/${taskId}`, {
      headers: buildAuthHeaders(),
    });

    if (result?.status_code !== 20000) {
      continue;
    }

    for (const task of result?.tasks ?? []) {
      if (task?.status_code !== 20000) continue;

      const taskResult = task?.result?.[0];
      if (!taskResult) continue;

      const items = taskResult.items ?? [];
      const sourceKeyword = taskResult?.keywords?.[0] ?? "unknown";

      for (const item of items) {
        if (item?.type !== "google_trends_queries_list") continue;
        const data = item?.data;

        if (Array.isArray(data)) {
          for (const queryItem of data) {
            const queryText = queryItem?.query ?? "";
            const value = Number(queryItem?.value ?? 0);
            const queryType = String(queryItem?.type ?? "");
            const isRising = queryType.toLowerCase().includes("rising");

            if (queryText) {
              allCandidates.push({
                keyword: queryText,
                value,
                type: isRising ? "rising" : "top",
                source: sourceKeyword,
              });
            }
          }
        } else if (data && typeof data === "object") {
          for (const queryItem of data.top ?? []) {
            const queryText = queryItem?.query ?? "";
            const value = Number(queryItem?.value ?? 0);
            if (queryText) {
              allCandidates.push({
                keyword: queryText,
                value,
                type: "top",
                source: sourceKeyword,
              });
            }
          }

          for (const queryItem of data.rising ?? []) {
            const queryText = queryItem?.query ?? "";
            const value = Number(queryItem?.value ?? 0);
            if (queryText) {
              allCandidates.push({
                keyword: queryText,
                value,
                type: "rising",
                source: sourceKeyword,
              });
            }
          }
        }
      }
    }
  }

  return allCandidates;
};

export const organizeCandidates = (candidates: Candidate[]) => {
  const risingCandidates = candidates.filter((candidate) => candidate.type === "rising");
  const seen = new Map<string, Candidate>();

  for (const candidate of risingCandidates) {
    const key = candidate.keyword.toLowerCase();
    const existing = seen.get(key);
    if (!existing || candidate.value > existing.value) {
      seen.set(key, candidate);
    }
  }

  const uniqueCandidates = Array.from(seen.values());
  const sortedCandidates = uniqueCandidates.sort((a, b) => {
    const scoreDiff = Number(b.score ?? 0) - Number(a.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return b.value - a.value;
  });

  const organized: OrganizedCandidates = {
    explosive: [],
    fastRising: [],
    steadyRising: [],
    slowRising: [],
  };

  for (const candidate of sortedCandidates) {
    if (candidate.value > 500) {
      organized.explosive.push(candidate);
    } else if (candidate.value > 200) {
      organized.fastRising.push(candidate);
    } else if (candidate.value > 100) {
      organized.steadyRising.push(candidate);
    } else {
      organized.slowRising.push(candidate);
    }
  }

  return organized;
};

export const flattenOrganizedCandidates = (organized: OrganizedCandidates) => [
  ...organized.explosive,
  ...organized.fastRising,
  ...organized.steadyRising,
  ...organized.slowRising,
];

export const filterCandidatesWithModel = async (
  candidates: Candidate[],
  config: FilterConfig,
  options: {
    debug?: boolean;
  } = {}
) => {
  const log = (message: string, meta?: Record<string, unknown>) => {
    if (!options.debug) return;
    if (meta) {
      console.log(message, meta);
    } else {
      console.log(message);
    }
  };
  const sampleList = (items: string[], size = 8) => items.slice(0, size);
  const snippet = (text: string, size = 200) =>
    text.length > size ? `${text.slice(0, size)}...` : text;

  const summary: FilterSummary = {
    enabled: config.enabled,
    model: config.enabled ? config.model : undefined,
    total: candidates.length,
    removed: 0,
    kept: candidates.length,
  };

  if (!config.enabled) {
    log("[filter] skipped", { reason: "disabled" });
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    summary.skippedReason = "OPENROUTER_API_KEY is not configured";
    log("[filter] skipped", { reason: "missing_api_key" });
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  const uniqueKeywords = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidate.keyword.toLowerCase();
    if (!uniqueKeywords.has(key)) {
      uniqueKeywords.set(key, candidate);
    }
  }

  const keywords = Array.from(uniqueKeywords.values()).map(
    (candidate) => candidate.keyword
  );
  const normalizedTerms = config.terms.map((term) => term.toLowerCase());
  const preBlocked = new Set<string>();
  const serpKeywords: string[] = [];
  const keepDirect: string[] = [];
  const filterStartedAt = Date.now();

  for (const keyword of keywords) {
    if (ruleBasedBlockKeyword(keyword, normalizedTerms)) {
      preBlocked.add(keyword.toLowerCase());
      continue;
    }
    if (shouldUseSerpForKeyword(keyword)) {
      serpKeywords.push(keyword);
    } else {
      keepDirect.push(keyword);
    }
  }

  log("[filter] start", {
    total: keywords.length,
    preBlocked: preBlocked.size,
    serp: serpKeywords.length,
    keepDirect: keepDirect.length,
    model: config.model,
    serpSample: sampleList(serpKeywords),
    keepSample: sampleList(keepDirect),
    filterTermsCount: config.terms.length,
    filterTermsSample: sampleList(config.terms),
  });

  const blocked = new Set<string>(preBlocked);

  const { baseUrl, model } = getOpenRouterConfig();
  const baseSystemPrompt = [
    "You are a keyword filtering assistant for discovering NEW, EMERGING keywords with commercial potential.",
    "Your primary job is to distinguish between SUSTAINED DEMAND (keep) and SHORT-TERM HYPE (block).",
    "",
    "KEEP keywords that suggest:",
    "1) Tool/utility intent: builder, generator, converter, checker, analyzer, calculator, finder, remover, enhancer",
    "2) AI/automation intent: ai, gpt, copilot, agent, chatbot, automation, machine learning",
    "3) Software/SaaS intent: app, platform, extension, plugin, template, workflow, dashboard",
    "4) Informational search intent with commercial potential (not just curiosity)",
    "",
    "BLOCK keywords that suggest:",
    "1) ONE-TIME EVENTS: game launches, movie releases, album drops, celebrity news, seasonal trends",
    "   → Clues: specific game/movie/show names, release dates, patch notes, episode titles",
    "2) BRANDS & PRODUCTS: specific company names, product SKUs, retail brands",
    "3) ENTERTAINMENT: anime, manga, novels, TV shows, celebrities (unless AI-related)",
    "4) NEWS & EVENTS: crime, politics, weather, sports scores, awards",
    "5) GENERIC QUERIES: 'how to', 'what is', definitions, translations, spellings",
    "6) AUTH PAGES: login, sign up, register, portal, account",
    "7) PLACES & GEO: cities, countries, landmarks, airports, festivals",
    "",
    "KEY DISTINCTION:",
    "- 'ai character creator' → KEEP (tool intent, sustained demand)",
    "- 'palworld update 1.2' → BLOCK (one-time game event)",
    "- 'free ai headshot generator' → KEEP (tool + commercial)",
    "- 'spider man 4 trailer' → BLOCK (entertainment event)",
    "- 'ai video enhancer' → KEEP (tool + AI trend)",
    "- 'pokemon legends z-a release date' → BLOCK (game launch hype)",
    "",
    "When uncertain, lean toward KEEPING AI/tool-related keywords.",
  ].join("\n");

  const runOpenRouterBatches = async (summaries: SerpSummary[]) => {
    const batches = createBatches(summaries, OPENROUTER_BATCH_SIZE);
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const batchStartedAt = Date.now();
      log("[filter] openrouter batch start", {
        batch: index + 1,
        totalBatches: batches.length,
        size: batch.length,
        sample: sampleList(batch.map((item) => item.keyword)),
      });

      const payload = {
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: config.prompt
              ? `${baseSystemPrompt}\nAdditional instruction: ${config.prompt}`
              : baseSystemPrompt,
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                blacklist_topics: config.terms,
                keywords: batch.map((item) => ({
                  keyword: item.keyword,
                  item_types: item.itemTypes,
                  item_type_counts: item.itemTypeCounts,
                  top_results: item.topResults.slice(0, SERP_LLM_RESULTS),
                })),
                output: 'Return strict JSON: { "blocked": ["keyword"] }',
                rules: [
                  "blocked may only contain keywords from the provided input and must preserve original spelling",
                  "Judge by semantic meaning rather than exact word matching",
                  "Do not output explanations or extra fields",
                  "If nothing should be blocked, return an empty blocked array",
                ],
              },
              null,
              2
            ),
          },
        ],
        max_tokens: 800,
      };

      try {
        const beforeBlocked = blocked.size;
        const result = await requestWithRetry(
          "post",
          `${baseUrl}/chat/completions`,
          {
            headers: buildOpenRouterHeaders(),
            body: JSON.stringify(payload),
          },
          3,
          OPENROUTER_REQUEST_TIMEOUT_MS
        );

        const content =
          result?.choices?.[0]?.message?.content ??
          result?.choices?.[0]?.text ??
          "";
        const parsed = extractJsonBlock(content);
        if (!parsed) {
          log("[filter] openrouter parse failed", {
            batch: index + 1,
            totalBatches: batches.length,
            size: batch.length,
            content: snippet(content),
          });
        }

        const blockedList = Array.isArray(parsed?.blocked) ? parsed.blocked : [];
        const newlyBlocked: string[] = [];
        for (const item of blockedList) {
          if (typeof item === "string") {
            const lowered = item.toLowerCase();
            if (!blocked.has(lowered)) {
              newlyBlocked.push(item);
            }
            blocked.add(lowered);
          }
        }

        log("[filter] openrouter batch done", {
          batch: index + 1,
          totalBatches: batches.length,
          size: batch.length,
          blocked: blocked.size - beforeBlocked,
          newlyBlockedSample: sampleList(newlyBlocked),
          tookMs: Date.now() - batchStartedAt,
        });
      } catch (error) {
        console.warn("OpenRouter filter batch failed", error);
        log("[filter] openrouter batch error", {
          batch: index + 1,
          totalBatches: batches.length,
          size: batch.length,
          tookMs: Date.now() - batchStartedAt,
        });
      }
    }
  };

  if (serpKeywords.length > 0) {
    log("[filter] serp start", {
      keywords: serpKeywords.length,
      sample: sampleList(serpKeywords),
    });
    try {
      const taskIds = await submitSerpTasks(serpKeywords);
      log("[filter] serp tasks submitted", { taskCount: taskIds.length });
      const completed = await waitForSerpTasks(taskIds);
      log("[filter] serp tasks ready", { readyCount: completed.length });
      const summaries = await getSerpResults(completed);
      log("[filter] serp results", { summaries: summaries.size });

      const summariesForModel: SerpSummary[] = [];
      for (const keyword of serpKeywords) {
        const summary = summaries.get(keyword.toLowerCase());
        if (!summary) {
          blocked.add(keyword.toLowerCase());
          log("[filter] serp missing", { keyword });
          continue;
        }
        summariesForModel.push(summary);
      }

      if (summariesForModel.length > 0) {
        await runOpenRouterBatches(summariesForModel);
      }
    } catch (error) {
      console.warn("SERP filter failed", error);
      log("[filter] serp error", { message: (error as Error).message });
    }
  }

  if (blocked.size === 0) {
    summary.kept = candidates.length;
    log("[filter] done", {
      removed: summary.removed,
      kept: summary.kept,
      blocked: blocked.size,
      tookMs: Date.now() - filterStartedAt,
    });
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  const filtered = candidates.filter(
    (candidate) => !blocked.has(candidate.keyword.toLowerCase())
  );
  const blockedCandidates = candidates.filter((candidate) =>
    blocked.has(candidate.keyword.toLowerCase())
  );

  summary.removed = candidates.length - filtered.length;
  summary.kept = filtered.length;
  log("[filter] done", {
    removed: summary.removed,
    kept: summary.kept,
    blocked: blocked.size,
    tookMs: Date.now() - filterStartedAt,
  });
  return { filtered, blocked: blockedCandidates, summary };
};

export const filterCandidatesWithKeywordModel = async (
  candidates: Candidate[],
  config: FilterConfig,
  options: {
    debug?: boolean;
    batchSize?: number;
    maxCandidates?: number;
  } = {}
) => {
  const log = (message: string, meta?: Record<string, unknown>) => {
    if (!options.debug) return;
    if (meta) {
      console.log(message, meta);
    } else {
      console.log(message);
    }
  };

  const summary: FilterSummary = {
    enabled: config.enabled,
    model: config.enabled ? config.model : undefined,
    total: candidates.length,
    removed: 0,
    kept: candidates.length,
  };

  if (!config.enabled) {
    summary.skippedReason = "disabled";
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  if (!process.env.OPENROUTER_API_KEY) {
    summary.skippedReason = "OPENROUTER_API_KEY is not configured";
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  const uniqueCandidates = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidate.keyword.toLowerCase().trim();
    if (key && !uniqueCandidates.has(key)) uniqueCandidates.set(key, candidate);
  }

  const maxCandidates = Math.min(
    Math.max(Number(options.maxCandidates ?? process.env.OPENROUTER_PRECOMPUTE_FILTER_MAX ?? 900), 50),
    uniqueCandidates.size
  );
  const batchSize = Math.min(Math.max(Number(options.batchSize ?? 80), 10), 120);
  const candidatesForModel = Array.from(uniqueCandidates.values()).slice(0, maxCandidates);
  const batches = createBatches(candidatesForModel, batchSize);
  const blocked = new Set<string>();
  const { baseUrl, model } = getOpenRouterConfig();
  const startedAt = Date.now();

  const systemPrompt = [
    "You are filtering keyword research candidates before they are shown to a human operator.",
    "Keep durable, productizable, commercial keywords, especially AI tools, software, utilities, SaaS, templates, workflows, and automation.",
    "Block short-lived noise, entertainment/news/sports/games/politics/celebrity/exam answers/coupons/gambling/adult/domain spam/local navigation queries.",
    "Block exact brands or one-off entities unless the query clearly describes a reusable software/tool opportunity.",
    "When uncertain, keep AI/tool/SaaS intent and block pure news/event curiosity.",
    "Return strict JSON only.",
  ].join("\n");

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const payload = {
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: config.prompt
            ? `${systemPrompt}\nAdditional filter instruction: ${config.prompt}`
            : systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify({
            blacklist_topics: config.terms,
            keywords: batch.map((candidate) => ({
              keyword: candidate.keyword,
              trend_value: candidate.value,
              source_seed: candidate.source,
              rule_score: candidate.score ?? 0,
            })),
            output: '{ "blocked": ["keyword"] }',
            rules: [
              "blocked may only include exact keywords from the provided input",
              "preserve original spelling",
              "do not include explanations",
              "if all keywords should be kept, return {\"blocked\":[]}",
            ],
          }),
        },
      ],
      max_tokens: 1400,
    };

    try {
      const response = await requestWithRetry(
        "post",
        `${baseUrl}/chat/completions`,
        {
          headers: buildOpenRouterHeaders(),
          body: JSON.stringify(payload),
        },
        2,
        OPENROUTER_REQUEST_TIMEOUT_MS
      );
      const content = extractResponseText(response);
      const parsed = extractJsonBlock(content);
      const blockedList = Array.isArray(parsed?.blocked) ? parsed.blocked : [];
      for (const item of blockedList) {
        if (typeof item === "string") blocked.add(item.toLowerCase().trim());
      }
      log("[precompute-llm-filter] batch done", {
        batch: index + 1,
        totalBatches: batches.length,
        size: batch.length,
        blocked: blockedList.length,
      });
    } catch (error) {
      log("[precompute-llm-filter] batch failed", {
        batch: index + 1,
        totalBatches: batches.length,
        message: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  }

  if (blocked.size === 0) {
    summary.skippedReason = "model returned no blocked keywords";
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  const filtered = candidates.filter(
    (candidate) => !blocked.has(candidate.keyword.toLowerCase().trim())
  );
  const blockedCandidates = candidates.filter((candidate) =>
    blocked.has(candidate.keyword.toLowerCase().trim())
  );

  summary.removed = blockedCandidates.length;
  summary.kept = filtered.length;
  log("[precompute-llm-filter] done", {
    removed: summary.removed,
    kept: summary.kept,
    tookMs: Date.now() - startedAt,
  });

  return { filtered, blocked: blockedCandidates, summary };
};

export const submitComparisonTasks = async (
  keywords: string[],
  dateFrom: string,
  dateTo: string,
  benchmark = DEFAULT_BENCHMARK,
  options?: { postbackUrl?: string; cacheKey?: string }
) => {
  const batches = createBatches(keywords, 4);
  const postback = buildPostbackUrl(options?.postbackUrl, options?.cacheKey, "compare");
  const requestBatches = createBatches(batches, COMPARISON_TASK_POST_BATCH_SIZE);
  const taskIds: string[] = [];

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
  benchmark = DEFAULT_BENCHMARK,
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
          // no-op: preserve current scoring behavior while making
          // baseline/surge locals explicit for future tuning
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
  benchmark = DEFAULT_BENCHMARK,
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
  return cleanedOverride || cleanedEnv || DEFAULT_BENCHMARK;
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
) => resolveDateRange(dateFrom, dateTo, DEFAULT_COMPARISON_DAYS);

export const summarizeResults = (results: ComparisonResult[]) => {
  return results.reduce(
    (acc, result) => {
      acc[result.verdict] += 1;
      return acc;
    },
    { strong: 0, pass: 0, close: 0, watch: 0, fail: 0 }
  );
};
