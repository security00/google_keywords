import type { ComparisonSignalConfig } from "@/lib/types";
import {
  RECENT_POINTS as _RECENT_POINTS,
  RECENT_TAIL_POINTS as _RECENT_TAIL_POINTS,
  NEWNESS_BASELINE_MEAN_MAX as _NEWNESS_BASELINE_MEAN_MAX,
  NEWNESS_BASELINE_PEAK_MAX as _NEWNESS_BASELINE_PEAK_MAX,
  NEWNESS_SURGE_MULTIPLIER as _NEWNESS_SURGE_MULTIPLIER,
  MIN_RECENT_MEAN as _MIN_RECENT_MEAN,
  MIN_COVERAGE_STRONG as _MIN_COVERAGE_STRONG,
  MIN_COVERAGE_PASS as _MIN_COVERAGE_PASS,
  MIN_COVERAGE_CLOSE as _MIN_COVERAGE_CLOSE,
  MIN_END_STREAK_STRONG as _MIN_END_STREAK_STRONG,
  MIN_END_STREAK_PASS as _MIN_END_STREAK_PASS,
  MIN_TAIL_RATIO_STRONG as _MIN_TAIL_RATIO_STRONG,
  MIN_TAIL_RATIO_PASS as _MIN_TAIL_RATIO_PASS,
  MIN_TAIL_RATIO_CLOSE as _MIN_TAIL_RATIO_CLOSE,
  MIN_END_VS_PEAK_STRONG as _MIN_END_VS_PEAK_STRONG,
  MIN_END_VS_PEAK_PASS as _MIN_END_VS_PEAK_PASS,
  MIN_END_VS_PEAK_CLOSE as _MIN_END_VS_PEAK_CLOSE,
  MAX_VOLATILITY_STRONG as _MAX_VOLATILITY_STRONG,
  MAX_VOLATILITY_PASS as _MAX_VOLATILITY_PASS,
  DEFAULT_CACHE_EXPIRY_HOURS as _DEFAULT_CACHE_EXPIRY_HOURS,
  FILTER_CACHE_VERSION as _FILTER_CACHE_VERSION,
  SERP_BATCH_SIZE as _SERP_BATCH_SIZE,
  EXPANSION_BATCH_SIZE as _EXPANSION_BATCH_SIZE,
  COMPARISON_BATCH_SIZE as _COMPARISON_BATCH_SIZE,
  OPENROUTER_BATCH_SIZE as _OPENROUTER_BATCH_SIZE,
  DEFAULT_COMPARE_BENCHMARK as _DEFAULT_BENCHMARK,
} from "@/config/business-rules";

/* ── DataForSEO API URLs ────────────────────────────────────── */

export const TASK_POST_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/task_post";
export const TASKS_READY_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/tasks_ready";
export const TASK_GET_URL =
  "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/task_get";
export const SERP_TASK_POST_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/task_post";
export const SERP_TASKS_READY_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/tasks_ready";
export const SERP_TASK_GET_ADV_URL =
  "https://api.dataforseo.com/v3/serp/google/organic/task_get/advanced";

/* ── Polling / timeout config ───────────────────────────────── */

