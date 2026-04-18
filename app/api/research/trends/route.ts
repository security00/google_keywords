import { NextResponse } from "next/server";

import { authenticate } from "@/lib/auth_middleware";
import { checkStudentAccess } from "@/lib/usage";
import {
  submitComparisonTasks,
  resolveComparisonDateRange,
} from "@/lib/keyword-research";
import { buildCacheKey, getCached, setCache } from "@/lib/cache";
import { createJob } from "@/lib/research-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/research/trends — Check Google Trends for keywords
// Body: { keywords: string[], months?: number, benchmark?: string }
// Cache hit → return immediately (backward compatible)
// Cache miss → submit async → return { jobId, status: "processing" }
export async function POST(request: Request) {
  try {
    const auth = await authenticate(request as any);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 });
    }

    const access = await checkStudentAccess(auth.userId!);
    if (!access.allowed) {
      return NextResponse.json(
        { error: access.reason, code: access.code },
        { status: access.code === "trial_expired" ? 403 : 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const keywords = Array.isArray(body?.keywords) ? body.keywords : [];
    const benchmark = typeof body?.benchmark === "string" ? body.benchmark : undefined;

    if (keywords.length === 0 || keywords.length > 20) {
      return NextResponse.json(
        { error: "keywords is required (max 20)" },
        { status: 400 }
      );
    }

    const { dateFrom, dateTo } = resolveComparisonDateRange();

    // Check cache — if hit, return immediately (backward compatible!)
    const cacheKey = buildCacheKey("trends", keywords, { dateFrom, dateTo, benchmark: benchmark ?? "gpts" });
    const cached = await getCached<{ results: unknown[] }>(cacheKey);
    if (cached) {
      return NextResponse.json({ results: cached.results, fromCache: true });
    }

    // Cache miss → submit to DataForSEO (no postback needed, status route polls directly)
    const taskIds = await submitComparisonTasks(keywords, dateFrom, dateTo, benchmark);

    if (!taskIds || taskIds.length === 0) {
      return NextResponse.json({ error: "Failed to submit trends tasks" }, { status: 500 });
    }

    // Create job for tracking
    const userId = auth.userId || "anonymous";
    const jobId = await createJob(
      userId,
      "trends",
      taskIds,
      { keywords, benchmark: benchmark || "gpts", dateFrom, dateTo, cacheKey }
    );

    return NextResponse.json({
      jobId,
      status: "processing",
      message: "Trends tasks submitted. Poll /api/research/trends/status?jobId= for results.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
