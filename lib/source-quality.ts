import "server-only";

import { d1Query } from "@/lib/d1";

export type GameSourceStatus = {
  label: string;
  tone: "active" | "muted";
  note: string | null;
};

export type GameSourceQualityRow = {
  source_site: string;
  total_checked: number;
  recommended_count: number;
  watchlist_count: number;
  hot_count: number;
  rising_count: number;
  niche_count: number;
  skip_count: number;
  avg_trend_ratio: number | null;
  avg_trend_slope: number | null;
  avg_serp_auth: number | null;
  snr: number;
  last_checked_at: string | null;
  status: GameSourceStatus;
};

export type SitemapSourceQualityRow = {
  source_id: string;
  name: string | null;
  sitemap_url: string;
  enabled: number;
  discovered_count: number;
  new_count: number;
  last_checked_at: string | null;
  last_extracted_at: string | null;
};

export type SourceQualitySummary = {
  sourceCount: number;
  totalChecked: number;
  totalRecommended: number;
  overallSnr: number;
  bestSource: string | null;
};

export type SourceQualityStats = {
  summary: SourceQualitySummary;
  gameSources: GameSourceQualityRow[];
  sitemapSources: SitemapSourceQualityRow[];
};

export const calculateSnr = (recommended: number, total: number) => {
  if (!Number.isFinite(recommended) || !Number.isFinite(total) || total <= 0) return 0;
  return recommended / total;
};

export const getGameSourceStatus = (_sourceSite: string): GameSourceStatus => {
  return { label: "当前来源", tone: "active", note: null };
};

export const buildSourceQualitySummary = (gameSources: GameSourceQualityRow[]): SourceQualitySummary => {
  const totalChecked = gameSources.reduce((sum, row) => sum + Number(row.total_checked || 0), 0);
  const totalRecommended = gameSources.reduce((sum, row) => sum + Number(row.recommended_count || 0), 0);
  const best = [...gameSources]
    .filter((row) => Number(row.total_checked || 0) > 0)
    .sort((a, b) => {
      if (b.snr !== a.snr) return b.snr - a.snr;
      return Number(b.recommended_count || 0) - Number(a.recommended_count || 0);
    })[0];

  return {
    sourceCount: gameSources.length,
    totalChecked,
    totalRecommended,
    overallSnr: calculateSnr(totalRecommended, totalChecked),
    bestSource: best?.source_site ?? null,
  };
};

export async function getSourceQualityStats(): Promise<SourceQualityStats> {
  const [{ rows: gameSources }, { rows: sitemapSources }] = await Promise.all([
    d1Query<GameSourceQualityRow>(
      `SELECT
         COALESCE(NULLIF(source_site, ''), 'unknown') AS source_site,
         COUNT(*) AS total_checked,
         SUM(CASE WHEN status = 'recommended' THEN 1 ELSE 0 END) AS recommended_count,
         SUM(CASE WHEN status = 'watchlist' THEN 1 ELSE 0 END) AS watchlist_count,
         SUM(CASE WHEN recommendation = '🔥 hot' THEN 1 ELSE 0 END) AS hot_count,
         SUM(CASE WHEN recommendation = '📈 rising' THEN 1 ELSE 0 END) AS rising_count,
         SUM(CASE WHEN recommendation = '🎯 niche' THEN 1 ELSE 0 END) AS niche_count,
         SUM(CASE WHEN recommendation = '⏭️ skip' THEN 1 ELSE 0 END) AS skip_count,
         AVG(trend_ratio) AS avg_trend_ratio,
         AVG(trend_slope) AS avg_trend_slope,
         AVG(serp_auth) AS avg_serp_auth,
         CAST(SUM(CASE WHEN status = 'recommended' THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0) AS snr,
         MAX(trend_checked_at) AS last_checked_at
       FROM game_keyword_pipeline
       GROUP BY COALESCE(NULLIF(source_site, ''), 'unknown')
       ORDER BY recommended_count DESC, snr DESC, total_checked DESC`
    ),
    d1Query<SitemapSourceQualityRow>(
      `SELECT
         s.id AS source_id,
         s.name,
         s.sitemap_url,
         s.enabled,
         COUNT(dk.id) AS discovered_count,
         SUM(CASE WHEN dk.status = 'new' THEN 1 ELSE 0 END) AS new_count,
         s.last_checked_at,
         MAX(dk.extracted_at) AS last_extracted_at
       FROM sitemap_sources s
       LEFT JOIN discovered_keywords dk ON dk.source_id = s.id
       GROUP BY s.id, s.name, s.sitemap_url, s.enabled, s.last_checked_at
       ORDER BY discovered_count DESC, s.last_checked_at DESC`
    ),
  ]);

  const normalizedGameSources = gameSources.map((row) => ({
    ...row,
    total_checked: Number(row.total_checked || 0),
    recommended_count: Number(row.recommended_count || 0),
    watchlist_count: Number(row.watchlist_count || 0),
    hot_count: Number(row.hot_count || 0),
    rising_count: Number(row.rising_count || 0),
    niche_count: Number(row.niche_count || 0),
    skip_count: Number(row.skip_count || 0),
    avg_trend_ratio: row.avg_trend_ratio === null ? null : Number(row.avg_trend_ratio),
    avg_trend_slope: row.avg_trend_slope === null ? null : Number(row.avg_trend_slope),
    avg_serp_auth: row.avg_serp_auth === null ? null : Number(row.avg_serp_auth),
    snr: Number(row.snr || 0),
    status: getGameSourceStatus(row.source_site),
  }));

  const normalizedSitemapSources = sitemapSources.map((row) => ({
    ...row,
    enabled: Number(row.enabled || 0),
    discovered_count: Number(row.discovered_count || 0),
    new_count: Number(row.new_count || 0),
  }));

  return {
    summary: buildSourceQualitySummary(normalizedGameSources),
    gameSources: normalizedGameSources,
    sitemapSources: normalizedSitemapSources,
  };
}
