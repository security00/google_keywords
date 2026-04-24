import { NextResponse } from "next/server";

import {
  buildFilterCacheKey,
  normalizeKeywords,
  organizeCandidates,
  flattenOrganizedCandidates,
  resolveFilterConfig,
  resolveDateRange,
  submitExpansionTasks,
} from "@/lib/keyword-research";
import type { ExpandResponse } from "@/lib/types";
import sharedKeywordDefaults from "@/config/shared-keyword-defaults.json";

import { buildCacheKey, getCached, setCache } from "@/lib/cache";
import { createJob, getJob } from "@/lib/research-jobs";
import { d1Query } from "@/lib/d1";

const getGameKeywords = async () => {
  try {
    const result = await d1Query(
      "SELECT keyword, source_site, trend_ratio, trend_slope, trend_verdict, recommendation, reason, trend_series FROM game_keyword_pipeline WHERE recommendation IS NOT NULL AND recommendation != '⏭️ skip' ORDER BY trend_ratio DESC LIMIT 20"
    );
    return (result?.rows || []).map((row: Record<string, unknown>) => ({
      keyword: row.keyword,
      sourceSite: row.source_site,
      trendRatio: row.trend_ratio,
      trendSlope: row.trend_slope,
      trendVerdict: row.trend_verdict,
      recommendation: row.recommendation,
      reason: row.reason,
      trendSeries: row.trend_series ? JSON.parse(row.trend_series as string) : null,
    }));
  } catch {
    return [];
  }
};

export const isCronAuthorized = (request: Request) => {
  const secret = process.env.CRON_SECRET;
  const externalSecret = process.env.EXTERNAL_CRON_SECRET;
  if (!secret && !externalSecret) return false;

  const headerSecret = request.headers.get("x-cron-secret");
  if (secret && headerSecret === secret) return true;
  if (externalSecret && headerSecret === externalSecret) return true;

  const authHeader = request.headers.get("authorization");
  if (secret && authHeader === `Bearer ${secret}`) return true;
  if (externalSecret && authHeader === `Bearer ${externalSecret}`) return true;

  return false;
};

export const DEFAULT_SHARED_KEYWORDS = normalizeKeywords(
  Array.isArray(sharedKeywordDefaults.defaultKeywords)
    ? sharedKeywordDefaults.defaultKeywords
    : []
);

export const toComparableKeywordList = (keywords: string[]) =>
  [...keywords].map((item) => item.trim().toLowerCase()).sort();

export const isDefaultSharedKeywordRequest = (keywords: string[]) => {
  if (keywords.length !== DEFAULT_SHARED_KEYWORDS.length) return false;
  const left = toComparableKeywordList(keywords);
  const right = toComparableKeywordList(DEFAULT_SHARED_KEYWORDS);
  return left.every((item, index) => item === right[index]);
};

export const parseResponseLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(Math.max(Math.floor(parsed), 50), 5000);
};

/**
 * Unified fallback: find a recent successful expand_result from cache.
 */
export const findCachedExpandFallback = async (keywords: string[]) => {
  const expected = toComparableKeywordList(keywords);

  const { rows: trimRows } = await d1Query<{
    response_data: string;
    cache_key: string;
    created_at: string;
  }>(
    `SELECT response_data, cache_key, created_at
     FROM query_cache
     WHERE cache_key LIKE '%:expand_result:%:_trimmed'
     ORDER BY created_at DESC
     LIMIT 10`
  );

  for (const row of trimRows) {
    try {
      const response = JSON.parse(row.response_data) as ExpandResponse;
      if (!Array.isArray(response.flatList) || response.flatList.length === 0) continue;
      const responseKeywords = Array.isArray(response.keywords) ? normalizeKeywords(response.keywords) : [];
      const comparable = toComparableKeywordList(responseKeywords);
      if (comparable.length === expected.length && comparable.every((item, i) => item === expected[i])) {
        return { response, cacheKey: row.cache_key, createdAt: row.created_at, mode: "keyword_exact" as const };
      }
    } catch { continue; }
  }

  for (const row of trimRows) {
    try {
      const response = JSON.parse(row.response_data) as ExpandResponse;
      if (Array.isArray(response.flatList) && response.flatList.length > 0) {
        return { response, cacheKey: row.cache_key, createdAt: row.created_at, mode: "any_trimmed" as const };
      }
    } catch { continue; }
  }

  const { rows: fullRows } = await d1Query<{
    response_data: string;
    cache_key: string;
    created_at: string;
  }>(
    `SELECT response_data, cache_key, created_at
     FROM query_cache
     WHERE cache_key LIKE '%:expand_result:%' AND cache_key NOT LIKE '%:_trimmed'
     ORDER BY created_at DESC
     LIMIT 5`
  );

  for (const row of fullRows) {
    try {
      const response = JSON.parse(row.response_data) as ExpandResponse;
      if (!Array.isArray(response.flatList) || response.flatList.length === 0) continue;
      if (row.response_data.length > 200_000) continue;
      const responseKeywords = Array.isArray(response.keywords) ? normalizeKeywords(response.keywords) : [];
      const comparable = toComparableKeywordList(responseKeywords);
      if (comparable.length === expected.length && comparable.every((item, i) => item === expected[i])) {
        return { response, cacheKey: row.cache_key, createdAt: row.created_at, mode: "keyword_exact_full" as const };
      }
    } catch { continue; }
  }

  for (const row of fullRows) {
    try {
      const response = JSON.parse(row.response_data) as ExpandResponse;
      if (Array.isArray(response.flatList) && response.flatList.length > 0 && row.response_data.length <= 200_000) {
        return { response, cacheKey: row.cache_key, createdAt: row.created_at, mode: "any_full" as const };
      }
    } catch { continue; }
  }

  return null;
};

export const trimExpandResponse = (response: ExpandResponse, limit?: number) => {
  if (!limit || response.flatList.length <= limit) return response;

  const fullOrganized = organizeCandidates(response.candidates);
  const sectionKeys = ["explosive", "fastRising", "steadyRising", "slowRising"] as const;
  const baseQuota = Math.floor(limit / sectionKeys.length);
  const organized = {
    explosive: [] as typeof response.candidates,
    fastRising: [] as typeof response.candidates,
    steadyRising: [] as typeof response.candidates,
    slowRising: [] as typeof response.candidates,
  };

  let remaining = limit;
  for (const key of sectionKeys) {
    const take = Math.min(fullOrganized[key].length, baseQuota, remaining);
    organized[key] = fullOrganized[key].slice(0, take);
    remaining -= take;
  }
  for (const key of sectionKeys) {
    if (remaining <= 0) break;
    const alreadyTaken = organized[key].length;
    const extra = fullOrganized[key].slice(alreadyTaken, alreadyTaken + remaining);
    organized[key] = [...organized[key], ...extra];
    remaining -= extra.length;
  }

  const limitedCandidates = flattenOrganizedCandidates(organized);

  return {
    ...response,
    candidates: limitedCandidates,
    organized,
    flatList: limitedCandidates,
    totalCandidates: response.flatList.length,
    returnedCandidates: limitedCandidates.length,
    hasMoreCandidates: true,
  };
};

export { getGameKeywords };
