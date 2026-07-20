import { NextRequest, NextResponse } from "next/server";

import {
  isAuthzError,
  requireEffectiveUser,
  requirePaidApiPermission,
} from "@/lib/authz";
import { submitComparisonTasksWithCost } from "@/lib/keyword-research";
import { buildCacheKey, getCached } from "@/lib/cache";
import { createJob } from "@/lib/research-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/research/trends — Check Google Trends for keywords
// Body: { keywords: string[], months?: number, benchmark?: string }
// Cache hit → return immediately (backward compatible)
// Cache miss → submit async → return { jobId, status: "processing" }
export async function POST(request: NextRequest) {
  try {
    const principal = await requireEffectiveUser(request, {
      allowLegacyQueryKey: true,
    });
    if (isAuthzError(principal)) return principal;

    const body = await request.json().catch(() => ({}));
    const keywords = Array.isArray(body?.keywords) ? body.keywords : [];
    const benchmark = typeof body?.benchmark === "string" ? body.benchmark : undefined;
    const days = typeof body?.days === "number" && body.days >= 7 && body.days <= 90 ? body.days : undefined;

    if (keywords.length === 0 || keywords.length > 20) {
      return NextResponse.json(
        { error: "keywords is required (max 20)" },
        { status: 400 }
      );
    }

    const today = new Date();
    const dateTo = today.toISOString().slice(0, 10);
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - (days || 90));
    const dateFrom = fromDate.toISOString().slice(0, 10);

    // Check cache — if hit, return immediately (backward compatible!)
    const cacheKey = buildCacheKey("trends", keywords, { dateFrom, dateTo, benchmark: benchmark ?? "gpts" });
    const cached = await getCached<{ results: unknown[] }>(cacheKey, {
      namespace: "trends-result",
    });
    if (cached) {
      return NextResponse.json({ results: cached.results, fromCache: true });
    }

    const paidPrincipal = await requirePaidApiPermission(request);
    if (isAuthzError(paidPrincipal)) {
      return NextResponse.json(
        { error: "今日趋势对比缓存尚未预计算完成，请稍后重试。", status: "cache_miss" },
        { status: 409 }
      );
    }

    // Cache miss → admin/cron may submit to DataForSEO (no postback needed, status route polls directly)
    const taskSubmission = await submitComparisonTasksWithCost(keywords, dateFrom, dateTo, benchmark);
    const taskIds = taskSubmission.taskIds;

    if (!taskIds || taskIds.length === 0) {
      return NextResponse.json({ error: "Failed to submit trends tasks" }, { status: 500 });
    }

    // Create job for tracking
    const userId = principal.userId;
    const jobId = await createJob(
      userId,
      "trends",
      taskIds,
      { keywords, benchmark: benchmark || "gpts", dateFrom, dateTo, cacheKey, cost: taskSubmission.cost }
    );

    return NextResponse.json({
      jobId,
      status: "processing",
      cost: taskSubmission.cost,
      total: taskIds.length,
      message: "Trends tasks submitted. Poll /api/research/trends/status?jobId= for results.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
