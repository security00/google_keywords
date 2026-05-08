import "server-only";

import { d1Query } from "@/lib/d1";

export type GameOpportunityEnrichmentItem = {
  id: string;
  keyword: string;
  sourceSite: string | null;
  recommendation: string;
  trendRatio: number;
  trendSlope: number;
  serpAuth: number | null;
  reason: string | null;
  checkedAt: string;
  priorityScore: number;
  whyWorthDoing: string;
  intent: string;
  contentAngle: string;
  risk: string;
  format: string;
};

export type GameOpportunityEnrichmentPreview = {
  summary: {
    totalCandidates: number;
    topCount: number;
  };
  items: GameOpportunityEnrichmentItem[];
};

type PipelineOpportunityRow = {
  id: number | string;
  keyword: string;
  source_site: string | null;
  trend_ratio: number | null;
  trend_slope: number | null;
  serp_auth: number | null;
  recommendation: string | null;
  reason: string | null;
  trend_checked_at: string | null;
  discovered_at: string | null;
  created_at: string | null;
};

export const clampOpportunityLimit = (raw: number) => {
  if (!Number.isFinite(raw)) return 10;
  return Math.min(50, Math.max(1, Math.floor(raw)));
};

const priorityScoreFor = (row: PipelineOpportunityRow) => {
  const trendRatio = Number(row.trend_ratio ?? 0);
  const trendSlope = Number(row.trend_slope ?? 0);
  const serpAuth = row.serp_auth === null ? 2 : Number(row.serp_auth);
  const recommendationBoost = row.recommendation === "🔥 hot" ? 30 : row.recommendation === "📈 rising" ? 18 : 10;
  const competitionPenalty = Math.max(0, serpAuth) * 3;
  return Math.round((trendRatio * 12 + trendSlope * 4 + recommendationBoost - competitionPenalty) * 10) / 10;
};

const inferIntent = (keyword: string) => {
  const lower = keyword.toLowerCase();
  if (lower.includes("codes")) return "codes / rewards";
  if (lower.includes("guide") || lower.includes("walkthrough")) return "guide";
  if (lower.includes("download") || lower.includes("apk")) return "download";
  return "game discovery";
};

const inferFormat = (intent: string) => {
  if (intent === "codes / rewards") return "兑换码页 / 更新追踪";
  if (intent === "guide") return "攻略 / walkthrough";
  if (intent === "download") return "下载说明 / 替代入口";
  return "新游介绍 / 上手指南";
};

const buildRisk = (row: PipelineOpportunityRow) => {
  const serpAuth = row.serp_auth;
  if (serpAuth === null || serpAuth === undefined) return "SERP 竞争数据不足，需要上线前复查。";
  if (Number(serpAuth) <= 1) return "低权威竞争，适合快速测试内容。";
  if (Number(serpAuth) <= 3) return "中等竞争，需要更具体的角度和长尾标题。";
  return "竞争偏高，除非趋势继续走强，否则不建议优先投入。";
};

const enrichRow = (row: PipelineOpportunityRow): GameOpportunityEnrichmentItem => {
  const trendRatio = Number(row.trend_ratio ?? 0);
  const trendSlope = Number(row.trend_slope ?? 0);
  const intent = inferIntent(row.keyword);
  return {
    id: String(row.id),
    keyword: row.keyword,
    sourceSite: row.source_site,
    recommendation: row.recommendation || "unknown",
    trendRatio,
    trendSlope,
    serpAuth: row.serp_auth === null ? null : Number(row.serp_auth),
    reason: row.reason,
    checkedAt: row.trend_checked_at || row.discovered_at || row.created_at || "",
    priorityScore: priorityScoreFor(row),
    whyWorthDoing: `趋势强度约 ${trendRatio.toFixed(1)}x，当前被管道标记为 ${row.recommendation || "unknown"}。`,
    intent,
    contentAngle: `围绕 ${row.keyword} 做“是什么、怎么玩、是否值得关注”的快速内容切入。`,
    risk: buildRisk(row),
    format: inferFormat(intent),
  };
};

export async function getGameOpportunityEnrichmentPreview(
  limitInput = 10
): Promise<GameOpportunityEnrichmentPreview> {
  const limit = clampOpportunityLimit(limitInput);
  const { rows } = await d1Query<PipelineOpportunityRow>(
    `SELECT id, keyword, source_site, trend_ratio, trend_slope, serp_auth, recommendation, reason,
            trend_checked_at, discovered_at, created_at
     FROM game_keyword_pipeline
     WHERE keyword IS NOT NULL
       AND keyword != ''
       AND recommendation IS NOT NULL
       AND recommendation != '⏭️ skip'
     ORDER BY
       CASE recommendation
         WHEN '🔥 hot' THEN 3
         WHEN '📈 rising' THEN 2
         WHEN '🎯 niche' THEN 1
         ELSE 0
       END DESC,
       COALESCE(trend_ratio, 0) DESC,
       COALESCE(trend_checked_at, discovered_at, created_at) DESC
     LIMIT ?`,
    [limit]
  );

  const items = rows.map(enrichRow).sort((a, b) => b.priorityScore - a.priorityScore);
  return {
    summary: {
      totalCandidates: rows.length,
      topCount: items.length,
    },
    items,
  };
}
