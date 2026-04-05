import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { getComparisonResults, getReadyTaskIds, summarizeResults } from "@/lib/keyword-research";
import type { CompareResponse, ComparisonResult, ComparisonSignalConfig } from "@/lib/types";
import { d1InsertMany, d1Query } from "@/lib/d1";
import { getAuthUser } from "@/lib/auth";
import { getJob, updateJobStatus } from "@/lib/research-jobs";

const METRICS_VERSION = "v1";
const DEFAULT_COMPARISON_SIGNAL_CONFIG: ComparisonSignalConfig = {
  avgRatioMin: 1,
  lastPointRatioMin: 1,
  peakRatioMin: 1.2,
  slopeRatioMinStrong: 1.35,
  slopeRatioMinPass: 0.9,
  risingStrongMinSlopeRatio: 1.35,
  risingStrongMinTailRatio: 1,
  nearOneTolerance: 0.1,
};
const COMPARISON_SIGNAL_CONFIG_RANGES: Record<
  keyof ComparisonSignalConfig,
  [number, number]
> = {
  avgRatioMin: [0.2, 10],
  lastPointRatioMin: [0.2, 10],
  peakRatioMin: [0.2, 10],
  slopeRatioMinStrong: [0.5, 20],
  slopeRatioMinPass: [0.2, 20],
  risingStrongMinSlopeRatio: [0.5, 20],
  risingStrongMinTailRatio: [0.2, 10],
  nearOneTolerance: [0.01, 0.5],
};

const safeJsonParse = <T,>(value: string | null) => {
  if (!value) return undefined as T | undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined as T | undefined;
  }
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const parseComparisonSignalConfig = (
  raw: unknown
): Partial<ComparisonSignalConfig> => {
  const input =
    raw && typeof raw === "object"
      ? (raw as Partial<Record<string, unknown>>)
      : undefined;

  const parseValue = (key: keyof ComparisonSignalConfig) => {
    const value = input?.[key];
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_COMPARISON_SIGNAL_CONFIG[key];
    }
    const [min, max] = COMPARISON_SIGNAL_CONFIG_RANGES[key];
    return Math.min(max, Math.max(min, parsed));
  };

  return {
    avgRatioMin: parseValue("avgRatioMin"),
    lastPointRatioMin: parseValue("lastPointRatioMin"),
    peakRatioMin: parseValue("peakRatioMin"),
    slopeRatioMinStrong: parseValue("slopeRatioMinStrong"),
    slopeRatioMinPass: parseValue("slopeRatioMinPass"),
    risingStrongMinSlopeRatio: parseValue("risingStrongMinSlopeRatio"),
    risingStrongMinTailRatio: parseValue("risingStrongMinTailRatio"),
    nearOneTolerance: parseValue("nearOneTolerance"),
  };
};

export async function GET(request: Request) {
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
  try {
    const user = await getAuthUser();
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
      return NextResponse.json({
        status: "pending",
        ready: job.task_ids.length,
        total: job.task_ids.length,
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

    const readyIds = await getReadyTaskIds(job.task_ids);
    if (readyIds.length < job.task_ids.length) {
      return NextResponse.json({
        status: "pending",
        ready: readyIds.length,
        total: job.task_ids.length,
      });
    }

    let stage = "mark-processing";
    try {
      await retryD1("job processing", () => updateJobStatus(job.id, "processing"));

      stage = "fetch-results";
      const results = await getComparisonResults(
        job.task_ids,
        benchmark,
        comparisonSignalConfig
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
          user.id,
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
              user.id,
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

      if (debug) {
        console.log("[api/compare] completed", {
          results: results.length,
          comparisonId,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
