import "server-only";

import { d1Query } from "@/lib/d1";
import { oldEvaluationJoin, studentGameParams, studentGamePredicate, studentOldPredicate } from "./discovery-evidence";
import type { SaasEntitlement } from "@/lib/entitlements";

export type OpportunityPipeline = "google_new" | "game_new" | "validated_market";
export type OpportunityStatus = "strong_pass" | "pass" | "close" | "watch" | "skip";
export type OpportunityCategory = "ai_tools" | "games" | "saas" | "tools" | "templates" | "other";

export type KeywordOpportunity = {
  id: string;
  keyword: string;
  pipeline: OpportunityPipeline;
  category: OpportunityCategory;
  status: OpportunityStatus;
  opportunityScore: number | null;
  demandSummary: string;
  evidenceSummary: string;
  bestBuildType: string;
  riskLevel: "low" | "medium" | "high";
  currentHeat: number | null;
  recentRatio: number | null;
  peakRatio: number | null;
  trendSlope: number | null;
  sourceLabel: string;
  updatedAt: string | null;
  isPublicSample: boolean;
};

export type OpportunityFilters = {
  pipeline?: OpportunityPipeline;
  status?: OpportunityStatus;
  category?: OpportunityCategory;
  q?: string;
  limit?: number;
  offset?: number;
};

type GoogleNewRow = {
  id: string | null;
  keyword: string;
  ratio_recent: number | null;
  ratio_peak: number | null;
  slope_diff: number | null;
  verdict: string | null;
  summary: string | null;
  demand: string | null;
  roots: string | null;
  benchmark: string;
  freshness: string | null;
  created_at: string | null;
};

type GameRow = {
  id: number;
  keyword: string;
  source_site: string | null;
  trend_ratio: number | null;
  trend_slope: number | null;
  trend_verdict: string | null;
  recommendation: string | null;
  reason: string | null;
  trend_checked_at: string | null;
  serp_organic: number;
};

type OldRow = {
  id: number;
  keyword: string;
  source_seed: string | null;
  volume: number | null;
  cpc: number | null;
  kd: number | null;
  competition: string | null;
  intent: string | null;
  verified_score: number | null;
  serp_organic: number | null;
  scan_date: string | null;
};

export const PUBLIC_SAMPLE_OPPORTUNITIES: KeywordOpportunity[] = [
  {
    id: "sample:ai-tool",
    keyword: "browser extension generator",
    pipeline: "google_new",
    category: "ai_tools",
    status: "pass",
    opportunityScore: 82,
    demandSummary: "Tool-oriented AI workflow demand with a clear buildable angle.",
    evidenceSummary: "Static public sample. Full evidence is available to active users.",
    bestBuildType: "AI tool directory + generator landing page",
    riskLevel: "medium",
    currentHeat: 82,
    recentRatio: 1.8,
    peakRatio: 2.4,
    trendSlope: 0.7,
    sourceLabel: "Public sample",
    updatedAt: null,
    isPublicSample: true,
  },
  {
    id: "sample:game",
    keyword: "roblox clicker game",
    pipeline: "game_new",
    category: "games",
    status: "watch",
    opportunityScore: 76,
    demandSummary: "Game intent with potential guide, codes, and tool-page angles.",
    evidenceSummary: "Static public sample. Full game SERP checks are available to active users.",
    bestBuildType: "Game guide + calculator/tool page",
    riskLevel: "medium",
    currentHeat: 76,
    recentRatio: 1.5,
    peakRatio: 2.1,
    trendSlope: 0.5,
    sourceLabel: "Public sample",
    updatedAt: null,
    isPublicSample: true,
  },
  {
    id: "sample:validated-market",
    keyword: "pricing calculator template",
    pipeline: "validated_market",
    category: "templates",
    status: "close",
    opportunityScore: 69,
    demandSummary: "Validated business workflow keyword with template monetization potential.",
    evidenceSummary: "Static public sample. Full market data is available to active users.",
    bestBuildType: "Template library + calculator page",
    riskLevel: "low",
    currentHeat: 69,
    recentRatio: 1.2,
    peakRatio: 1.6,
    trendSlope: 0.2,
    sourceLabel: "Public sample",
    updatedAt: null,
    isPublicSample: true,
  },
];

const clampLimit = (value?: number) => {
  if (!Number.isFinite(value)) return 60;
  return Math.min(100, Math.max(1, Math.floor(Number(value))));
};

const clampOffset = (value?: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(Number(value)));
};

const scoreFromStatus = (status: OpportunityStatus) => {
  if (status === "strong_pass") return 90;
  if (status === "pass") return 78;
  if (status === "close") return 65;
  if (status === "watch") return 50;
  return 20;
};

const statusFromVerdict = (verdict?: string | null): OpportunityStatus => {
  if (verdict === "strong" || verdict === "hot") return "strong_pass";
  if (verdict === "pass" || verdict === "rising" || verdict === "niche") return "pass";
  if (verdict === "close") return "close";
  if (verdict === "watch") return "watch";
  return "skip";
};

