import type { ComparisonSignalConfig, ComparisonFreshness, ComparisonExplanation, ComparisonResult } from "@/lib/types";
import {
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
  safeDivide,
} from "../dataforseo-client";
import { positiveMean, formatRatio, formatNumber } from "./trend-math";

/* ── Verdict classification ─────────────────────────────────── */

export const classifyVerdict = ({
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

export const buildFreshnessSignal = ({
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

export const computeDecayRisk = (values: number[]): "high" | "medium" | "low" => {
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

export const buildVerdictExplanation = ({
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

export const AI_HINTS = [
  "ai", "gpt", "llm", "agent", "chatbot", "prompt", "model", "rag",
  "embedding", "vector", "copilot", "assistant", "automation", "workflow",
  "sdk", "api",
];

export const isLikelyAiKeyword = (keyword: string) => {
  const lower = keyword.toLowerCase();
  return AI_HINTS.some((hint) => lower.includes(hint));
};

export const resolveFallbackIntent = (keyword: string) => {
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
