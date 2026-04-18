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
import { d1Query } from "@/lib/d1";
import { authenticate } from "@/lib/auth_middleware";
import { checkStudentAccess } from "@/lib/usage";
import { buildCacheKey, getCached, setCache } from "@/lib/cache";
import { createJob } from "@/lib/research-jobs";
import { batchScoreKeywords } from "@/lib/rule-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompareStrategy = "manual" | "recent" | "priority";

type DiscoveredKeywordRow = {
  id: string;
  keyword: string;
  url: string | null;
  extracted_at: string;
  source_id: string;
  source_name: string | null;
};

type SelectionResult = {
  keywords: string[];
  keywordIds: string[];
  selectedCount: number;
  availableCount: number;
};

const DEFAULT_COMPARE_MAX_ITEMS = 120;
const MIN_COMPARE_MAX_ITEMS = 10;
const MAX_COMPARE_MAX_ITEMS = 400;
const AUTO_COMPARE_RECENT_HOURS = 24;
const AUTO_COMPARE_LOOKBACK_HOURS = 7 * 24;
const AUTO_COMPARE_POOL_MULTIPLIER = 12;
const DEFAULT_COMPARE_MIN_RULE_SCORE = 20;
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

const isCronAuthorized = (request: Request) => {
  const secret = process.env.CRON_SECRET;
  const externalSecret = process.env.EXTERNAL_CRON_SECRET;
  if (!secret && !externalSecret) return false;

  const headerSecret = request.headers.get("x-cron-secret");
  if (secret && headerSecret === secret) return true;
  if (externalSecret && headerSecret === externalSecret) return true;

  const authHeader = request.headers.get("authorization");
  if (secret && authHeader === `Bearer ${secret}`) return true;
  if (externalSecret && authHeader === `Bearer ${externalSecret}`) return true;

  return false;
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

const normalizeStrategy = (value: unknown): CompareStrategy => {
  if (value === "recent" || value === "priority") return value;
  return "manual";
};

const normalizeIntInRange = (
  raw: unknown,
  fallback: number,
  min: number,
  max: number
) => {
  let parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    if (typeof raw === "string" && raw.trim() !== "") {
      parsed = Number(raw.trim());
    } else {
      return fallback;
    }
  }
  const intValue = Math.floor(parsed);
  if (!Number.isFinite(intValue)) return fallback;
  return Math.min(max, Math.max(min, intValue));
};

