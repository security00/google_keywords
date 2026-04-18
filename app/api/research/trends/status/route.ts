import { NextResponse } from "next/server";

import { authenticate } from "@/lib/auth_middleware";
import { getReadyTaskIds, getComparisonResults } from "@/lib/keyword-research";
import { d1Query } from "@/lib/d1";
import { getJob } from "@/lib/research-jobs";
import { setCache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/research/trends/status?jobId=X
// Single non-blocking poll of DataForSEO tasks_ready
export async function GET(request: Request) {
  try {
    const auth = await authenticate(request as any);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const job = await getJob(jobId, auth.userId || "anonymous");
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
    }));

    // Cache results
    const cacheKey = job.payload?.cacheKey as string;
    if (cacheKey && mappedResults.length > 0) {
      await setCache(cacheKey, { results: mappedResults });
    }

    // Update job
    await d1Query(
      `UPDATE research_jobs SET status = 'complete', payload = ?, updated_at = datetime('now') WHERE id = ?`,
      [JSON.stringify({ ...job.payload, results: mappedResults }), jobId]
    );

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
