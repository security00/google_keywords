import { NextResponse } from "next/server";

import {
  addFreshnessToComparisonResults,
  enrichComparisonResultsWithIntent,
  normalizeKeywords,
  resolveBenchmark,
  resolveComparisonDateRange,
  summarizeResults,
  submitComparisonTasks,
} from "@/lib/keyword-research";
import type { CompareResponse, ComparisonSignalConfig } from "@/lib/types";
import { buildCacheKey, getCached, setCache } from "@/lib/cache";
import { createJob } from "@/lib/research-jobs";
import { batchScoreKeywords } from "@/lib/rule-engine";

import {
  DEFAULT_COMPARE_MAX_ITEMS,
  MIN_COMPARE_MAX_ITEMS,
  MAX_COMPARE_MAX_ITEMS,
  DEFAULT_COMPARE_MIN_RULE_SCORE,
  AUTO_COMPARE_POOL_MULTIPLIER,
  isCronAuthorized,
  parseComparisonSignalConfig,
  normalizeStrategy,
  normalizeIntInRange,
  getLatestSharedCompareResult,
  getLatestSuccessfulSharedCompareResultAny,
  normalizeKeywordIdList,
  selectCandidatesForCompare,
} from "./compare-helpers";
import type { CompareStrategy } from "./compare-helpers";

