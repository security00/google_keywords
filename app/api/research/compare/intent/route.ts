import { NextResponse } from "next/server";

import {
  normalizeKeywords,
  resolveBenchmark,
  resolveComparisonDateRange,
  submitSerpTasks,
} from "@/lib/keyword-research";
import type { CompareResponse } from "@/lib/types";
import { authenticate } from "@/lib/auth_middleware";
import { buildCacheKey, getCached } from "@/lib/cache";
import { createJob } from "@/lib/research-jobs";
import { batchScoreKeywords } from "@/lib/rule-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MIN_RULE_SCORE = 20;
const DEFAULT_MAX_INTENT_KEYWORDS = 20;

const isCronAuthorized = (request: Request) => {
  const secret = process.env.CRON_SECRET;
  const externalSecret = process.env.EXTERNAL_CRON_SECRET;
  if (!secret && !externalSecret) return false;

  const headerSecret = request.headers.get("x-cron-secret");
  if (secret && headerSecret === secret) return true;
  if (externalSecret && headerSecret === externalSecret) return true;

  return false;
};

const normalizeInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

export async function POST(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = await authenticate(request as Parameters<typeof authenticate>[0]);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const minRuleScore = normalizeInt(body?.minRuleScore, DEFAULT_MIN_RULE_SCORE, -100, 100);
    const maxIntentKeywords = normalizeInt(
      body?.maxIntentKeywords,
      DEFAULT_MAX_INTENT_KEYWORDS,
      1,
      50
    );

    const ruleResult = batchScoreKeywords(normalizeKeywords(Array.isArray(body?.keywords) ? body.keywords : []));
    const selectedKeywords = ruleResult.kept
      .filter((item) => item.score >= minRuleScore)
      .map((item) => item.keyword)
      .sort((a, b) => a.localeCompare(b));

    if (selectedKeywords.length === 0) {
      return NextResponse.json({ error: "No eligible keywords" }, { status: 400 });
    }

    const { dateFrom, dateTo } = resolveComparisonDateRange(body?.dateFrom, body?.dateTo);
    const benchmark = resolveBenchmark(body?.benchmark);
    const resultCacheKey = buildCacheKey("compare_result", selectedKeywords, {
      dateFrom,
      dateTo,
      benchmark,
    });
    const compareResult = await getCached<CompareResponse>(resultCacheKey);
    if (!compareResult?.results?.length) {
      return NextResponse.json(
        { error: "Shared compare_result cache not found", status: "cache_miss" },
        { status: 409 }
      );
    }

    const intentKeywords = compareResult.results
      .filter((item) => item.verdict !== "fail")
      .slice(0, maxIntentKeywords)
      .map((item) => item.keyword);

    if (intentKeywords.length === 0) {
      return NextResponse.json({
        status: "complete",
        skippedReason: "no non-fail keywords",
        results: compareResult.results.length,
      });
    }

    const taskIds = await submitSerpTasks(intentKeywords);
    if (taskIds.length === 0) {
      return NextResponse.json({ error: "No SERP tasks were created" }, { status: 502 });
    }

    const jobId = await createJob(auth.userId!, "intent", taskIds, {
      resultCacheKey,
      compareResult,
      intentKeywords,
      dateFrom,
      dateTo,
      benchmark,
    });

    return NextResponse.json({
      status: "pending",
      jobId,
      total: taskIds.length,
      intentKeywords: intentKeywords.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
