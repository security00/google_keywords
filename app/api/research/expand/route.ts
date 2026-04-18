import { NextResponse } from "next/server";

import {
  buildFilterCacheKey,
  normalizeKeywords,
  organizeCandidates,
  flattenOrganizedCandidates,
  resolveFilterConfig,
  resolveDateRange,
  submitExpansionTasks,
} from "@/lib/keyword-research";
import type { ExpandResponse } from "@/lib/types";
import sharedKeywordDefaults from "@/config/shared-keyword-defaults.json";

import { authenticate } from "@/lib/auth_middleware";
import { checkStudentAccess } from "@/lib/usage";
import { buildCacheKey, getCached, setCache } from "@/lib/cache";
import { createJob, getJob } from "@/lib/research-jobs";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseResponseLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(Math.max(Math.floor(parsed), 50), 5000);
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

const DEFAULT_SHARED_KEYWORDS = normalizeKeywords(
  Array.isArray(sharedKeywordDefaults.defaultKeywords)
    ? sharedKeywordDefaults.defaultKeywords
    : []
);

const toComparableKeywordList = (keywords: string[]) =>
  [...keywords].map((item) => item.trim().toLowerCase()).sort();

const isDefaultSharedKeywordRequest = (keywords: string[]) => {
  if (keywords.length !== DEFAULT_SHARED_KEYWORDS.length) return false;
  const left = toComparableKeywordList(keywords);
  const right = toComparableKeywordList(DEFAULT_SHARED_KEYWORDS);
  return left.every((item, index) => item === right[index]);
};

