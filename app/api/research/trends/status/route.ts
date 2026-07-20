import { NextRequest, NextResponse } from "next/server";

import { isAuthzError, requireEffectiveUser } from "@/lib/authz";
import { getReadyTaskIds, getComparisonResults } from "@/lib/keyword-research";
import {
  claimOwnedJob,
  completeOwnedJobWithPayload,
  getOwnedJob,
  getOwnedJobStatusSnapshot,
  isLegacyStatusGetExecutionEnabled,
} from "@/lib/research-jobs";
import { setCache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/research/trends/status?jobId=X
// Single non-blocking poll of DataForSEO tasks_ready
export async function GET(request: NextRequest) {
  try {
    if (request.method === "GET" && isLegacyStatusGetExecutionEnabled()) {
      console.warn(JSON.stringify({ event: "legacy_status_get_execution", jobType: "trends" }));
    }
    const principal = await requireEffectiveUser(request, {
      allowLegacyQueryKey: true,
    });
    if (isAuthzError(principal)) return principal;

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    if (request.method === "GET" && !isLegacyStatusGetExecutionEnabled()) {
      const snapshot = await getOwnedJobStatusSnapshot(
        jobId,
        principal.userId,
        "trends",
      );
      return snapshot
        ? NextResponse.json(snapshot)
        : NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const job = await getOwnedJob(jobId, principal.userId, "trends");
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "failed") {
      return NextResponse.json({ status: "failed", error: job.error || "Job failed" });
    }

    // If already complete, return cached result
    if (job.status === "complete" && job.payload?.results) {
      return NextResponse.json({
        status: "complete",
        results: job.payload.results,
        fromCache: true,
      });
    }

    const taskIds: string[] = Array.isArray(job.task_ids) ? job.task_ids : JSON.parse(job.task_ids || "[]");
    if (taskIds.length === 0) {
      return NextResponse.json({ status: "failed", error: "No task IDs found" });
    }

    // Single non-blocking poll
    const readyIds = await getReadyTaskIds(taskIds);

    if (readyIds.length < taskIds.length) {
      return NextResponse.json({
        status: "processing",
        progress: `${readyIds.length}/${taskIds.length} tasks ready`,
      });
    }

    const claim = await claimOwnedJob(job.id, principal.userId, "trends");
    if (!claim) {
      return NextResponse.json({
        status: "processing",
        progress: `${readyIds.length}/${taskIds.length} tasks ready`,
      });
    }

    // All tasks ready — fetch results
    const benchmark = (job.payload?.benchmark as string) || "gpts";
    const results = await getComparisonResults(taskIds, benchmark);

    const mappedResults = results.map((r) => ({
      keyword: r.keyword,
      ratio: r.ratio,
      ratioMean: r.ratioMean,
      ratioRecent: r.ratioRecent,
      ratioPeak: r.ratioPeak,
      ratioCoverage: r.ratioCoverage,
      slopeRatio: r.slopeRatio,
      volatility: r.volatility,
      verdict: r.verdict,
      avgValue: r.avgValue,
      benchmarkValue: r.benchmarkValue,
      series: r.series,
    }));

    // Cache results
    const cacheKey = job.payload?.cacheKey as string;
    if (cacheKey && mappedResults.length > 0) {
      await setCache(cacheKey, { results: mappedResults }, {
        namespace: "trends-result",
      });
    }

    // Update job
    const finished = await completeOwnedJobWithPayload(
      jobId,
      principal.userId,
      claim.token,
      {
        ...job.payload,
        results: mappedResults,
      },
    );
    if (!finished) {
      throw new Error("Trends job claim lost before completion");
    }

    return NextResponse.json({
      status: "complete",
      results: mappedResults,
      fromCache: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = GET;
