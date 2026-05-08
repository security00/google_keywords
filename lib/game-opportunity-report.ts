import "server-only";

import {
  getGameOpportunityEnrichmentPreview,
  type GameOpportunityEnrichmentItem,
} from "./game-opportunity-enrichment";
import {
  listGameOpportunityFeedback,
  type GameOpportunityFeedback,
} from "./game-opportunity-feedback";
import { getSourceQualityStats, type GameSourceQualityRow } from "./source-quality";

export type GameOpportunityReportItem = GameOpportunityEnrichmentItem & {
  feedback: GameOpportunityFeedback | null;
};

export type GameOpportunityReport = {
  generatedAt: string;
  summary: {
    totalCandidates: number;
    topCount: number;
    worthDoingCount: number;
    notWorthDoingCount: number;
    sourceCount: number;
    totalChecked: number;
    totalRecommended: number;
    overallSnr: number;
    bestSource: string | null;
  };
  items: GameOpportunityReportItem[];
  topSources: GameSourceQualityRow[];
};

export async function getGameOpportunityReport(
  userId: string,
  limit = 10
): Promise<GameOpportunityReport> {
  const [preview, feedback, sourceQuality] = await Promise.all([
    getGameOpportunityEnrichmentPreview(limit),
    listGameOpportunityFeedback(userId),
    getSourceQualityStats(),
  ]);

  const feedbackById = new Map(feedback.map((item) => [item.opportunityId, item]));
  const items = preview.items.map((item) => ({
    ...item,
    feedback: feedbackById.get(item.id) ?? null,
  }));

  const worthDoingCount = feedback.filter((item) => item.verdict === "worth_doing").length;
  const notWorthDoingCount = feedback.filter((item) => item.verdict === "not_worth_doing").length;
  const topSources = [...sourceQuality.gameSources]
    .sort((a, b) => {
      if (b.recommended_count !== a.recommended_count) return b.recommended_count - a.recommended_count;
      if (b.snr !== a.snr) return b.snr - a.snr;
      return b.total_checked - a.total_checked;
    })
    .slice(0, 5);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalCandidates: preview.summary.totalCandidates,
      topCount: preview.summary.topCount,
      worthDoingCount,
      notWorthDoingCount,
      sourceCount: sourceQuality.summary.sourceCount,
      totalChecked: sourceQuality.summary.totalChecked,
      totalRecommended: sourceQuality.summary.totalRecommended,
      overallSnr: sourceQuality.summary.overallSnr,
      bestSource: sourceQuality.summary.bestSource,
    },
    items,
    topSources,
  };
}
