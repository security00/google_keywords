import { NextResponse } from "next/server";

import { authenticate } from "@/lib/auth_middleware";
import { checkStudentAccess } from "@/lib/usage";
import { isAuthzError, requirePaidApiPermission } from "@/lib/authz";
import {
  submitSerpTasksWithCost,
  waitForSerpTasks,
  getSerpResults,
} from "@/lib/keyword-research";
import { buildCacheKey, getCached, setCache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/research/serp — Run SERP analysis for keywords
// Body: { keywords: string[], maxWaitMs?: number }
// Returns: { results: Record<string, SerpResult> }
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

    if (keywords.length === 0 || keywords.length > 20) {
      return NextResponse.json(
        { error: "keywords is required (max 20)" },
        { status: 400 }
      );
    }

    // 检查缓存（同关键词同天只调一次 DataForSEO）
    const cacheKey = buildCacheKey("serp", keywords);
    const cached = await getCached<Record<string, Record<string, unknown>>>(cacheKey);
    if (cached) {
      return NextResponse.json({ results: cached, fromCache: true });
    }

    const paidPrincipal = await requirePaidApiPermission(request);
    if (isAuthzError(paidPrincipal)) {
      return NextResponse.json(
        { error: "今日 SERP 共享缓存尚未预计算完成，请稍后重试。", status: "cache_miss" },
        { status: 409 }
      );
    }

    // Submit SERP tasks (admin/cron only)
    const taskSubmission = await submitSerpTasksWithCost(keywords);
    const taskIds = taskSubmission.taskIds;

    // Wait for results
    const completed = await waitForSerpTasks(taskIds);

    if (completed.length === 0) {
      return NextResponse.json({ error: "SERP tasks timed out" }, { status: 504 });
    }

    // Get results
    const summaries = await getSerpResults(completed);

    // Convert to serializable format
    const results: Record<string, Record<string, unknown>> = {};
    for (const [keyword, summary] of summaries) {
      results[keyword] = {
        keyword: summary.keyword,
        itemTypes: summary.itemTypes,
        itemTypeCounts: summary.itemTypeCounts,
        topResults: summary.topResults,
        // Derived signals for skill consumption
        signals: {
          hasAiOverview: summary.itemTypes.includes("ai_overview"),
          hasFeaturedSnippet: summary.itemTypes.includes("featured_snippet"),
          hasKnowledgePanel: summary.itemTypes.includes("knowledge_graph"),
          organicCount: (summary.itemTypeCounts["organic"] ?? 0),
          authDomains: summary.topResults.filter((r) => {
            const d = r.domain || "";
            return ["wikipedia.org", "youtube.com", "reddit.com", "amazon.com", "facebook.com", "twitter.com", "instagram.com", "linkedin.com", "apple.com", "microsoft.com", "google.com", "adobe.com", "forbes.com", "nytimes.com", "bbc.com", "techcrunch.com"].some((a) => d.includes(a));
          }).length,
          nicheDomains: summary.topResults.filter((r) => {
            const d = r.domain || "";
            return !["wikipedia.org", "youtube.com", "reddit.com", "amazon.com", "facebook.com", "twitter.com", "instagram.com", "linkedin.com", "apple.com", "microsoft.com", "google.com", "adobe.com", "forbes.com", "nytimes.com", "bbc.com", "techcrunch.com"].some((a) => d.includes(a));
          }).length,
        },
      };
    }

    // 缓存结果
    await setCache(cacheKey, results);

    return NextResponse.json({ results, cost: taskSubmission.cost, total: taskIds.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
