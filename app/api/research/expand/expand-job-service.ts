import { NextResponse } from "next/server";

import {
  buildFilterCacheKey,
  normalizeKeywords,
  resolveFilterConfig,
  resolveDateRange,
  submitExpansionTasksWithCost,
} from "@/lib/keyword-research";
import { buildCacheKey, getCached, setCache } from "@/lib/cache";
import { createJob, getJob } from "@/lib/research-jobs";

import {
  isCronAuthorized,
  parseResponseLimit,
  isDefaultSharedKeywordRequest,
  findCachedExpandFallback,
  trimExpandResponse,
  getGameKeywords,
} from "./expand-job-helpers";

export async function handleExpandPost(request: Request, userId: string, isStudent: boolean) {
  const debug = process.env.DEBUG_API_LOGS === "true";
  const startedAt = Date.now();

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

  const sharedResultCacheKey = buildCacheKey("expand_result", keywords, {
    dateFrom,
    dateTo,
  });
  if (useCache) {
    const sharedCachedResult = await getCached<import("@/lib/types").ExpandResponse>(sharedResultCacheKey);
    if (sharedCachedResult && Array.isArray(sharedCachedResult.flatList)) {
      const gameKws = await getGameKeywords();
      return NextResponse.json({
        status: "complete",
        ...trimExpandResponse(sharedCachedResult, responseLimit),
        fromCache: true,
        ...(gameKws.length > 0 ? { gameKeywords: gameKws } : {}),
      });
    }
    if (isDefaultSharedKeywordRequest(keywords) || isStudent) {
      const fallback = await findCachedExpandFallback(keywords);
      if (fallback) {
        if (debug) {
          console.log("[api/expand] fallback hit", {
            mode: fallback.mode,
            cacheKey: fallback.cacheKey,
            createdAt: fallback.createdAt,
          });
        }
        const gameKws = await getGameKeywords();
        return NextResponse.json({
          status: "complete",
          ...trimExpandResponse(fallback.response, responseLimit),
          fromCache: true,
          cacheFallback: `fallback_${fallback.mode}`,
          ...(gameKws.length > 0 ? { gameKeywords: gameKws } : {}),
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
    userId: userId,
  });
  const cachedJobId = await getCached<string>(d1CacheKey);
  if (cachedJobId && typeof cachedJobId === "string" && /^[0-9a-f]{8}-/.test(cachedJobId)) {
    const cachedJob = await getJob(cachedJobId, userId);
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

  const taskSubmission = await submitExpansionTasksWithCost(keywords, dateFrom, dateTo, {
    postbackUrl,
    cacheKey: d1CacheKey,
  });
  const taskIds = taskSubmission.taskIds;
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

  const jobId = await createJob(userId, "expand", taskIds, {
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
    cost: taskSubmission.cost,
  });

  if (debug) {
    console.log("[api/expand] job created", {
      jobId,
      tookMs: Date.now() - startedAt,
    });
  }

  await setCache(d1CacheKey, jobId);

  return NextResponse.json({ jobId, status: "pending" });
}
