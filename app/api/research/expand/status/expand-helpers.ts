import { NextResponse } from "next/server";

import {
  organizeCandidates,
  flattenOrganizedCandidates,
} from "@/lib/keyword-research";
import type { ExpandResponse } from "@/lib/types";
import type { FilterConfig } from "@/lib/keyword-research";
import { d1Query } from "@/lib/d1";

export const D1_IN_QUERY_CHUNK_SIZE = 100;
export const EXPAND_PARTIAL_COMPLETE_MIN_TOTAL = 20;
export const EXPAND_PARTIAL_COMPLETE_RATIO = 0.98;
export const PROCESSING_STALE_MS = 2 * 60 * 1000;

export const parseResponseLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(Math.max(Math.floor(parsed), 50), 5000);
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

export const getGameKeywords = async () => {
  try {
    const { rows } = await d1Query<{
      keyword: string;
      source_site: string;
      trend_ratio: number;
      trend_slope: number;
      trend_verdict: string;
      trend_checked_at: string;
      serp_organic: number | null;
      serp_auth: number | null;
      serp_featured: number | null;
      recommendation: string | null;
      reason: string | null;
    }>(
      `SELECT keyword, source_site, trend_ratio, trend_slope, trend_verdict, trend_checked_at,
              serp_organic, serp_auth, serp_featured, recommendation, reason
       FROM game_keyword_pipeline
       WHERE status = 'recommended'
       ORDER BY trend_ratio DESC
       LIMIT 20`
    );
    if (!rows.length) return undefined;
    return rows.map((r) => ({
      keyword: r.keyword,
      source: r.source_site,
      ratio: Number(r.trend_ratio),
      slope: Number(r.trend_slope),
      verdict: r.trend_verdict,
      checkedAt: r.trend_checked_at,
      serpOrganic: r.serp_organic ?? 0,
      serpAuth: r.serp_auth ?? 0,
      serpFeatured: !!r.serp_featured,
      recommendation: r.recommendation || "",
      reason: r.reason || "",
      isGame: true as const,
    }));
  } catch {
    return undefined;
  }
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const loadPostbackResults = async (taskIds: string[]) => {
  const rows: { task_id: string; result_data: string }[] = [];

  for (let index = 0; index < taskIds.length; index += D1_IN_QUERY_CHUNK_SIZE) {
    const chunk = taskIds.slice(index, index + D1_IN_QUERY_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await d1Query<{ task_id: string; result_data: string }>(
      `SELECT task_id, result_data
       FROM postback_results
       WHERE task_id IN (${placeholders})`,
      chunk
    );
    rows.push(...result.rows);
  }

  return rows;
};

export const loadKeywordHistoryFirstSeen = async (keywords: string[]) => {
  const rows: { keyword_normalized: string; first_seen: string }[] = [];

  for (let index = 0; index < keywords.length; index += D1_IN_QUERY_CHUNK_SIZE) {
    const chunk = keywords.slice(index, index + D1_IN_QUERY_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await d1Query<{ keyword_normalized: string; first_seen: string }>(
      `SELECT keyword_normalized, MIN(date) as first_seen
       FROM keyword_history
       WHERE keyword_normalized IN (${placeholders})
       GROUP BY keyword_normalized`,
      chunk
    );
    rows.push(...result.rows);
  }

  return rows;
};

export const shouldRetryD1 = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("network connection lost") ||
    lowered.includes("exceeded timeout") ||
    lowered.includes("timeout") ||
    lowered.includes("exceeded its memory limit") ||
    lowered.includes("storage operation") ||
    lowered.includes("internal error") ||
    lowered.includes("too many requests queued") ||
    lowered.includes("d1_error") ||
    lowered.includes("error code: 1031") ||
    /d1 request failed \\((429|500|502|503|504|520|522|524)\\)/.test(lowered)
  );
};

export const normalizeCandidateType = (value: unknown): "top" | "rising" =>
  value === "top" ? "top" : "rising";

export const parseJobKeywords = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((keyword): keyword is string => typeof keyword === "string")
    : [];

export const parseFilterConfig = (value: unknown): FilterConfig | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const terms = Array.isArray(raw.terms)
    ? raw.terms.filter((term): term is string => typeof term === "string")
    : [];
  const prompt =
    typeof raw.prompt === "string" && raw.prompt.trim()
      ? raw.prompt.trim()
      : undefined;

  return {
    enabled: raw.enabled === true,
    model: typeof raw.model === "string" ? raw.model : "openai/gpt-5.2",
    terms,
    prompt,
  };
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
