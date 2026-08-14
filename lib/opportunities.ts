import "server-only";

import { d1Query } from "@/lib/d1";
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
  opportunityScore: number;
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
  explanation: string | null;
  intent: string | null;
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
  score: number | null;
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
  if (/(ai|gpt|llm|agent|prompt|chatbot|automation)/.test(lower)) return "ai_tools";
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

const parseIntentDemand = (raw: string | null) => {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.demand === "string") return parsed.demand;
    if (typeof parsed?.label === "string") return parsed.label;
  } catch {}
  return "";
};

const parseExplanationSummary = (raw: string | null) => {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.summary === "string") return parsed.summary;
  } catch {}
  return "";
};

const mapGoogleRow = (row: GoogleNewRow): KeywordOpportunity => {
  const status = statusFromVerdict(row.verdict);
  const score = Math.min(100, Math.max(scoreFromStatus(status), Math.round(Number(row.ratio_recent || 0) * 30)));
  const demand = parseIntentDemand(row.intent);
  return {
    id: `google_new:${row.id || row.keyword}`,
    keyword: row.keyword,
    pipeline: "google_new",
    category: categoryForKeyword(row.keyword),
    status,
    opportunityScore: score,
    demandSummary: demand || "Recent keyword movement with potential buildable search intent.",
    evidenceSummary: parseExplanationSummary(row.explanation) || "Trend comparison result from the new keyword pipeline.",
    bestBuildType: categoryForKeyword(row.keyword) === "ai_tools" ? "AI tool page or workflow guide" : "Tool/content landing page",
    riskLevel: riskFor(status, score),
    currentHeat: row.ratio_recent,
    recentRatio: row.ratio_recent,
    peakRatio: row.ratio_peak,
    trendSlope: row.slope_diff,
    sourceLabel: "New keyword pipeline",
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
    evidenceSummary: `${row.recommendation || "Game opportunity"} from ${row.source_site || "multi-source game radar"}.`,
    bestBuildType: "Game guide, codes page, helper tool, or niche fan utility",
    riskLevel: riskFor(status, score),
    currentHeat: row.trend_ratio,
    recentRatio: row.trend_ratio,
    peakRatio: row.trend_ratio,
    trendSlope: row.trend_slope,
    sourceLabel: row.source_site || "Game pipeline",
    updatedAt: row.trend_checked_at,
    isPublicSample: false,
  };
};

const mapOldRow = (row: OldRow): KeywordOpportunity => {
  const score = Math.min(100, Math.max(0, Math.round(Number(row.score || 0))));
  const status: OpportunityStatus = score >= 85 ? "strong_pass" : score >= 70 ? "pass" : score >= 55 ? "close" : "watch";
  return {
    id: `validated_market:${row.id}`,
    keyword: row.keyword,
    pipeline: "validated_market",
    category: categoryForKeyword(row.keyword),
    status,
    opportunityScore: score,
    demandSummary: row.intent || "Validated market keyword with existing search demand.",
    evidenceSummary: `Volume ${row.volume || 0}, CPC ${row.cpc || 0}, KD ${row.kd || 0}, competition ${row.competition || "-"}.`,
    bestBuildType: categoryForKeyword(row.keyword) === "templates" ? "Template or calculator page" : "Niche content/tool site",
    riskLevel: riskFor(status, score),
    currentHeat: row.volume,
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
  if (timeDifference !== 0) return timeDifference;

  const scoreDifference = b.opportunityScore - a.opportunityScore;
  if (scoreDifference !== 0) return scoreDifference;

  return a.keyword.localeCompare(b.keyword);
};

const isOptionalSourceError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("no such table") ||
    message.includes("no such column") ||
    message.includes("sqlite_error")
  );
};

const optionalD1Query = async <T>(
  sql: string,
  params: unknown[] = []
): Promise<{ rows: T[] }> => {
  try {
    return await d1Query<T>(sql, params);
  } catch (error) {
    if (isOptionalSourceError(error)) {
      return { rows: [] };
    }
    throw error;
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
      `SELECT id, keyword, ratio_recent, ratio_peak, slope_diff, verdict, explanation, intent, created_at
       FROM comparison_results
       WHERE verdict IN ('strong', 'pass', 'close', 'watch')
       ORDER BY created_at DESC
       LIMIT 80`
    ),
    optionalD1Query<GameRow>(
      `SELECT id, keyword, source_site, trend_ratio, trend_slope, trend_verdict,
              recommendation, reason, trend_checked_at
       FROM game_keyword_pipeline
       WHERE status = 'recommended'
       ORDER BY trend_checked_at DESC
       LIMIT 80`
    ),
    optionalD1Query<OldRow>(
      `SELECT id, keyword, source_seed, volume, cpc, kd, competition, intent, score, scan_date
       FROM old_keyword_opportunities
       WHERE scan_date = (SELECT MAX(scan_date) FROM old_keyword_opportunities)
       ORDER BY score DESC
       LIMIT 80`
    ),
  ]);

  const items = [
    ...google.rows.map(mapGoogleRow),
    ...games.rows.map(mapGameRow),
    ...old.rows.map(mapOldRow),
  ]
    .filter((item) => item.status !== "skip")
    .filter((item) => matchesFilters(item, filters))
    .sort(compareOpportunitiesByNewest);

  return {
    gated: false,
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}