const statusFromGameRecommendation = (value?: string | null): OpportunityStatus => {
  const text = (value || "").toLowerCase();
  if (text.includes("hot")) return "strong_pass";
  if (text.includes("rising") || text.includes("niche")) return "pass";
  if (text.includes("skip")) return "skip";
  return "watch";
};

const categoryForKeyword = (keyword: string, fallback?: OpportunityCategory): OpportunityCategory => {
  const lower = keyword.toLowerCase();
  if (fallback) return fallback;
  if (/\b(ai|gpts?|llms?|agents?|prompts?|chatbots?|automation)\b/.test(lower)) return "ai_tools";
  if (/(game|roblox|steam|minecraft|fortnite|play)/.test(lower)) return "games";
  if (/(template|notion|spreadsheet|worksheet)/.test(lower)) return "templates";
  if (/(calculator|converter|generator|tool|builder|checker)/.test(lower)) return "tools";
  if (/(crm|saas|platform|software|service)/.test(lower)) return "saas";
  return "other";
};

const riskFor = (status: OpportunityStatus, score: number): "low" | "medium" | "high" => {
  if (status === "skip" || score < 40) return "high";
  if (status === "watch" || score < 70) return "medium";
  return "low";
};

const mapGoogleRow = (row: GoogleNewRow): KeywordOpportunity => {
  const status = statusFromVerdict(row.verdict);
  const score = Math.min(100, Math.max(scoreFromStatus(status), Math.round(Number(row.ratio_recent || 0) * 30)));
  return {
    id: `google_new:${row.id || row.keyword}`,
    keyword: row.keyword,
    pipeline: "google_new",
    category: categoryForKeyword(row.keyword),
    status,
    opportunityScore: score,
    demandSummary: row.demand || "Review the search intent before choosing a page to build.",
    evidenceSummary: [row.summary, `Trend benchmark: ${row.benchmark}.`, row.freshness && `History: ${row.freshness.replaceAll("_", " ")}.`].filter(Boolean).join(" "),
    bestBuildType: categoryForKeyword(row.keyword) === "ai_tools" ? "AI tool page or workflow guide" : "Tool/content landing page",
    riskLevel: riskFor(status, score),
    currentHeat: row.ratio_recent,
    recentRatio: row.ratio_recent,
    peakRatio: row.ratio_peak,
    trendSlope: row.slope_diff,
    sourceLabel: row.roots ? `Shared research · seeds: ${row.roots}` : "Shared research",
    updatedAt: row.created_at,
    isPublicSample: false,
  };
};

const mapGameRow = (row: GameRow): KeywordOpportunity => {
  const status = statusFromGameRecommendation(row.recommendation);
  const score = Math.min(100, Math.max(scoreFromStatus(status), Math.round(Number(row.trend_ratio || 0) * 35)));
  return {
    id: `game_new:${row.id}`,
    keyword: row.keyword,
    pipeline: "game_new",
    category: "games",
    status,
    opportunityScore: score,
    demandSummary: row.reason || "Game keyword with trend and SERP relevance checks.",
    evidenceSummary: `${row.serp_organic} organic search results in the checked SERP.`,
    bestBuildType: "Game guide, codes page, helper tool, or niche fan utility",
    riskLevel: riskFor(status, score),
    currentHeat: row.trend_ratio,
    recentRatio: row.trend_ratio,
    peakRatio: null,
    trendSlope: row.trend_slope,
    sourceLabel: row.source_site || "Game pipeline",
    updatedAt: row.trend_checked_at,
    isPublicSample: false,
  };
};

const mapOldRow = (row: OldRow): KeywordOpportunity => {
  const score = row.verified_score == null ? null : Math.round(row.verified_score);
  const status: OpportunityStatus = score === null ? "watch" : score >= 85 ? "strong_pass" : score >= 70 ? "pass" : score >= 55 ? "close" : "watch";
  return {
    id: `validated_market:${row.id}`,
    keyword: row.keyword,
    pipeline: "validated_market",
    category: categoryForKeyword(row.keyword),
    status,
    opportunityScore: score,
    demandSummary: row.intent || "Validated market keyword with existing search demand.",
    evidenceSummary: `Monthly searches ${row.volume ?? "—"}, CPC $${row.cpc ?? "—"}, KD ${row.kd ?? "—"}. ${score === null ? "Awaiting a SERP check." : `${row.serp_organic} organic results checked.`}`,
    bestBuildType: categoryForKeyword(row.keyword) === "templates" ? "Template or calculator page" : "Niche content/tool site",
    riskLevel: score === null ? "medium" : riskFor(status, score),
    currentHeat: null,
    recentRatio: null,
    peakRatio: null,
    trendSlope: null,
    sourceLabel: row.source_seed || "Validated market pipeline",
    updatedAt: row.scan_date,
    isPublicSample: false,
  };
};

