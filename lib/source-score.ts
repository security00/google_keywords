import "server-only";

import { d1Query } from "./d1";
import { getSourceQualityStats } from "./source-quality";

type FeedbackSourceRow = {
  source_site: string;
  worth_count: number;
  not_worth_count: number;
  feedback_count: number;
};

export type SourceScoreConfidence = "low" | "medium" | "high";

export type SourceScoreRow = {
  sourceSite: string;
  totalChecked: number;
  recommendedCount: number;
  snr: number;
  worthCount: number;
  notWorthCount: number;
  feedbackCount: number;
  feedbackScore: number;
  sourceScore: number;
  confidence: SourceScoreConfidence;
  lastCheckedAt: string | null;
};

export type SourceScoreStats = {
  summary: {
    sourceCount: number;
    bestSource: string | null;
    averageScore: number;
  };
  sources: SourceScoreRow[];
};

const round = (value: number) => Math.round(value * 10) / 10;

const confidenceFor = (feedbackCount: number, recommendedCount: number): SourceScoreConfidence => {
  if (feedbackCount >= 5 && recommendedCount >= 5) return "high";
  if (feedbackCount >= 2 || recommendedCount >= 5) return "medium";
  return "low";
};

const calculateFeedbackScore = (worthCount: number, notWorthCount: number) => {
  const total = worthCount + notWorthCount;
  if (total <= 0) return 0;
  return (worthCount - notWorthCount) / total;
};

const calculateSourceScore = (input: {
  snr: number;
  recommendedCount: number;
  worthCount: number;
  notWorthCount: number;
}) => {
  const feedbackScore = calculateFeedbackScore(input.worthCount, input.notWorthCount);
  const recommendationVolume = Math.min(input.recommendedCount / 10, 1);
  const snrScore = Math.min(Math.max(input.snr, 0), 1);

  return round((snrScore * 55 + recommendationVolume * 20 + feedbackScore * 25) * 100 / 100);
};

export async function getSourceScoreStats(): Promise<SourceScoreStats> {
  const [quality, { rows: feedbackRows }] = await Promise.all([
    getSourceQualityStats(),
    d1Query<FeedbackSourceRow>(
      `SELECT
         COALESCE(NULLIF(gkp.source_site, ''), 'unknown') AS source_site,
         SUM(CASE WHEN gof.verdict = 'worth_doing' THEN 1 ELSE 0 END) AS worth_count,
         SUM(CASE WHEN gof.verdict = 'not_worth_doing' THEN 1 ELSE 0 END) AS not_worth_count,
         COUNT(*) AS feedback_count
       FROM game_opportunity_feedback gof
       JOIN game_keyword_pipeline gkp ON CAST(gkp.id AS TEXT) = gof.opportunity_id
       GROUP BY COALESCE(NULLIF(gkp.source_site, ''), 'unknown')`
    ),
  ]);

  const feedbackBySource = new Map(
    feedbackRows.map((row) => [
      row.source_site,
      {
        worthCount: Number(row.worth_count || 0),
        notWorthCount: Number(row.not_worth_count || 0),
        feedbackCount: Number(row.feedback_count || 0),
      },
    ])
  );

  const sources = quality.gameSources
    .map((source) => {
      const feedback = feedbackBySource.get(source.source_site) || {
        worthCount: 0,
        notWorthCount: 0,
        feedbackCount: 0,
      };
      const feedbackScore = calculateFeedbackScore(feedback.worthCount, feedback.notWorthCount);
      const sourceScore = calculateSourceScore({
        snr: source.snr,
        recommendedCount: source.recommended_count,
        worthCount: feedback.worthCount,
        notWorthCount: feedback.notWorthCount,
      });

      return {
        sourceSite: source.source_site,
        totalChecked: source.total_checked,
        recommendedCount: source.recommended_count,
        snr: source.snr,
        worthCount: feedback.worthCount,
        notWorthCount: feedback.notWorthCount,
        feedbackCount: feedback.feedbackCount,
        feedbackScore,
        sourceScore,
        confidence: confidenceFor(feedback.feedbackCount, source.recommended_count),
        lastCheckedAt: source.last_checked_at,
      } satisfies SourceScoreRow;
    })
    .sort((a, b) => {
      if (b.sourceScore !== a.sourceScore) return b.sourceScore - a.sourceScore;
      if (b.recommendedCount !== a.recommendedCount) return b.recommendedCount - a.recommendedCount;
      return b.totalChecked - a.totalChecked;
    });

  return {
    summary: {
      sourceCount: sources.length,
      bestSource: sources[0]?.sourceSite ?? null,
      averageScore: sources.length
        ? round(sources.reduce((sum, source) => sum + source.sourceScore, 0) / sources.length)
        : 0,
    },
    sources,
  };
}
