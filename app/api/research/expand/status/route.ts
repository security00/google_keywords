import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import {
  getExpansionResults,
  getReadyTaskIds,
  organizeCandidates,
  flattenOrganizedCandidates,
  filterCandidatesWithKeywordModel,
} from "@/lib/keyword-research";
import type { ExpandResponse, Candidate, FilterSummary } from "@/lib/types";
import type { FilterConfig } from "@/lib/keyword-research";
import { d1InsertMany, d1Query } from "@/lib/d1";
import { authenticate } from "@/lib/auth_middleware";
import { fetchSessionPayload } from "@/lib/session-store";
import { getJob, updateJobStatus } from "@/lib/research-jobs";
import { batchScoreKeywords } from "@/lib/rule-engine";
import { saveKeywordHistory } from "@/lib/history";
import { setCache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const D1_IN_QUERY_CHUNK_SIZE = 100;
const EXPAND_PARTIAL_COMPLETE_MIN_TOTAL = 20;
const EXPAND_PARTIAL_COMPLETE_RATIO = 0.98;
const PROCESSING_STALE_MS = 2 * 60 * 1000;

const parseResponseLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(Math.max(Math.floor(parsed), 50), 5000);
};

const trimExpandResponse = (response: ExpandResponse, limit?: number) => {
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

const getGameKeywords = async () => {
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loadPostbackResults = async (taskIds: string[]) => {
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

const loadKeywordHistoryFirstSeen = async (keywords: string[]) => {
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

const shouldRetryD1 = (message: string) => {
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

const normalizeCandidateType = (value: unknown): "top" | "rising" =>
  value === "top" ? "top" : "rising";

const parseJobKeywords = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((keyword): keyword is string => typeof keyword === "string")
    : [];

const parseFilterConfig = (value: unknown): FilterConfig | null => {
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

const isCronAuthorized = (request: Request) => {
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

export async function GET(request: Request) {
  const debug = process.env.DEBUG_API_LOGS === "true";
  const log = (message: string, meta?: Record<string, unknown>) => {
    if (!debug) return;
    if (meta) {
      console.log(`[api/expand] ${message}`, meta);
    } else {
      console.log(`[api/expand] ${message}`);
    }
  };
  const retryD1 = async <T>(
    label: string,
    fn: () => Promise<T>,
    maxAttempts = 3
  ): Promise<T> => {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        attempt += 1;
        if (attempt >= maxAttempts || !shouldRetryD1(message)) {
          throw error;
        }
        log(`${label} retry`, { attempt, message });
        await sleep(500 * attempt);
      }
    }
  };
  try {
    const auth = await authenticate(request as Parameters<typeof authenticate>[0]);
    if (!auth.authenticated) { return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 }); }
    const user = { id: auth.userId! };
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const job = await getJob(jobId, user.id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "failed") {
      return NextResponse.json({ status: "failed", error: job.error ?? "Job failed" });
    }

    if (job.status === "processing") {
      const updatedAtMs = Date.parse(job.updated_at);
      const isStaleProcessing =
        !job.session_id &&
        (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > PROCESSING_STALE_MS);

      if (!isStaleProcessing) {
        return NextResponse.json({
          status: "pending",
          stage: "processing",
          ready: job.task_ids.length,
          total: job.task_ids.length,
        });
      }

      log("recovering stale processing job", {
        jobId: job.id,
        updatedAt: job.updated_at,
      });
    }

    if (job.status === "processing" && job.session_id) {
      return NextResponse.json({
        status: "pending",
        stage: "processing",
        ready: job.task_ids.length,
        total: job.task_ids.length,
      });
    }

    if (job.status === "complete") {
      if (job.session_id) {
        const payloadConfig = job.payload ?? {};
        const sharedResultCacheKey =
          typeof payloadConfig.sharedResultCacheKey === "string"
            ? payloadConfig.sharedResultCacheKey
            : "";
        const responseLimit = parseResponseLimit(payloadConfig.responseLimit);
        const payload = await fetchSessionPayload(user.id, job.session_id);
        if (!payload?.session) {
          return NextResponse.json({ status: "complete" });
        }

        const unfiltered = (payload.candidates ?? [])
          .filter((item) => !item.filtered)
          .map((item) => ({
            keyword: item.keyword,
            value: Number(item.value ?? 0),
            type: normalizeCandidateType(item.type),
            source: item.source ?? "",
            score: Number(item.score ?? 0),
            confidence: item.confidence ?? undefined,
          }));

        const filteredOut = (payload.candidates ?? [])
          .filter((item) => item.filtered)
          .map((item) => ({
            keyword: item.keyword,
            value: Number(item.value ?? 0),
            type: normalizeCandidateType(item.type),
            source: item.source ?? "",
            score: Number(item.score ?? 0),
            confidence: item.confidence ?? undefined,
          }));

        const organized = organizeCandidates(unfiltered);

        // Include game keywords (worth_doing + low SERP competition)
        const gameKws = await getGameKeywords();

        const response: ExpandResponse = {
          keywords: payload.session.keywords ?? [],
          dateFrom: payload.session.date_from ?? "",
          dateTo: payload.session.date_to ?? "",
          candidates: unfiltered,
          organized,
          flatList: flattenOrganizedCandidates(organized),
          fromCache: false,
          filter: payload.session.filter_summary ?? undefined,
          filteredOut,
          sessionId: payload.session.id,
          gameKeywords: gameKws,
          trendsSummary: payload.session.trends_summary ? JSON.parse(payload.session.trends_summary) : undefined,
        };

        if (sharedResultCacheKey) {
          try {
            await setCache(sharedResultCacheKey, response);
          } catch (cacheError) {
            log("shared result cache write failed for completed job", {
              message: cacheError instanceof Error ? cacheError.message : "Unexpected error",
            });
          }
        }

        return NextResponse.json({ status: "complete", ...trimExpandResponse(response, responseLimit) });
      }
      return NextResponse.json({ status: "complete" });
    }

    const payload = job.payload ?? {};
    const keywords = parseJobKeywords(payload.keywords);
    const dateFrom = typeof payload.dateFrom === "string" ? payload.dateFrom : undefined;
    const dateTo = typeof payload.dateTo === "string" ? payload.dateTo : undefined;
    const includeTop = payload.includeTop === true;
    const useFilter = payload.useFilter !== false;
    const filterConfig = parseFilterConfig(payload.filterConfig);
    const enableLlmFilter = payload.enableLlmFilter === true;
    const sharedResultCacheKey =
      typeof payload.sharedResultCacheKey === "string"
        ? payload.sharedResultCacheKey
        : "";
    const responseLimit = parseResponseLimit(payload.responseLimit);
    const isSharedPrecomputeRequest =
      Boolean(sharedResultCacheKey) && isCronAuthorized(request);

    // Check if all tasks have postback results (avoids calling DataForSEO)
    const postbackResults: string[] = [];
    const postbackTaskIds: string[] = [];
    if (job.task_ids.length > 0) {
      const rows = await loadPostbackResults(job.task_ids);
      const resultMap = new Map(rows.map((row) => [row.task_id, row.result_data]));
      for (const taskId of job.task_ids) {
        const result = resultMap.get(taskId);
        if (result) {
          postbackTaskIds.push(taskId);
          postbackResults.push(result);
        }
      }
    }

    const usePostback = job.task_ids.length > 0 && postbackResults.length === job.task_ids.length;
    let taskIdsToProcess = job.task_ids;

    if (!usePostback) {
      // Fallback: check DataForSEO tasks_ready endpoint
      const readyIds = await getReadyTaskIds(job.task_ids);
      const availableIds = Array.from(new Set([...postbackTaskIds, ...readyIds]));
      const minReadyForPartial = Math.max(
        job.task_ids.length - 1,
        Math.ceil(job.task_ids.length * EXPAND_PARTIAL_COMPLETE_RATIO)
      );
      const allowPartialComplete =
        job.task_ids.length >= EXPAND_PARTIAL_COMPLETE_MIN_TOTAL &&
        availableIds.length >= minReadyForPartial;

      if (readyIds.length < job.task_ids.length && !allowPartialComplete) {
        return NextResponse.json({
          status: "pending",
          ready: Math.max(postbackResults.length, availableIds.length),
          total: job.task_ids.length,
        });
      }

      taskIdsToProcess = availableIds;
    }

    let stage = "mark-processing";
    try {
      await retryD1("job processing", () => updateJobStatus(job.id, "processing"));

      stage = "fetch-results";
      let candidates;
      if (usePostback) {
        // Parse results from postback (no DataForSEO HTTP call needed)
        stage = "parse-postback";
        candidates = [];
        for (const resultJson of postbackResults) {
          const parsed = JSON.parse(resultJson);
          // DataForSEO postback format: { tasks: [{ result: [...] }] }
          const taskResult = parsed?.tasks?.[0]?.result;
          if (!Array.isArray(taskResult)) continue;

          for (const entry of taskResult) {
            const sourceKeyword = entry?.keywords?.[0] ?? "unknown";
            const items = Array.isArray(entry?.items) ? entry.items : [];

            for (const item of items) {
              if (item?.type !== "google_trends_queries_list") continue;
              const data = item?.data;

              if (Array.isArray(data)) {
                for (const qi of data) {
                  const kw = qi?.query ?? "";
                  if (kw) candidates.push({ keyword: kw, value: Number(qi?.value ?? 0), type: String(qi?.type ?? "").toLowerCase().includes("rising") ? "rising" as const : "top" as const, source: sourceKeyword });
                }
              } else if (data && typeof data === "object") {
                for (const qi of data.top ?? []) {
                  const kw = qi?.query ?? "";
                  if (kw) candidates.push({ keyword: kw, value: Number(qi?.value ?? 0), type: "top" as const, source: sourceKeyword });
                }
                for (const qi of data.rising ?? []) {
                  const kw = qi?.query ?? "";
                  if (kw) candidates.push({ keyword: kw, value: Number(qi?.value ?? 0), type: "rising" as const, source: sourceKeyword });
                }
              }
            }
          }
        }
        console.log("[parse-postback] parsed candidates:", candidates.length);
      } else {
        candidates = await getExpansionResults(taskIdsToProcess);
      }
      if (!includeTop) {
        candidates = candidates.filter((candidate) => candidate.type === "rising");
      }

      // === Optimization 1: Rule engine pre-filter ===
      // Remove obvious junk before expensive LLM call
      const ruleResult = batchScoreKeywords(candidates.map(c => c.keyword));
      const ruleBlockedSet = new Set(ruleResult.blocked.map(k => k.toLowerCase()));
      const ruleKeptMap = new Map(ruleResult.kept.map(k => [k.keyword.toLowerCase(), k.score]));
      const ruleFilteredOut = candidates.filter(c => ruleBlockedSet.has(c.keyword.toLowerCase()));
      candidates = candidates.filter(c => !ruleBlockedSet.has(c.keyword.toLowerCase()));

      // Sort by rule score (descending) — trend acceleration proxy
      candidates.sort((a, b) => {
        const sa = Number(ruleKeptMap.get(a.keyword.toLowerCase())) || 0;
        const sb = Number(ruleKeptMap.get(b.keyword.toLowerCase())) || 0;
        return sb - sa;
      });

      let filteredCandidates = candidates;
      let modelFilteredOut: Candidate[] = [];
      let modelFilterSummary: FilterSummary | undefined;

      if (enableLlmFilter && useFilter && filterConfig) {
        stage = "precompute-llm-filter";
        try {
          const modelFilter = await filterCandidatesWithKeywordModel(
            filteredCandidates,
            filterConfig,
            { debug }
          );
          filteredCandidates = modelFilter.filtered;
          modelFilteredOut = modelFilter.blocked;
          modelFilterSummary = modelFilter.summary;
        } catch (filterError) {
          log("precompute LLM filter failed, falling back to rule filter", {
            message: filterError instanceof Error ? filterError.message : "Unexpected error",
          });
        }
      }

      const filteredOut: ExpandResponse["filteredOut"] = [
        ...ruleFilteredOut,
        ...modelFilteredOut,
      ];
      const filterSummary: FilterSummary | undefined =
        useFilter && filterConfig
          ? {
              enabled: true,
              model: modelFilterSummary?.model ?? filterConfig.model,
              total: filteredCandidates.length + filteredOut.length,
              removed: filteredOut.length,
              kept: filteredCandidates.length,
              skippedReason: enableLlmFilter
                ? modelFilterSummary?.skippedReason
                : "AI filter deferred",
            }
          : undefined;

      // === Optimization 4: Save keyword history ===
      if (!isSharedPrecomputeRequest) {
        try {
          await saveKeywordHistory(candidates); // all candidates (before filter) for trend tracking
        } catch (e) {
          console.warn("[history] save failed", e);
        }
      }

      // Heavy enrichments are intentionally deferred so the first expand pass can
      // reach "complete" quickly and let the user enter the next step.
      const trendsMap: Record<string, { ratio: number; ratioMean: number; ratioRecent: number; slopeRatio?: number; volatility: number; verdict: string; }> = {};

      // === Enrich candidates with score and isNew flag ===
      const today = new Date().toISOString().slice(0, 10);
      const seenDates = new Map<string, Set<string>>();
      for (const c of candidates) {
        const norm = c.keyword.toLowerCase().trim();
        if (!seenDates.has(norm)) seenDates.set(norm, new Set());
      }
      // Batch query first-seen dates for all candidates
      if (!isSharedPrecomputeRequest && candidates.length > 0) {
        const norms = [...new Set(candidates.map(c => c.keyword.toLowerCase().trim()))];
        const historyRows = await loadKeywordHistoryFirstSeen(norms);
        for (const hr of historyRows) {
          if (seenDates.has(hr.keyword_normalized)) {
            seenDates.get(hr.keyword_normalized)!.add(hr.first_seen);
          }
        }
      }

      const enrichedCandidates: Candidate[] = filteredCandidates.map(c => {
        const norm = c.keyword.toLowerCase().trim();
        const dates = seenDates.get(norm);
        const firstSeen = dates?.size ? [...dates].sort()[0] : null;
        const isNew = !isSharedPrecomputeRequest && firstSeen === today;
        const score = Number(ruleKeptMap.get(norm)) || 0;
        const trends = trendsMap[norm];
        return { ...c, isNew, score, trends };
      });

      // D1 cache already populated by webhook (postback_results + query_cache)
      // Filesystem cache not supported on CF Workers (fs.mkdir unsupported)

      const now = new Date().toISOString();
      let sessionId: string | undefined;
      if (!isSharedPrecomputeRequest) {
        sessionId = randomUUID();

        const candidateRows = [
          ...enrichedCandidates.map((candidate) => [
            randomUUID(),
            sessionId,
            user.id,
            candidate.keyword,
            candidate.value ?? null,
            candidate.type,
            candidate.source,
            0,
            candidate.score ?? 0,
            candidate.confidence ?? null,
            now,
          ]),
          ...(filteredOut ?? []).map((candidate) => [
            randomUUID(),
            sessionId,
            user.id,
            candidate.keyword,
            candidate.value ?? null,
            candidate.type,
            candidate.source,
            1,
            candidate.score ?? 0,
            candidate.confidence ?? null,
            now,
          ]),
        ];

        stage = "persist-session";
        const persistSession = async () => {
          stage = "db:clear-candidates";
          await d1Query("DELETE FROM candidates WHERE session_id = ?", [sessionId]);
          stage = "db:clear-session";
          await d1Query("DELETE FROM research_sessions WHERE id = ?", [sessionId]);
          stage = "db:insert-session";
          await d1Query(
            `INSERT INTO research_sessions (id, user_id, title, keywords, date_from, date_to, benchmark, include_top, use_filter, filter_terms, filter_prompt, filter_summary, trends_summary, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              sessionId,
              user.id,
              keywords.slice(0, 3).join(", "),
              JSON.stringify(keywords),
              dateFrom ?? null,
              dateTo ?? null,
              process.env.BENCHMARK_KEYWORD ?? "gpts",
              includeTop ? 1 : 0,
              useFilter ? 1 : 0,
              JSON.stringify(filterConfig?.terms ?? []),
              filterConfig?.prompt ?? null,
              filterSummary ? JSON.stringify(filterSummary) : null,
              Object.keys(trendsMap).length > 0 ? JSON.stringify({
                benchmark: process.env.BENCHMARK_KEYWORD ?? "gpts",
                totalCompared: Object.keys(trendsMap).length,
                keywords: trendsMap,
              }) : null,
              now,
            ]
          );
          if (candidateRows.length > 0) {
            stage = "db:insert-candidates";
            await d1InsertMany(
              "candidates",
              [
                "id",
                "session_id",
                "user_id",
                "keyword",
                "value",
                "type",
                "source",
                "filtered",
                "score",
                "confidence",
                "created_at",
              ],
              candidateRows,
              200
            );
          }
        };
        await retryD1("persist session", persistSession);
      }

      stage = "job-complete";
      await retryD1("job complete", () =>
        updateJobStatus(job.id, "complete", { sessionId: sessionId ?? null })
      );

      const organized = organizeCandidates(enrichedCandidates);
      const gameKws = await getGameKeywords();
      const response: ExpandResponse = {
        keywords,
        dateFrom: dateFrom ?? "",
        dateTo: dateTo ?? "",
        candidates: enrichedCandidates,
        organized,
        flatList: flattenOrganizedCandidates(organized),
        fromCache: false,
        filter: filterSummary,
        filteredOut,
        sessionId,
        ruleStats: {
          blocked: ruleBlockedSet.size,
          kept: ruleKeptMap.size,
        },
        gameKeywords: gameKws,
        trendsSummary: Object.keys(trendsMap).length > 0 ? {
          benchmark: process.env.BENCHMARK_KEYWORD ?? "gpts",
          totalCompared: Object.keys(trendsMap).length,
          keywords: trendsMap,
        } : undefined,
      };

      if (sharedResultCacheKey) {
        try {
          await setCache(sharedResultCacheKey, response);
        } catch (cacheError) {
          log("shared result cache write failed", {
            message: cacheError instanceof Error ? cacheError.message : "Unexpected error",
          });
        }
      }

      return NextResponse.json({
        status: "complete",
        ...trimExpandResponse(response, responseLimit),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      const errorMessage = `${stage}: ${message}`;
      try {
        await retryD1("job failed", () =>
          updateJobStatus(job.id, "failed", { error: errorMessage })
        );
      } catch (updateError) {
        const updateMessage =
          updateError instanceof Error ? updateError.message : "Unexpected error";
        log("job failed update error", {
          message: updateMessage,
          original: errorMessage,
        });
      }
      return NextResponse.json({ status: "failed", error: errorMessage }, { status: 500 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