export const POLL_INTERVAL_MS = (() => {
  const raw = Number(process.env.TASK_POLL_INTERVAL_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.max(5_000, raw);
  return 10_000;
})();
export const MAX_WAIT_MS = (() => {
  const raw = Number(process.env.TASK_MAX_WAIT_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(Math.max(60_000, raw), 1_800_000);
  return 600_000;
})();
export const REQUEST_TIMEOUT_MS = 30_000;
export const OPENROUTER_REQUEST_TIMEOUT_MS = 60_000;

/* ── Signal config constants ────────────────────────────────── */

export const RECENT_POINTS = _RECENT_POINTS;
export const RECENT_TAIL_POINTS = _RECENT_TAIL_POINTS;
export const NEWNESS_BASELINE_MEAN_MAX = _NEWNESS_BASELINE_MEAN_MAX;
export const NEWNESS_BASELINE_PEAK_MAX = _NEWNESS_BASELINE_PEAK_MAX;
export const NEWNESS_SURGE_MULTIPLIER = _NEWNESS_SURGE_MULTIPLIER;
export const MIN_RECENT_MEAN = _MIN_RECENT_MEAN;
export const MIN_COVERAGE_STRONG = _MIN_COVERAGE_STRONG;
export const MIN_COVERAGE_PASS = _MIN_COVERAGE_PASS;
export const MIN_COVERAGE_CLOSE = _MIN_COVERAGE_CLOSE;
export const MIN_END_STREAK_STRONG = _MIN_END_STREAK_STRONG;
export const MIN_END_STREAK_PASS = _MIN_END_STREAK_PASS;
export const MIN_TAIL_RATIO_STRONG = _MIN_TAIL_RATIO_STRONG;
export const MIN_TAIL_RATIO_PASS = _MIN_TAIL_RATIO_PASS;
export const MIN_TAIL_RATIO_CLOSE = _MIN_TAIL_RATIO_CLOSE;
export const MIN_END_VS_PEAK_STRONG = _MIN_END_VS_PEAK_STRONG;
export const MIN_END_VS_PEAK_PASS = _MIN_END_VS_PEAK_PASS;
export const MIN_END_VS_PEAK_CLOSE = _MIN_END_VS_PEAK_CLOSE;
export const MAX_VOLATILITY_STRONG = _MAX_VOLATILITY_STRONG;
export const MAX_VOLATILITY_PASS = _MAX_VOLATILITY_PASS;
export const MIN_PEAK_RATIO_SIGNAL = 1.2;
export const MIN_LAST_POINT_RATIO_SIGNAL = 1.0;
export const MIN_LAST_POINT_NEAR_ONE = 0.9;
export const MAX_LAST_POINT_NEAR_ONE = 1.2;
export const MIN_SLOPE_RATIO_SIGNAL = 1.35;

/* ── Default comparison signal config ───────────────────────── */

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

/* ── Shared constants ──────────────────────────────────────── */

export const DEFAULT_CACHE_EXPIRY_HOURS = _DEFAULT_CACHE_EXPIRY_HOURS;
export const DEFAULT_COMPARISON_DAYS = 90;
export const DEFAULT_BENCHMARK = _DEFAULT_BENCHMARK;
export const FILTER_CACHE_VERSION = _FILTER_CACHE_VERSION;
export const SERP_TASK_BATCH_SIZE = _SERP_BATCH_SIZE;
export const SERP_TOP_RESULTS = 5;
export const SERP_LLM_RESULTS = 3;
export const EXPANSION_TASK_POST_BATCH_SIZE = _EXPANSION_BATCH_SIZE;
export const COMPARISON_TASK_POST_BATCH_SIZE = _COMPARISON_BATCH_SIZE;
export const OPENROUTER_BATCH_SIZE = _OPENROUTER_BATCH_SIZE;
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.2";

export const DEFAULT_FILTER_TERMS = [
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

/* ── Env parsing helpers ────────────────────────────────────── */

export const parseEnvFloat = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

export const parseEnvInt = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

export const parseOverrideFloat = (
  raw: unknown,
  fallback: number,
  min: number,
  max: number
) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

/* ── Comparison signal config resolver ──────────────────────── */

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

/* ── HTTP helpers ───────────────────────────────────────────── */

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/* ── Misc helpers ───────────────────────────────────────────── */

export const buildPostbackUrl = (
  postbackUrl: string | undefined,
  cacheKey: string | undefined,
  apiType: "expand" | "compare" | "serp"
) => {
  if (!postbackUrl || !cacheKey) return undefined;

  const separator = postbackUrl.includes("?") ? "&" : "?";
  const encoded = encodeURIComponent(cacheKey);
  return `${postbackUrl}${separator}type=${apiType}&cache_key=${encoded}`;
};

export const normalizeDate = (value: string) => value.trim();

export const roundTo = (value: number, digits = 2) =>
  Number(value.toFixed(digits));

export const safeDivide = (numerator: number, denominator: number) => {
  if (denominator > 0) return numerator / denominator;
  if (numerator > 0) return 99;
  return 0;
};
