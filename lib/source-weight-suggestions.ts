import "server-only";

import { getSourceScoreStats, type SourceScoreRow } from "./source-score";

export type SourceWeightSuggestionAction = "boost" | "downrank" | "watch";

export type SourceWeightSuggestion = {
  sourceSite: string;
  action: SourceWeightSuggestionAction;
  suggestedMultiplier: number;
  reason: string;
  worthRate: number | null;
  notWorthRate: number | null;
  feedbackCount: number;
  sourceScore: number;
  confidence: SourceScoreRow["confidence"];
  canAutoApply: false;
};

export type SourceWeightSuggestionStats = {
  summary: {
    boostCount: number;
    downrankCount: number;
    watchCount: number;
    total: number;
  };
  suggestions: SourceWeightSuggestion[];
};

const MIN_FEEDBACK_FOR_ACTION = 5;
const BOOST_WORTH_RATE = 0.7;
const DOWNRANK_NOT_WORTH_RATE = 0.6;

const rate = (count: number, total: number) => (total > 0 ? count / total : null);

const actionRank: Record<SourceWeightSuggestionAction, number> = {
  boost: 0,
  downrank: 1,
  watch: 2,
};

export const buildSourceWeightSuggestions = (
  sources: SourceScoreRow[]
): SourceWeightSuggestionStats => {
  const suggestions = sources
    .map((source) => {
      const worthRate = rate(source.worthCount, source.feedbackCount);
      const notWorthRate = rate(source.notWorthCount, source.feedbackCount);

      let action: SourceWeightSuggestionAction = "watch";
      let suggestedMultiplier = 1;
      let reason = "反馈样本不足，继续观察。";

      if (source.feedbackCount >= MIN_FEEDBACK_FOR_ACTION) {
        if ((worthRate ?? 0) >= BOOST_WORTH_RATE) {
          action = "boost";
          suggestedMultiplier = 1.2;
          reason = `值得率 ${Math.round((worthRate ?? 0) * 100)}%，建议后续人工确认后升权。`;
        } else if ((notWorthRate ?? 0) >= DOWNRANK_NOT_WORTH_RATE) {
          action = "downrank";
          suggestedMultiplier = 0.8;
          reason = `不值得率 ${Math.round((notWorthRate ?? 0) * 100)}%，建议后续人工确认后降权。`;
        } else {
          reason = "反馈分歧较大，继续观察。";
        }
      }

      return {
        sourceSite: source.sourceSite,
        action,
        suggestedMultiplier,
        reason,
        worthRate,
        notWorthRate,
        feedbackCount: source.feedbackCount,
        sourceScore: source.sourceScore,
        confidence: source.confidence,
        canAutoApply: false,
      } satisfies SourceWeightSuggestion;
    })
    .sort((a, b) => {
      if (actionRank[a.action] !== actionRank[b.action]) return actionRank[a.action] - actionRank[b.action];
      if (b.feedbackCount !== a.feedbackCount) return b.feedbackCount - a.feedbackCount;
      return b.sourceScore - a.sourceScore;
    });

  const boostCount = suggestions.filter((item) => item.action === "boost").length;
  const downrankCount = suggestions.filter((item) => item.action === "downrank").length;
  const watchCount = suggestions.filter((item) => item.action === "watch").length;

  return {
    summary: {
      boostCount,
      downrankCount,
      watchCount,
      total: suggestions.length,
    },
    suggestions,
  };
};

export async function getSourceWeightSuggestionStats(): Promise<SourceWeightSuggestionStats> {
  const sourceScore = await getSourceScoreStats();
  return buildSourceWeightSuggestions(sourceScore.sources);
}
