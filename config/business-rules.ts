/**
 * config/business-rules.ts
 *
 * 集中管理所有业务阈值和评分规则。
 * TypeScript 端和 Python 端（通过 JSON export）共享同一份配置。
 *
 * ⚠️ 修改规则前先确认影响范围，改完后需同步 Python 端的 config/business-rules.json
 */

// ── Compare / Trends 评分阈值 ──

/** 最近数据点最小均值（归一化 0-100） */
export const MIN_RECENT_MEAN = 8;

/** 数据覆盖率阈值 */
export const MIN_COVERAGE_STRONG = 0.7;
export const MIN_COVERAGE_PASS = 0.55;
export const MIN_COVERAGE_CLOSE = 0.4;

/** 尾部连续高于 benchmark 的最小点数 */
export const MIN_END_STREAK_STRONG = 3;
export const MIN_END_STREAK_PASS = 2;

/** 尾部/均值比阈值 */
export const MIN_TAIL_RATIO_STRONG = 1.0;
export const MIN_TAIL_RATIO_PASS = 0.9;
export const MIN_TAIL_RATIO_CLOSE = 0.8;

/** 末值/峰值比阈值 */
export const MIN_END_VS_PEAK_STRONG = 0.7;
export const MIN_END_VS_PEAK_PASS = 0.55;
export const MIN_END_VS_PEAK_CLOSE = 0.45;

/** 波动率上限 */
export const MAX_VOLATILITY_STRONG = 1.2;
export const MAX_VOLATILITY_PASS = 1.5;

// ── 新鲜度 / 新词判断 ──

/** 最近数据点数 */
export const RECENT_POINTS = 7;
export const RECENT_TAIL_POINTS = 3;

/** 新词基线均值上限（归一化 0-100） */
export const NEWNESS_BASELINE_MEAN_MAX = 5;
export const NEWNESS_BASELINE_PEAK_MAX = 12;

/** 新词起势倍数 */
export const NEWNESS_SURGE_MULTIPLIER = 3;

// ── Expand 管道 ──

/** 每次提交 DataForSEO 的关键词批大小 */
export const EXPANSION_BATCH_SIZE = 10;

/** 推荐池上限（compare 阶段） */
export const RECOMMENDED_COMPARE_LIMIT = 50;

/** 默认过滤词类别 */
export const DEFAULT_FILTER_TERMS = [
  "adult content",
  "gambling",
  "illegal drugs",
  "weapons",
  "hate speech",
  "violence",
];

/** LLM 过滤提示中保留的类别（包括游戏词） */
export const FILTER_KEEP_CATEGORIES = [
  "online games",
  "game tools",
  "game platforms",
];

// ── Compare 管道 ──

/** 每次提交 DataForSEO 的对比关键词批大小 */
export const COMPARISON_BATCH_SIZE = 25;

/** 默认对比基准 */
export const DEFAULT_COMPARE_BENCHMARK = "gpts";

// ── SERP 管道 ──

/** SERP 查询批大小 */
export const SERP_BATCH_SIZE = 100;

// ── LLM / OpenRouter ──

/** OpenRouter 批量请求大小 */
export const OPENROUTER_BATCH_SIZE = 12;

/** 缓存过期时间（小时） */
export const DEFAULT_CACHE_EXPIRY_HOURS = 24;

/** 过滤缓存版本号 */
export const FILTER_CACHE_VERSION = "v4";

// ── 游戏 Pipeline ──

/** 游戏词推荐门槛：ratio >= 此值才推荐 */
export const GAME_MIN_RATIO = 1.0;

/** Hot 评分：ratio >= 此值 */
export const GAME_HOT_RATIO = 2.0;
/** Hot 评分：slope > 此值 */
export const GAME_HOT_SLOPE = 2;

/** Rising 评分：ratio >= 此值 */
export const GAME_RISING_RATIO = 0.5;
/** Rising 评分：slope > 此值 */
export const GAME_RISING_SLOPE = 0;

/** Niche 评分：ratio >= 此值 */
export const GAME_NICHE_RATIO = 0.5;

/** 历史基线：hist_vs_bench >= 此值判定为已建立 */
export const GAME_HIST_ESTABLISHED_BENCH_RATIO = 5.0;

/** 历史基线：hist_avg >= 此值判定为已建立（归一化 0-100） */
export const GAME_HIST_ESTABLISHED_ABSOLUTE = 50;