const getLatestSharedExpandResult = async (params: {
  dateFrom: string;
  dateTo: string;
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const prefix = `${today}:expand_result:`;
  const suffix = `dateFrom=${params.dateFrom},dateTo=${params.dateTo}`;
  const { rows } = await d1Query<{
    response_data: string;
    cache_key: string;
    created_at: string;
  }>(
    `SELECT response_data, cache_key, created_at
     FROM query_cache
     WHERE substr(cache_key, 1, ?) = ?
     ORDER BY created_at DESC
     LIMIT 20`,
    [prefix.length, prefix]
  );
  const row = rows.find((candidate) => candidate.cache_key.endsWith(suffix));
  if (!row) return null;
  try {
    return {
      response: JSON.parse(row.response_data) as ExpandResponse,
      cacheKey: row.cache_key,
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
};

const getLatestSuccessfulSharedExpandResult = async (keywords: string[]) => {
  const { rows } = await d1Query<{
    response_data: string;
    cache_key: string;
    created_at: string;
  }>(
    `SELECT response_data, cache_key, created_at
     FROM query_cache
     WHERE instr(cache_key, ':expand_result:') > 0
     ORDER BY created_at DESC
     LIMIT 50`
  );
  const expected = toComparableKeywordList(keywords);

  for (const row of rows) {
    try {
      const response = JSON.parse(row.response_data) as ExpandResponse;
      const responseKeywords = Array.isArray(response.keywords)
        ? normalizeKeywords(response.keywords)
        : [];
      const matchesKeywords =
        responseKeywords.length === expected.length &&
        toComparableKeywordList(responseKeywords).every(
          (item, index) => item === expected[index]
        );
      if (
        matchesKeywords &&
        Array.isArray(response.flatList) &&
        response.flatList.length > 0
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

const getLatestSuccessfulSharedExpandResultAny = async () => {
  const { rows } = await d1Query<{
    response_data: string;
    cache_key: string;
    created_at: string;
  }>(
    `SELECT response_data, cache_key, created_at
     FROM query_cache
     WHERE instr(cache_key, ':expand_result:') > 0
     ORDER BY created_at DESC
     LIMIT 50`
  );

  for (const row of rows) {
    try {
      const response = JSON.parse(row.response_data) as ExpandResponse;
      if (Array.isArray(response.flatList) && response.flatList.length > 0) {
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

const trimExpandResponse = (response: ExpandResponse, limit?: number) => {
  if (!limit || response.flatList.length <= limit) return response;

  const fullOrganized = organizeCandidates(response.candidates);
  const sectionKeys = ["explosive", "fastRising", "steadyRising", "slowRising"] as const;
  const baseQuota = Math.floor(limit / sectionKeys.length);
  const organized = {
    explosive: [] as typeof response.candidates,
    fastRising: [] as typeof response.candidates,
    steadyRising: [] as typeof response.candidates,
    slowRising: [] as typeof response.candidates,
  };

  let remaining = limit;
  for (const key of sectionKeys) {
    const take = Math.min(fullOrganized[key].length, baseQuota, remaining);
    organized[key] = fullOrganized[key].slice(0, take);
    remaining -= take;
  }
  for (const key of sectionKeys) {
    if (remaining <= 0) break;
    const alreadyTaken = organized[key].length;
    const extra = fullOrganized[key].slice(alreadyTaken, alreadyTaken + remaining);
    organized[key] = [...organized[key], ...extra];
    remaining -= extra.length;
  }

  const limitedCandidates = flattenOrganizedCandidates(organized);

  return {
    ...response,
    candidates: limitedCandidates,
    organized,
    flatList: limitedCandidates,
    totalCandidates: response.flatList.length,
    returnedCandidates: limitedCandidates.length,
    hasMoreCandidates: true,
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
    const keywordsInput = Array.isArray(body?.keywords) ? body.keywords : [];
    const useCache = body?.useCache !== false;
    const useFilter = body?.useFilter !== false;
    const enableLlmFilter = body?.enableLlmFilter === true;
    const includeTop = body?.includeTop === true;
    const responseLimit = parseResponseLimit(body?.responseLimit);
    const filterPrompt =
      typeof body?.filterPrompt === "string" ? body.filterPrompt : undefined;
    const filterTermsInput = Array.isArray(body?.filterTerms)
      ? body.filterTerms
      : typeof body?.filterTerms === "string"
        ? body.filterTerms.split(/[,;\n]+/)
        : undefined;

    const keywords = normalizeKeywords(keywordsInput);
    if (keywords.length === 0) {
      if (debug) {
        console.log("[api/expand] invalid request: keywords missing");
      }
      return NextResponse.json(
        { error: "keywords is required" },
        { status: 400 }
      );
    }

    const { dateFrom, dateTo } = resolveDateRange(
      body?.dateFrom,
      body?.dateTo
    );

    const filterConfig = resolveFilterConfig({
      useFilter,
      overrideTerms: filterTermsInput,
      prompt: filterPrompt,
    });
    const cacheKey = buildFilterCacheKey(filterConfig);

    if (debug) {
      console.log("[api/expand] start", {
        keywordsCount: keywords.length,
        keywordsSample: keywords.slice(0, 5),
        useCache,
        useFilter,
        includeTop,
        dateFrom,
        dateTo,
        filterTermsCount: filterConfig.terms.length,
        filterTermsSample: filterConfig.terms.slice(0, 8),
        hasPrompt: Boolean(filterConfig.prompt),
      });
    }

    // Filesystem cache not supported on CF Workers — skip
    // D1 cache check below handles all caching

    // 检查今天是否已有同关键词的已完成任务（缓存）
    // Note: webhook may overwrite cache with raw DataForSEO response;
    // only treat it as a jobId cache hit if the value looks like a UUID
    const sharedResultCacheKey = buildCacheKey("expand_result", keywords, {
      dateFrom,
      dateTo,
    });
    if (useCache) {
      const sharedCachedResult = await getCached<ExpandResponse>(sharedResultCacheKey);
      if (sharedCachedResult && Array.isArray(sharedCachedResult.flatList)) {
        return NextResponse.json({
          status: "complete",
          ...trimExpandResponse(sharedCachedResult, responseLimit),
          fromCache: true,
        });
      }
      if (isDefaultSharedKeywordRequest(keywords) || isStudent) {
        const latestShared = await getLatestSharedExpandResult({ dateFrom, dateTo });
        if (latestShared?.response && Array.isArray(latestShared.response.flatList)) {
          if (debug) {
            console.log("[api/expand] latest shared result fallback hit", {
              cacheKey: latestShared.cacheKey,
              createdAt: latestShared.createdAt,
            });
          }
          return NextResponse.json({
            status: "complete",
            ...trimExpandResponse(latestShared.response, responseLimit),
            fromCache: true,
          });
        }

        const latestSuccessfulShared = isDefaultSharedKeywordRequest(keywords)
          ? await getLatestSuccessfulSharedExpandResult(keywords)
          : await getLatestSuccessfulSharedExpandResultAny();
        if (latestSuccessfulShared?.response && Array.isArray(latestSuccessfulShared.response.flatList)) {
          if (debug) {
            console.log("[api/expand] latest successful shared result fallback hit", {
              cacheKey: latestSuccessfulShared.cacheKey,
              createdAt: latestSuccessfulShared.createdAt,
              fallbackMode: isDefaultSharedKeywordRequest(keywords)
                ? "keyword_match"
                : "student_any",
            });
          }
          return NextResponse.json({
            status: "complete",
            ...trimExpandResponse(latestSuccessfulShared.response, responseLimit),
            fromCache: true,
            cacheFallback: "latest_successful_shared_expand_result",
          });
        }
      }
    }

    if (!allowCreateSharedJob) {
      return NextResponse.json(
        {
          error: "当前请求暂无可复用缓存结果，请稍后再试或等待后台预计算完成。",
          status: "cache_miss",
        },
        { status: 409 }
      );
    }

    const d1CacheKey = buildCacheKey("expand", keywords, {
      dateFrom,
      dateTo,
      userId: user.id,
    });
    const cachedJobId = await getCached<string>(d1CacheKey);
    if (cachedJobId && typeof cachedJobId === "string" && /^[0-9a-f]{8}-/.test(cachedJobId)) {
      const cachedJob = await getJob(cachedJobId, user.id);
      if (cachedJob && cachedJob.status !== "failed") {
        if (debug) {
          console.log("[api/expand] cache hit, existing job", {
            cachedJobId,
            status: cachedJob.status,
          });
        }
        return NextResponse.json({
          jobId: cachedJobId,
          status: "pending",
          fromCache: true,
        });
      }
      if (debug) {
        console.log("[api/expand] ignoring stale failed/missing cached job", {
          cachedJobId,
          status: cachedJob?.status ?? "missing",
        });
      }
    }

    const POSTBACK_BASE = process.env.PUBLIC_BASE_URL || "https://discoverkeywords.co";
    const postbackUrl = `${POSTBACK_BASE}/api/research/webhook`;

    const taskIds = await submitExpansionTasks(keywords, dateFrom, dateTo, {
      postbackUrl,
      cacheKey: d1CacheKey,
    });
    if (taskIds.length === 0) {
      const message = `Expansion task creation returned 0 task ids for ${keywords.length} keywords`;
      console.error("[api/expand] task creation returned 0 ids", {
        keywordsCount: keywords.length,
        keywordsSample: keywords.slice(0, 10),
        dateFrom,
        dateTo,
      });
      return NextResponse.json({ error: message }, { status: 502 });
    }

    if (debug) {
      console.log("[api/expand] tasks submitted", { taskCount: taskIds.length });
    }

    const jobId = await createJob(user.id, "expand", taskIds, {
      keywords,
      dateFrom,
      dateTo,
      includeTop,
      useFilter,
      filterConfig,
      cacheKey,
      sharedResultCacheKey,
      responseLimit,
      enableLlmFilter,
    });

    if (debug) {
      console.log("[api/expand] job created", {
        jobId,
        tookMs: Date.now() - startedAt,
      });
    }

    // 缓存 jobId（同关键词同天不再调 DataForSEO）
    await setCache(d1CacheKey, jobId);

    return NextResponse.json({ jobId, status: "pending" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[api/expand] error", {
      message,
      tookMs: Date.now() - startedAt,
    });
    if (debug) {
      console.log("[api/expand] error", message);
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