export async function handleComparePost(request: Request, userId: string, isStudent: boolean) {
  const debug = process.env.DEBUG_API_LOGS === "true";
  const startedAt = Date.now();

  const body = await request.json().catch(() => ({}));
  const allowCreateSharedJob = isCronAuthorized(request);
  const refreshIntent = allowCreateSharedJob && body?.refreshIntent === true;
  const enableIntentLlm = allowCreateSharedJob && body?.enableIntentLlm === true;
  const strategy = normalizeStrategy(body?.strategy);
  const maxItems = normalizeIntInRange(
    body?.maxItems ?? body?.limit,
    DEFAULT_COMPARE_MAX_ITEMS,
    MIN_COMPARE_MAX_ITEMS,
    MAX_COMPARE_MAX_ITEMS
  );
  const keywordsInput = Array.isArray(body?.keywords) ? body.keywords : [];
  const keywordIdsInput = normalizeKeywordIdList(body?.keywordIds);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;
  const comparisonSignalConfig = parseComparisonSignalConfig(
    body?.comparisonSignalConfig
  );

  let selectedKeywords = normalizeKeywords(keywordsInput);
  let selectedKeywordIds = keywordIdsInput;
  let selectedCount = selectedKeywords.length;
  let availableCount = selectedKeywords.length;
  let appliedStrategy: CompareStrategy = strategy;

  if (selectedKeywords.length === 0 && strategy !== "manual") {
    const selection = await selectCandidatesForCompare(userId, strategy, maxItems);
    selectedKeywords = selection.keywords;
    selectedKeywordIds = selection.keywordIds;
    selectedCount = selection.selectedCount;
    availableCount = selection.availableCount;
    appliedStrategy = strategy;
  } else {
    appliedStrategy = "manual";
    selectedKeywordIds = selectedKeywordIds;
  }

  const minRuleScore = normalizeIntInRange(
    body?.minRuleScore,
    DEFAULT_COMPARE_MIN_RULE_SCORE,
    -100,
    100
  );
  const ruleResult = batchScoreKeywords(selectedKeywords);
  const ruleScoreMap = new Map(
    ruleResult.kept.map((item) => [item.keyword.toLowerCase(), item.score])
  );
  const compareEligibleKeywords = ruleResult.kept
    .filter((item) => item.score >= minRuleScore)
    .map((item) => item.keyword);
  const compareFilteredOut =
    selectedKeywords.length - compareEligibleKeywords.length;
  const { dateFrom, dateTo } = resolveComparisonDateRange(
    body?.dateFrom,
    body?.dateTo
  );
  const benchmark = resolveBenchmark(body?.benchmark);

  if (selectedKeywords.length === 0) {
    if (!allowCreateSharedJob && isStudent) {
      const latestShared = await getLatestSharedCompareResult({
        dateFrom,
        dateTo,
        benchmark,
      });
      if (latestShared?.response?.results?.length) {
        const decoratedResults = addFreshnessToComparisonResults(latestShared.response.results);
        return NextResponse.json({
          status: "complete",
          ...latestShared.response,
          results: decoratedResults,
          summary: summarizeResults(decoratedResults),
          fromCache: true,
          cacheFallback: "latest_shared_compare_result",
        });
      }

      const latestSuccessfulShared = await getLatestSuccessfulSharedCompareResultAny(
        benchmark
      );
      if (latestSuccessfulShared?.response?.results?.length) {
        const decoratedResults = addFreshnessToComparisonResults(
          latestSuccessfulShared.response.results
        );
        return NextResponse.json({
          status: "complete",
          ...latestSuccessfulShared.response,
          results: decoratedResults,
          summary: summarizeResults(decoratedResults),
          fromCache: true,
          cacheFallback: "latest_successful_shared_compare_result",
        });
      }
    }

    if (debug) {
      console.log("[api/compare] invalid request: no selectable keywords");
    }
    return NextResponse.json(
      { error: "No keywords available for comparison" },
      { status: 400 }
    );
  }

  if (compareEligibleKeywords.length === 0) {
    if (!allowCreateSharedJob && isStudent) {
      const latestShared = await getLatestSharedCompareResult({
        dateFrom,
        dateTo,
        benchmark,
      });
      if (latestShared?.response?.results?.length) {
        const decoratedResults = addFreshnessToComparisonResults(latestShared.response.results);
        return NextResponse.json({
          status: "complete",
          ...latestShared.response,
          results: decoratedResults,
          summary: summarizeResults(decoratedResults),
          fromCache: true,
          cacheFallback: "latest_shared_compare_result",
        });
      }

      const latestSuccessfulShared = await getLatestSuccessfulSharedCompareResultAny(
        benchmark
      );
      if (latestSuccessfulShared?.response?.results?.length) {
        const decoratedResults = addFreshnessToComparisonResults(
          latestSuccessfulShared.response.results
        );
        return NextResponse.json({
          status: "complete",
          ...latestSuccessfulShared.response,
          results: decoratedResults,
          summary: summarizeResults(decoratedResults),
          fromCache: true,
          cacheFallback: "latest_successful_shared_compare_result",
        });
      }
    }

    return NextResponse.json(
      {
        error: "选择的关键词都被规则过滤掉了，请回到候选词页选择更像工具/软件/AI/SaaS 需求的关键词。",
        filteredOut: compareFilteredOut,
        minRuleScore,
      },
      { status: 400 }
    );
  }

  selectedKeywords = compareEligibleKeywords.sort((a, b) => {
    const scoreDiff =
      Number(ruleScoreMap.get(b.toLowerCase()) ?? 0) -
      Number(ruleScoreMap.get(a.toLowerCase()) ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a.localeCompare(b);
  });
  selectedCount = selectedKeywords.length;

  if (debug) {
    console.log("[api/compare] start", {
      strategy: appliedStrategy,
      keywordsCount: selectedKeywords.length,
      selectedCount,
      availableCount,
      keywordsSample: selectedKeywords.slice(0, 5),
      benchmark,
      dateFrom,
      dateTo,
    });
  }

  // Shared full-site cache: same keywords/date/benchmark should not be tied to a user.
  const compareCacheParams = {
    dateFrom,
    dateTo,
    benchmark,
  };
  const compareResultCacheKey = buildCacheKey(
    "compare_result",
    selectedKeywords,
    compareCacheParams
  );
  const cachedCompareResult = await getCached<CompareResponse>(compareResultCacheKey);
  if (cachedCompareResult?.results?.length) {
    if (refreshIntent && enableIntentLlm) {
      const refreshedResults = await enrichComparisonResultsWithIntent(
        cachedCompareResult.results,
        { enableIntentLlm: true }
      );
      const decoratedResults = addFreshnessToComparisonResults(refreshedResults);
      const refreshedResponse: CompareResponse = {
        ...cachedCompareResult,
        results: decoratedResults,
        summary: summarizeResults(decoratedResults),
      };
      await setCache(compareResultCacheKey, {
        ...refreshedResponse,
        fromCache: false,
      });
      if (debug) console.log("[api/compare] shared intent cache refreshed", { compareResultCacheKey });
      return NextResponse.json({
        status: "complete",
        ...refreshedResponse,
        fromCache: false,
        intentRefreshed: true,
      });
    }
    if (debug) console.log("[api/compare] shared result cache hit", { compareResultCacheKey });
    const decoratedResults = addFreshnessToComparisonResults(cachedCompareResult.results);
    return NextResponse.json({
      status: "complete",
      ...cachedCompareResult,
      results: decoratedResults,
      summary: summarizeResults(decoratedResults),
      fromCache: true,
    });
  }

  const compareCacheKey = buildCacheKey("compare_job", selectedKeywords, compareCacheParams);
  const cachedCompareJobId = await getCached<string>(compareCacheKey);
  if (cachedCompareJobId) {
    if (debug) console.log("[api/compare] cache hit, existing job", { cachedCompareJobId });
    return NextResponse.json({ jobId: cachedCompareJobId, status: "pending", strategy: appliedStrategy, fromCache: true });
  }

  if (!allowCreateSharedJob) {
    const latestShared = await getLatestSharedCompareResult({ dateFrom, dateTo, benchmark });
    if (latestShared?.response?.results?.length) {
      const decoratedResults = addFreshnessToComparisonResults(latestShared.response.results);
      if (debug) {
        console.log("[api/compare] latest shared result fallback hit", {
          requested: selectedKeywords.length,
          cacheKey: latestShared.cacheKey,
          createdAt: latestShared.createdAt,
        });
      }
      return NextResponse.json({
        status: "complete",
        ...latestShared.response,
        results: decoratedResults,
        summary: summarizeResults(decoratedResults),
        fromCache: true,
        cacheFallback: "latest_shared_compare_result",
      });
    }

    const latestSuccessfulShared = await getLatestSuccessfulSharedCompareResultAny(
      benchmark
    );
    if (latestSuccessfulShared?.response?.results?.length) {
      const decoratedResults = addFreshnessToComparisonResults(
        latestSuccessfulShared.response.results
      );
      if (debug) {
        console.log("[api/compare] latest successful shared result fallback hit", {
          requested: selectedKeywords.length,
          cacheKey: latestSuccessfulShared.cacheKey,
          createdAt: latestSuccessfulShared.createdAt,
          fallbackMode: "shared_any",
        });
      }
      return NextResponse.json({
        status: "complete",
        ...latestSuccessfulShared.response,
        results: decoratedResults,
        summary: summarizeResults(decoratedResults),
        fromCache: true,
        cacheFallback: "latest_successful_shared_compare_result",
      });
    }

    return NextResponse.json(
      {
        error: "今日趋势对比共享缓存尚未预计算完成，请稍后重试或先运行预计算脚本。",
        status: "cache_miss",
        selectedCount,
        minRuleScore,
        filteredOut: compareFilteredOut,
      },
      { status: 409 }
    );
  }

  const POSTBACK_BASE = process.env.PUBLIC_BASE_URL || "https://discoverkeywords.co";
  const postbackUrl = `${POSTBACK_BASE}/api/research/webhook`;

  const taskIds = await submitComparisonTasks(
    selectedKeywords,
    dateFrom,
    dateTo,
    benchmark,
    {
      postbackUrl,
      cacheKey: compareCacheKey,
    }
  );

  if (taskIds.length === 0) {
    if (debug) {
      console.log("[api/compare] task creation failed");
    }
    return NextResponse.json(
      { error: "No tasks were created" },
      { status: 502 }
    );
  }

  if (debug) {
    console.log("[api/compare] tasks submitted", { taskCount: taskIds.length });
  }

    const jobId = await createJob(userId, "compare", taskIds, {
    keywords: selectedKeywords,
    keywordIds: selectedKeywordIds,
    strategy: appliedStrategy,
    budget: maxItems,
    selectedCount,
    availableCount,
    dateFrom,
    dateTo,
    benchmark,
    sessionId,
    comparisonSignalConfig,
    cacheKey: compareCacheKey,
    resultCacheKey: compareResultCacheKey,
    enableIntentLlm,
  });

  if (debug) {
    console.log("[api/compare] job created", {
      jobId,
      tookMs: Date.now() - startedAt,
    });
  }

  // 缓存 jobId（同关键词同天不再调 DataForSEO）
  await setCache(compareCacheKey, jobId);

  return NextResponse.json({
    jobId,
    status: "pending",
    strategy: appliedStrategy,
    budget: maxItems,
    selectedCount,
    availableCount,
    keywordIds: selectedKeywordIds,
  });
}