const matchesFilters = (item: KeywordOpportunity, filters: OpportunityFilters) => {
  if (filters.pipeline && item.pipeline !== filters.pipeline) return false;
  if (filters.status && item.status !== filters.status) return false;
  if (filters.category && item.category !== filters.category) return false;
  if (filters.q && !item.keyword.toLowerCase().includes(filters.q.toLowerCase())) return false;
  return true;
};

const opportunityTimestamp = (value: string | null) => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
};

const compareOpportunitiesByNewest = (
  a: KeywordOpportunity,
  b: KeywordOpportunity
) => {
  const timeDifference = opportunityTimestamp(b.updatedAt) - opportunityTimestamp(a.updatedAt);
  if (timeDifference) return timeDifference;

  const scoreDifference = (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1);
  if (scoreDifference !== 0) return scoreDifference;

  return a.keyword.localeCompare(b.keyword);
};

const optionalD1Query = async <T>(
  pipeline: OpportunityPipeline,
  sql: string,
  params: unknown[] = []
): Promise<{ rows: T[]; unavailable?: boolean }> => {
  try {
    return await d1Query<T>(sql, params);
  } catch (error) {
    console.error("[opportunities] source unavailable", pipeline, error instanceof Error ? error.message : "query failed");
    return { rows: [], unavailable: true };
  }
};

export async function listKeywordOpportunities(
  entitlement: SaasEntitlement,
  filters: OpportunityFilters = {}
) {
  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);

  if (!entitlement.allowed) {
    const items = PUBLIC_SAMPLE_OPPORTUNITIES.filter((item) => matchesFilters(item, filters));
    return {
      gated: true,
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  }

  const [google, games, old] = await Promise.all([
    optionalD1Query<GoogleNewRow>(
      "google_new",
      `WITH latest AS (
         SELECT * FROM shared_keyword_publications
         WHERE data_date BETWEEN date('now', '-14 days') AND date('now')
         ORDER BY data_date DESC, batch_date DESC LIMIT 1
       )
       SELECT batch_date || ':' || (j.value ->> '$.keyword') AS id, j.value ->> '$.keyword' AS keyword,
              j.value ->> '$.ratioRecent' AS ratio_recent, j.value ->> '$.ratioPeak' AS ratio_peak,
              j.value ->> '$.slopeDiff' AS slope_diff, j.value ->> '$.verdict' AS verdict,
              j.value ->> '$.summary' AS summary, j.value ->> '$.demand' AS demand, j.value ->> '$.freshness' AS freshness,
              (SELECT group_concat(value, ', ') FROM json_each(j.value, '$.roots')) AS roots,
              benchmark, data_date AS created_at
       FROM latest LEFT JOIN json_each(items_json) j ON j.value ->> '$.verdict' IN ('strong','pass','close','watch')
       ORDER BY CASE verdict WHEN 'strong' THEN 0 WHEN 'pass' THEN 1 WHEN 'close' THEN 2 ELSE 3 END,
                ratio_recent DESC, keyword
       LIMIT 80`
    ),
    optionalD1Query<GameRow>(
      "game_new",
      `SELECT id, keyword, source_site, trend_ratio, trend_slope, trend_verdict,
              recommendation, reason, trend_checked_at, serp_organic
       FROM (SELECT *, row_number() OVER (
               PARTITION BY lower(trim(keyword)) ORDER BY datetime(trend_checked_at) DESC, id DESC
             ) AS title_rank FROM game_keyword_pipeline WHERE ${studentGamePredicate})
       WHERE title_rank = 1 ORDER BY datetime(trend_checked_at) DESC, id DESC LIMIT 80`,
      studentGameParams(),
    ),
    optionalD1Query<OldRow>(
      "validated_market",
      `SELECT o.id, o.keyword, o.source_seed, o.volume, o.cpc, o.kd, o.competition, o.intent, o.scan_date,
              e.real_score AS verified_score, e.serp_organic
       FROM old_keyword_opportunities o ${oldEvaluationJoin}
       WHERE ${studentOldPredicate}
       ORDER BY verified_score DESC, o.score DESC, o.keyword
       LIMIT 80`
    ),
  ]);

  const items = [
    ...google.rows.filter(row => row.keyword).map(mapGoogleRow),
    ...games.rows.map(mapGameRow),
    ...old.rows.map(mapOldRow),
  ]
    .filter((item) => item.status !== "skip")
    .filter((item) => matchesFilters(item, filters))
    .sort(compareOpportunitiesByNewest);

  return {
    gated: false,
    publicationDate: google.rows[0]?.created_at ?? null,
    emptyPublication: google.rows.length > 0 && !google.rows[0].keyword,
    unavailableSources: [
      ...(google.unavailable ? ["google_new"] : []),
      ...(games.unavailable ? ["game_new"] : []),
      ...(old.unavailable ? ["validated_market"] : []),
    ],
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}