const getLatestSharedCompareResult = async (params: {
  dateFrom: string;
  dateTo: string;
  benchmark: string;
}) => {
  const suffix = `benchmark=${params.benchmark},dateFrom=${params.dateFrom},dateTo=${params.dateTo}`;
  const { rows } = await d1Query<{ response_data: string; cache_key: string; created_at: string }>(
    `SELECT response_data, cache_key, created_at
     FROM query_cache
     WHERE instr(cache_key, ':compare_result:') > 0
     ORDER BY created_at DESC
     LIMIT 50`
  );
  const row = rows.find((candidate) => candidate.cache_key.endsWith(suffix));
  if (!row) return null;
  try {
    return {
      response: JSON.parse(row.response_data) as CompareResponse,
      cacheKey: row.cache_key,
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
};

const getLatestSuccessfulSharedCompareResult = async (params: {
  keywords: string[];
  benchmark: string;
}) => {
  const { rows } = await d1Query<{
    response_data: string;
    cache_key: string;
    created_at: string;
  }>(
    `SELECT response_data, cache_key, created_at
     FROM query_cache
     WHERE instr(cache_key, ':compare_result:') > 0
     ORDER BY created_at DESC
     LIMIT 50`
  );
  const expectedKeywords = [...params.keywords].sort();

  for (const row of rows) {
    try {
      const response = JSON.parse(row.response_data) as CompareResponse;
      const responseKeywords = Array.isArray(response.results)
        ? response.results
            .map((item) => item?.keyword)
            .filter((item): item is string => typeof item === "string")
            .sort()
        : [];
      const responseBenchmark =
        typeof (response as CompareResponse & { benchmark?: unknown }).benchmark === "string"
          ? (response as CompareResponse & { benchmark?: string }).benchmark
          : params.benchmark;
      const matchesKeywords =
        responseKeywords.length === expectedKeywords.length &&
        responseKeywords.every((item, index) => item === expectedKeywords[index]);
      if (
        matchesKeywords &&
        responseBenchmark === params.benchmark &&
        Array.isArray(response.results) &&
        response.results.length > 0
      ) {
        return {
          response,
          cacheKey: row.cache_key,
          createdAt: row.created_at,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
};

const getLatestSuccessfulSharedCompareResultAny = async (benchmark: string) => {
  const { rows } = await d1Query<{
    response_data: string;
    cache_key: string;
    created_at: string;
  }>(
    `SELECT response_data, cache_key, created_at
     FROM query_cache
     WHERE instr(cache_key, ':compare_result:') > 0
     ORDER BY created_at DESC
     LIMIT 50`
  );

  for (const row of rows) {
    try {
      const response = JSON.parse(row.response_data) as CompareResponse;
      const responseBenchmark =
        typeof (response as CompareResponse & { benchmark?: unknown }).benchmark === "string"
          ? (response as CompareResponse & { benchmark?: string }).benchmark
          : benchmark;
      if (
        responseBenchmark === benchmark &&
        Array.isArray(response.results) &&
        response.results.length > 0
      ) {
        return {
          response,
          cacheKey: row.cache_key,
          createdAt: row.created_at,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
};

const normalizeKeywordIdList = (raw: unknown) => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
};

const fetchCandidateRows = async (
  userId: string,
  windowHours: number | undefined,
  limit: number
) => {
  let sql = `
    SELECT dk.id, dk.keyword, dk.url, dk.extracted_at, dk.source_id, s.name as source_name
    FROM discovered_keywords dk
    LEFT JOIN sitemap_sources s ON s.id = dk.source_id
    WHERE dk.user_id = ? AND dk.status = 'new'
  `;
  const params: unknown[] = [userId];

  if (windowHours && windowHours > 0) {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
    sql += " AND dk.extracted_at >= ?";
    params.push(cutoff);
  }

  sql += " ORDER BY dk.extracted_at DESC LIMIT ?";
  params.push(limit);

  const { rows } = await d1Query<DiscoveredKeywordRow>(sql, params);
  return rows;
};

const baseKeywordScore = (keyword: string) => {
  const trimmed = keyword.trim();
  if (!trimmed) return -999;

  const lower = trimmed.toLowerCase();
  let score = Math.max(1, Math.min(100, trimmed.length + 10));

  if (trimmed.includes("?") || trimmed.includes("&") || trimmed.includes("=")) {
    score -= 28;
  }
  if (trimmed.includes("%")) {
    score -= 14;
  }
  if (/^\d+$/.test(trimmed)) {
    score -= 20;
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount === 1) score += 8;
  else if (wordCount <= 3) score += 6;
  else if (wordCount > 6) score -= 10;

  if (trimmed.length < 2 || trimmed.length > 60) score -= 25;

  const noiseTerms = [
    "login",
    "signin",
    "signup",
    "portal",
    "download",
    "apk",
    "torrent",
    "news",
    "trailer",
  ];
  for (const item of noiseTerms) {
    if (lower.includes(item)) score -= 8;
  }

  return score;
};

const scoreCandidate = (item: DiscoveredKeywordRow, nowMs: number) => {
  const parsedAt = Date.parse(item.extracted_at);
  const ageHours = Number.isFinite(parsedAt)
    ? Math.max(0, (nowMs - parsedAt) / 36e5)
    : 999;
  const recencyScore = 90 / (1 + ageHours / 12);
  return baseKeywordScore(item.keyword) + recencyScore;
};

const selectCandidatesForCompare = async (
  userId: string,
  strategy: Exclude<CompareStrategy, "manual">,
  maxItems: number
): Promise<SelectionResult> => {
  const nowMs = Date.now();
  const baseLimit = Math.max(maxItems * AUTO_COMPARE_POOL_MULTIPLIER, 80);
  const maxCandidateLimit = Math.max(baseLimit, 5000);

  let allRows: DiscoveredKeywordRow[] = [];
  let availableCount = 0;

  if (strategy === "recent") {
    const recentRows = await fetchCandidateRows(userId, AUTO_COMPARE_RECENT_HOURS, maxCandidateLimit);
    const fallbackRows = await fetchCandidateRows(userId, AUTO_COMPARE_LOOKBACK_HOURS, maxCandidateLimit);
    availableCount = Math.max(recentRows.length, fallbackRows.length);

    const merged = new Map<string, DiscoveredKeywordRow>();
    for (const row of recentRows) {
      merged.set(row.id, row);
    }
    for (const row of fallbackRows) {
      merged.set(row.id, row);
    }
    allRows = Array.from(merged.values());
  } else {
    const rows = await fetchCandidateRows(
      userId,
      AUTO_COMPARE_LOOKBACK_HOURS,
      maxCandidateLimit
    );
    availableCount = rows.length;
    allRows = rows;
  }

  const ranked = allRows
    .map((row) => ({
      row,
      score: scoreCandidate(row, nowMs),
      normalized: row.keyword.trim().toLowerCase(),
    }))
    .filter((item) => item.score > 12 && item.normalized)
    .sort((a, b) => {
      if (b.score === a.score) {
        const aTs = Date.parse(a.row.extracted_at) || 0;
        const bTs = Date.parse(b.row.extracted_at) || 0;
        return bTs - aTs;
      }
      return b.score - a.score;
    });

  const pickedRows: DiscoveredKeywordRow[] = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    if (pickedRows.length >= maxItems) break;
    if (seen.has(item.normalized)) continue;
    seen.add(item.normalized);
    pickedRows.push(item.row);
  }

  return {
    keywords: pickedRows.map((row) => row.keyword),
    keywordIds: pickedRows.map((row) => row.id),
    selectedCount: pickedRows.length,
    availableCount,
  };
};

export async function POST(request: Request) {
  const debug = process.env.DEBUG_API_LOGS === "true";
  const startedAt = Date.now();
  try {
    const auth = await authenticate(request as Parameters<typeof authenticate>[0]);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 });
    }
    const user = { id: auth.userId! };

    // 学员访问检查
    const access = await checkStudentAccess(auth.userId!);
    if (!access.allowed) {
      return NextResponse.json(
        { error: access.reason, code: access.code },
        { status: access.code === "trial_expired" ? 403 : 429 }
      );
    }
    const isStudent = access.user.role === "student";

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
      const selection = await selectCandidatesForCompare(user.id, strategy, maxItems);
      selectedKeywords = selection.keywords;
      selectedKeywordIds = selection.keywordIds;
      selectedCount = selection.selectedCount;
      availableCount = selection.availableCount;
      appliedStrategy = strategy;
    } else {
      appliedStrategy = "manual";
      selectedKeywordIds = selectedKeywordIds;
    }

    if (selectedKeywords.length === 0) {
      if (debug) {
        console.log("[api/compare] invalid request: no selectable keywords");
      }
      return NextResponse.json(
        { error: "No keywords available for comparison" },
        { status: 400 }
      );
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

      const jobId = await createJob(user.id, "compare", taskIds, {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (debug) {
      console.log("[api/compare] error", message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
