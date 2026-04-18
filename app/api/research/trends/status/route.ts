import { NextResponse } from "next/server";

import { authenticate } from "@/lib/auth_middleware";
import { getComparisonResults } from "@/lib/keyword-research";
import { d1Query } from "@/lib/d1";
import { getJob } from "@/lib/research-jobs";
import { setCache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/research/trends/status?jobId=X
// Polls for async trends results
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

    // Check if job exists
    const job = await getJob(jobId, auth.userId || "anonymous");
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "failed") {
      return NextResponse.json({ status: "failed", error: job.error || "Job failed" });
    }

    // Get job metadata (taskIds, cacheKey, etc.)
    const metaResult = await d1Query<{ result_data: string }>(
      `SELECT result_data FROM postback_results WHERE id = ?`,
      [`trends_meta_${jobId}`]
    );
    const meta = metaResult.rows[0];
    if (!meta) {
      return NextResponse.json({ status: "processing", message: "Waiting for task metadata..." });
    }

    const { taskIds, keywords, benchmark, cacheKey, dateFrom, dateTo } = JSON.parse(meta.result_data);

    // Check if all DataForSEO tasks have postback results
    const placeholders = taskIds.map(() => "?").join(",");
    const pbResult = await d1Query<{ id: string }>(
      `SELECT id FROM postback_results WHERE id IN (${placeholders})`,
      taskIds.map((id: string) => `pb_${id}`)
    );

    const receivedCount = pbResult.rows.length;
    if (receivedCount < taskIds.length) {
      return NextResponse.json({
        status: "processing",
        progress: `${receivedCount}/${taskIds.length} tasks completed`,
      });
    }

    // All postbacks received — fetch and parse results
    const allPbData = await d1Query<{ result_data: string }>(
      `SELECT result_data FROM postback_results WHERE id IN (${placeholders})`,
      taskIds.map((id: string) => `pb_${id}`)
    );

    // Parse DataForSEO comparison results from postbacks
    const results: Array<{
      keyword: string;
      ratio: number;
      ratioMean: number;
      ratioRecent: number;
      ratioPeak: number;
      ratioCoverage: number;
      slopeRatio: number;
      volatility: number;
      verdict: string;
      avgValue: number;
      benchmarkValue: number;
    }> = [];

    for (const row of allPbData.rows) {
      try {
        const taskData = JSON.parse(row.result_data);
        const items = taskData?.result?.[0]?.items || taskData?.items || [];
        for (const item of items) {
          const data = item?.data || item;
          if (!data?.keywords) continue;

          // Parse trend data for each keyword
          const kwData = data.keywords;
          for (const [kw, points] of Object.entries(kwData)) {
            if (kw.toLowerCase() === benchmark?.toLowerCase()) continue; // skip benchmark itself
            if (!Array.isArray(points) || points.length === 0) continue;

            const values = (points as number[]).filter((v) => v !== null && v !== undefined);
            if (values.length === 0) continue;

            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            const recentN = Math.min(7, values.length);
            const recent = values.slice(-recentN);
            const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const tailN = Math.min(3, values.length);
            const tailAvg = values.slice(-tailN).reduce((a, b) => a + b, 0) / tailN;
            const peak = Math.max(...values);
            const firstHalf = values.slice(0, Math.floor(values.length / 2));
            const secondHalf = values.slice(Math.floor(values.length / 2));
            const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0;
            const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0;
            const slope = firstAvg > 0 ? (secondAvg - firstAvg) / firstAvg : 0;

            // Simple verdict
            let verdict = "unknown";
            if (avg > 0) {
              if (slope > 0.1 && recentAvg > avg) verdict = "strong";
              else if (slope > 0) verdict = "pass";
              else if (tailAvg >= avg * 0.8) verdict = "close";
              else verdict = "fail";
            }

            results.push({
              keyword: kw,
              ratio: avg,
              ratioMean: avg,
              ratioRecent: recentAvg,
              ratioPeak: peak,
              ratioCoverage: values.length / 90, // normalized
              slopeRatio: slope,
              volatility: values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length) / (avg || 1) : 0,
              verdict,
              avgValue: avg,
              benchmarkValue: 0, // will be filled below
            });
          }
        }
      } catch {
        // skip malformed postback
      }
    }

    // Cache the results
    if (cacheKey && results.length > 0) {
      await setCache(cacheKey, { results });
    }

    // Mark job complete
    await d1Query(
      `UPDATE research_jobs SET status = 'complete', completed_at = datetime('now') WHERE id = ?`,
      [jobId]
    );

    return NextResponse.json({
      status: "complete",
      results,
      fromCache: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