/** 历史基线：surge < 此值视为明显下滑，判定非起势词 */
export const GAME_HIST_DECLINING_SURGE = 0.8;

/** 历史基线：surge >= 此值视为"回春"例外 */
export const GAME_RESURGE_SURGE = 2.0;

/** 14天 fallback：avg >= 此值判定为已建立 */
export const GAME_14D_ESTABLISHED_AVG = 50;

/** 14天 fallback：avg >= 此值 + 下降 = 已建立 */
export const GAME_14D_DECLINING_AVG = 40;

/** 14天 fallback：avg/bench >= 此值 + 低波动 = 已建立 */
export const GAME_14D_STABLE_RATIO = 5.0;

/** 14天 fallback：波动系数上限 */
export const GAME_14D_LOW_CV = 0.15;

// ── 老词 Pipeline ──

/** 老词最小搜索量 */
export const OLD_WORD_MIN_VOLUME = 1000;

/** 老词最大 KD */
export const OLD_WORD_MAX_KD = 30;

/** 老词最小 CPC */
export const OLD_WORD_MIN_CPC = 0;

/** 老词趋势获取数量 */
export const OLD_WORD_TREND_TOP_N = 50;

/** 老词 SPIKE 阈值（head/tail ratio < 此值） */
export const OLD_WORD_SPIKE_RATIO = 0.5;

/** 老词 DECLINE 阈值 */
export const OLD_WORD_DECLINE_RATIO = 0.8;

// ── 千人千面 ──

/** 老词每人推荐数 */
export const OLD_WORD_PER_USER = 3;

/** 游戏词每人推荐数 */
export const GAME_KEYWORDS_PER_USER = 3;

// ── 缓存日期范围 ──

/** 默认 expand 日期范围（天） */
export const DEFAULT_EXPAND_DAYS = 7;

/** 默认 compare 日期范围（天） */
export const DEFAULT_COMPARE_DAYS = 90;

// ── 认证 ──

/** API Key 限流：最大失败次数 */
export const AUTH_MAX_FAILED_ATTEMPTS = 10;

/** API Key 限流：封禁时长（毫秒） */
export const AUTH_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/** 每用户最大 API Key 数 */
export const AUTH_MAX_KEYS_PER_USER = 5;

/** 试用期天数 */
export const AUTH_TRIAL_DAYS = 90;

/** Session 过期天数 */
export const AUTH_SESSION_EXPIRY_DAYS = 7;

/** 重置密码 token 有效期（毫秒） */
export const AUTH_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

// ── 导出 JSON 供 Python 端同步 ──

export const BUSINESS_RULES_JSON = {
  compare: {
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
    RECENT_POINTS,
    RECENT_TAIL_POINTS,
    NEWNESS_BASELINE_MEAN_MAX,
    NEWNESS_BASELINE_PEAK_MAX,
    NEWNESS_SURGE_MULTIPLIER,
    DEFAULT_COMPARE_BENCHMARK,
  },
  game: {
    GAME_MIN_RATIO,
    GAME_HOT_RATIO,
    GAME_HOT_SLOPE,
    GAME_RISING_RATIO,
    GAME_RISING_SLOPE,
    GAME_NICHE_RATIO,
    GAME_HIST_ESTABLISHED_BENCH_RATIO,
    GAME_HIST_ESTABLISHED_ABSOLUTE,
    GAME_RESURGE_SURGE,
    GAME_14D_ESTABLISHED_AVG,
    GAME_14D_DECLINING_AVG,
    GAME_14D_STABLE_RATIO,
    GAME_14D_LOW_CV,
    GAME_KEYWORDS_PER_USER,
  },
  old_word: {
    OLD_WORD_MIN_VOLUME,
    OLD_WORD_MAX_KD,
    OLD_WORD_MIN_CPC,
    OLD_WORD_TREND_TOP_N,
    OLD_WORD_SPIKE_RATIO,
    OLD_WORD_DECLINE_RATIO,
    OLD_WORD_PER_USER,
  },
  auth: {
    AUTH_MAX_FAILED_ATTEMPTS,
    AUTH_LOCKOUT_DURATION_MS,
    AUTH_MAX_KEYS_PER_USER,
    AUTH_TRIAL_DAYS,
    AUTH_SESSION_EXPIRY_DAYS,
    AUTH_RESET_TOKEN_TTL_MS,
  },
};
