import { NextResponse } from "next/server";

import { authenticate } from "@/lib/auth_middleware";
import { checkStudentAccess, incrementDailyUsage } from "@/lib/usage";
import {
  submitComparisonTasks,
  getComparisonResults,
  resolveComparisonDateRange,
} from "@/lib/keyword-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/research/trends — Check Google Trends for keywords
// Body: { keywords: string[], months?: number, benchmark?: string }
// Returns: { results: ComparisonResult[] }
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

    if (keywords.length === 0 || keywords.length > 10) {
      return NextResponse.json(
        { error: "keywords is required (max 10)" },
        { status: 400 }
      );
    }

    const { dateFrom, dateTo } = resolveComparisonDateRange();

    // Submit trends tasks
    const taskIds = await submitComparisonTasks(keywords, dateFrom, dateTo, benchmark);

    // Count API usage
    if (access.user.role === "student") {
      await incrementDailyUsage(auth.userId!);
    }

    // Wait + get results (reuse existing functions)
    const { waitForTasks } = await import("@/lib/keyword-research");
    const completed = await waitForTasks(taskIds);

    if (completed.length === 0) {
      return NextResponse.json({ error: "Trends tasks timed out" }, { status: 504 });
    }

    const results = await getComparisonResults(completed, benchmark);

    return NextResponse.json({
      results: results.map((r) => ({
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
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
