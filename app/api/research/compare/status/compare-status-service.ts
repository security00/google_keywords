import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import {
  getComparisonResults,
  getComparisonResultsFromTasks,
  getReadyTaskIds,
  summarizeResults,
} from "@/lib/keyword-research";
import type { CompareResponse, ComparisonResult } from "@/lib/types";
import { d1InsertMany, d1Query } from "@/lib/d1";
import { getCached, setCache } from "@/lib/cache";
import { getJob, getJobById, updateJobStatus } from "@/lib/research-jobs";

import {
  METRICS_VERSION,
  PROCESSING_STALE_MS,
  safeJsonParse,
  sleep,
  shouldRetryD1,
  parseComparisonSignalConfig,
  loadPostbackResults,
} from "./compare-status-helpers";

export async function handleCompareStatusGet(request: Request, userId: string) {
  const debug = process.env.DEBUG_API_LOGS === "true";
  const log = (message: string, meta?: Record<string, unknown>) => {
    if (!debug) return;
    if (meta) {
      console.log(`[api/compare] ${message}`, meta);
    } else {
      console.log(`[api/compare] ${message}`);
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

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = (await getJob(jobId, userId)) ?? (await getJobById(jobId, "compare"));
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
      const rows = await loadPostbackResults(job.task_ids);
      return NextResponse.json({
        status: "pending",
        stage: "processing",
        ready: rows.length,
        total: job.task_ids.length,
      });
    }

    log("recovering stale processing compare job", {
      jobId: job.id,
      updatedAt: job.updated_at,
    });
  }

  if (job.status === "complete") {
    const payloadForComplete = job.payload ?? {};
    const sessionIdForComplete =
      typeof payloadForComplete.sessionId === "string"
        ? payloadForComplete.sessionId
        : undefined;

    if (job.session_id) {
      const { rows: comparisonRows } = await d1Query<{
        id: string;
        benchmark: string | null;
        date_from: string | null;
        date_to: string | null;
        summary: string | null;
      }>(
        "SELECT id, benchmark, date_from, date_to, summary FROM comparisons WHERE id = ? LIMIT 1",
        [job.session_id]
      );

      const comparison = comparisonRows[0];
      if (!comparison) {
        return NextResponse.json({ status: "complete" });
      }

      const { rows: results } = await d1Query<{
        keyword: string;
        avg_value: number | null;
        benchmark_value: number | null;
        ratio: number | null;
        ratio_mean: number | null;
        ratio_recent: number | null;
        ratio_coverage: number | null;
        ratio_peak: number | null;
        slope_diff: number | null;
        volatility: number | null;
        crossings: number | null;
        verdict: string | null;
        trend_series: string | null;
        explanation: string | null;
        intent: string | null;
      }>(
        "SELECT keyword, avg_value, benchmark_value, ratio, ratio_mean, ratio_recent, ratio_coverage, ratio_peak, slope_diff, volatility, crossings, verdict, trend_series, explanation, intent FROM comparison_results WHERE comparison_id = ?",
        [comparison.id]
      );

      const parsedSummary =
        safeJsonParse<CompareResponse["summary"]>(comparison.summary) ?? null;

      const resultsMapped: ComparisonResult[] = results.map((row) => ({
        keyword: row.keyword,
        avgValue: Number(row.avg_value ?? 0),
        benchmarkValue: Number(row.benchmark_value ?? 0),
        ratio: Number(row.ratio ?? 0),
        ratioMean: Number(row.ratio_mean ?? 0),
        ratioRecent: Number(row.ratio_recent ?? 0),
        ratioCoverage: Number(row.ratio_coverage ?? 0),
        ratioPeak: Number(row.ratio_peak ?? 0),
        slopeDiff: Number(row.slope_diff ?? 0),
        volatility: Number(row.volatility ?? 0),
        crossings: Number(row.crossings ?? 0),
        verdict: (row.verdict ?? "fail") as ComparisonResult["verdict"],
        series: safeJsonParse(row.trend_series),
        explanation: safeJsonParse(row.explanation),
        intent: safeJsonParse(row.intent),
      }));

      const response: CompareResponse = {
        benchmark: comparison.benchmark ?? "gpts",
        dateFrom: comparison.date_from ?? "",
        dateTo: comparison.date_to ?? "",
        results: resultsMapped,
        summary:
          parsedSummary ?? { strong: 0, pass: 0, close: 0, watch: 0, fail: 0 },
        sessionId: sessionIdForComplete,
        comparisonId: comparison.id,
      };

      return NextResponse.json({ status: "complete", ...response });
    }

    const resultCacheKey =
      typeof payloadForComplete.resultCacheKey === "string"
        ? payloadForComplete.resultCacheKey
        : undefined;
    if (resultCacheKey) {
      const cachedResult = await getCached<CompareResponse>(resultCacheKey);
      if (cachedResult?.results?.length) {
        return NextResponse.json({
          status: "complete",
          ...cachedResult,
          fromCache: true,
        });
      }
    }

    return NextResponse.json({ status: "complete" });
  }

  const payload = job.payload ?? {};
  const dateFrom = typeof payload.dateFrom === "string" ? payload.dateFrom : undefined;
  const dateTo = typeof payload.dateTo === "string" ? payload.dateTo : undefined;
  const benchmark = typeof payload.benchmark === "string" ? payload.benchmark : "gpts";
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
  const comparisonSignalConfig = parseComparisonSignalConfig(
    payload.comparisonSignalConfig
  );
  const enableIntentLlm = payload.enableIntentLlm === true;

  const postbackResults: string[] = [];
  if (job.task_ids.length > 0) {
    const rows = await loadPostbackResults(job.task_ids);
    const resultMap = new Map(rows.map((row) => [row.task_id, row.result_data]));
    for (const taskId of job.task_ids) {
      const result = resultMap.get(taskId);
      if (result) {
        postbackResults.push(result);
      }
    }
  }

  const usePostback = job.task_ids.length > 0 && postbackResults.length === job.task_ids.length;

  if (!usePostback) {
    const readyIds = await getReadyTaskIds(job.task_ids);
    if (readyIds.length < job.task_ids.length) {
      return NextResponse.json({
        status: "pending",
        ready: Math.max(postbackResults.length, readyIds.length),
        total: job.task_ids.length,
      });
    }
  }

  let stage = "mark-processing";
  try {
    await retryD1("job processing", () => updateJobStatus(job.id, "processing"));

    stage = "fetch-results";
    const results = usePostback
      ? await getComparisonResultsFromTasks(
          postbackResults.flatMap((resultJson) => {
            const parsed = safeJsonParse<{ tasks?: unknown[] }>(resultJson);
            return Array.isArray(parsed?.tasks)
              ? parsed.tasks.filter(
                  (task): task is Record<string, unknown> =>
                    Boolean(task) && typeof task === "object"
                )
              : [];
          }),
          benchmark,
          comparisonSignalConfig,
          { enableIntentLlm }
        )
      : await getComparisonResults(
          job.task_ids,
          benchmark,
          comparisonSignalConfig,
          { enableIntentLlm }
        );
    if (results.length === 0) {
      const errorMessage = "fetch-results: No comparison results";
      await retryD1("job failed", () =>
        updateJobStatus(job.id, "failed", { error: errorMessage })
      );
      return NextResponse.json({ status: "failed", error: errorMessage }, { status: 500 });
    }

    stage = "summarize";
    const summary = summarizeResults(results);

    let comparisonId: string | undefined = undefined;
    if (sessionId) {
      const now = new Date().toISOString();
      const newComparisonId = randomUUID();

      const resultRows = results.map((item) => [
        randomUUID(),
        newComparisonId,
        userId,
        item.keyword,
        item.avgValue ?? null,
        item.benchmarkValue ?? null,
        item.ratio ?? null,
        item.ratioMean ?? null,
        item.ratioRecent ?? null,
        item.ratioCoverage ?? null,
        item.ratioPeak ?? null,
        item.slopeDiff ?? null,
        item.volatility ?? null,
        item.crossings ?? null,
        item.verdict,
        item.series ? JSON.stringify(item.series) : null,
        item.explanation ? JSON.stringify(item.explanation) : null,
        item.intent ? JSON.stringify(item.intent) : null,
        now,
      ]);

      stage = "persist-comparison";
      const persistComparison = async () => {
        stage = "db:clear-results";
        await d1Query("DELETE FROM comparison_results WHERE comparison_id = ?", [
          newComparisonId,
        ]);
        stage = "db:clear-comparison";
        await d1Query("DELETE FROM comparisons WHERE id = ?", [newComparisonId]);
        stage = "db:insert-comparison";
        await d1Query(
          `INSERT INTO comparisons (id, session_id, user_id, benchmark, date_from, date_to, summary, recent_points, metrics_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newComparisonId,
            sessionId,
            userId,
            benchmark,
            dateFrom ?? null,
            dateTo ?? null,
            JSON.stringify(summary),
            7,
            METRICS_VERSION,
            now,
          ]
        );
        if (resultRows.length > 0) {
          stage = "db:insert-results";
          await d1InsertMany(
            "comparison_results",
            [
              "id",
              "comparison_id",
              "user_id",
              "keyword",
              "avg_value",
              "benchmark_value",
              "ratio",
              "ratio_mean",
              "ratio_recent",
              "ratio_coverage",
              "ratio_peak",
              "slope_diff",
              "volatility",
              "crossings",
              "verdict",
              "trend_series",
              "explanation",
              "intent",
              "created_at",
            ],
            resultRows,
            200
          );
        }
      };

      await retryD1("persist comparison", persistComparison);
      comparisonId = newComparisonId;
    }

    stage = "job-complete";
    await retryD1("job complete", () =>
      updateJobStatus(job.id, "complete", { sessionId: comparisonId ?? null })
    );

    const response: CompareResponse = {
      benchmark,
      dateFrom: dateFrom ?? "",
      dateTo: dateTo ?? "",
      results,
      summary,
      sessionId,
      comparisonId,
    };

    const resultCacheKey =
      typeof payload.resultCacheKey === "string" ? payload.resultCacheKey : undefined;
    if (resultCacheKey) {
      await retryD1("set compare result cache", () =>
        setCache(resultCacheKey, {
          ...response,
          fromCache: false,
        })
      );
    }

    if (debug) {
      console.log("[api/compare] completed", {
        results: results.length,
        comparisonId,
        resultCached: Boolean(resultCacheKey),
      });
    }

    return NextResponse.json({ status: "complete", ...response });
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
}
