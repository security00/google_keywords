import { randomUUID } from "crypto";

import {
  getExpansionResults,
  getReadyTaskIds,
  organizeCandidates,
  flattenOrganizedCandidates,
} from "@/lib/keyword-research";
import type { ExpandResponse } from "@/lib/types";
import { d1InsertMany, d1Query } from "@/lib/d1";
import { getJob, updateJobStatus } from "@/lib/research-jobs";
import { setCache } from "@/lib/cache";
import { fetchSessionPayload } from "@/lib/session-store";
import {
  D1_IN_QUERY_CHUNK_SIZE,
  EXPAND_PARTIAL_COMPLETE_MIN_TOTAL,
  EXPAND_PARTIAL_COMPLETE_RATIO,
  parseResponseLimit,
  trimExpandResponse,
  sleep,
  loadPostbackResults,
  shouldRetryD1,
  normalizeCandidateType,
  parseJobKeywords,
  parseFilterConfig,
  isCronAuthorized,
  getGameKeywords,
} from "./expand-helpers";
import { parsePostbackCandidates, filterAndEnrichCandidates } from "./expand-pipeline";

export interface ExpandStatusResult {
  response: Record<string, unknown>;
  status: number;
}

const makeRetryD1 = (log: (message: string, meta?: Record<string, unknown>) => void) => {
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
  return retryD1;
};

export const handleExpandStatus = async (
  request: Request,
  userId: string,
  jobId: string,
  log: (message: string, meta?: Record<string, unknown>) => void,
): Promise<ExpandStatusResult> => {
  const retryD1 = makeRetryD1(log);

  const job = await getJob(jobId, userId);
  if (!job) {
    return { response: { error: "Job not found" }, status: 404 };
  }

  if (job.status === "failed") {
    return { response: { status: "failed", error: job.error ?? "Job failed" }, status: 200 };
  }

  if (job.status === "processing") {
    const updatedAtMs = Date.parse(job.updated_at);
    const isStaleProcessing =
      !job.session_id &&
      (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > 2 * 60 * 1000);

    if (!isStaleProcessing) {
      return {
        response: {
          status: "pending",
          stage: "processing",
          ready: job.task_ids.length,
          total: job.task_ids.length,
        },
        status: 200,
      };
    }

    log("recovering stale processing job", {
      jobId: job.id,
      updatedAt: job.updated_at,
    });
  }

  if (job.status === "processing" && job.session_id) {
    return {
      response: {
        status: "pending",
        stage: "processing",
        ready: job.task_ids.length,
        total: job.task_ids.length,
      },
      status: 200,
    };
  }

  if (job.status === "complete") {
    if (job.session_id) {
      const payloadConfig = job.payload ?? {};
      const sharedResultCacheKey =
        typeof payloadConfig.sharedResultCacheKey === "string"
          ? payloadConfig.sharedResultCacheKey
          : "";
      const responseLimit = parseResponseLimit(payloadConfig.responseLimit);
      const payload = await fetchSessionPayload(userId, job.session_id);
      if (!payload?.session) {
        return { response: { status: "complete" }, status: 200 };
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

      return { response: { status: "complete", ...trimExpandResponse(response, responseLimit) }, status: 200 };
    }
    return { response: { status: "complete" }, status: 200 };
  }

  // --- Main processing: pending job ---
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

  // Check postback results
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
      return {
        response: {
          status: "pending",
          ready: Math.max(postbackResults.length, availableIds.length),
          total: job.task_ids.length,
        },
        status: 200,
      };
    }

    taskIdsToProcess = availableIds;
  }

  let stage = "mark-processing";
  try {
    await retryD1("job processing", () => updateJobStatus(job.id, "processing"));

    stage = "fetch-results";
    let candidates;
    if (usePostback) {
      stage = "parse-postback";
      candidates = parsePostbackCandidates(postbackResults);
      console.log("[parse-postback] parsed candidates:", candidates.length);
    } else {
      candidates = await getExpansionResults(taskIdsToProcess);
    }

    const { enrichedCandidates, filteredOut, filterSummary, ruleBlockedSet, ruleKeptMap } =
      await filterAndEnrichCandidates(
        candidates,
        {
          includeTop,
          enableLlmFilter,
          useFilter,
          filterConfig,
          isSharedPrecomputeRequest,
          debug: process.env.DEBUG_API_LOGS === "true",
        },
        log,
      );

    const now = new Date().toISOString();
    let sessionId: string | undefined;
    if (!isSharedPrecomputeRequest) {
      sessionId = randomUUID();

      const candidateRows = [
        ...enrichedCandidates.map((candidate) => [
          randomUUID(),
          sessionId,
          userId,
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
          userId,
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
            userId,
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
            null,
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
      trendsSummary: undefined,
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

    return {
      response: { status: "complete", ...trimExpandResponse(response, responseLimit) },
      status: 200,
    };
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
    return { response: { status: "failed", error: errorMessage }, status: 500 };
  }
};
