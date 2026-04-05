import { NextResponse } from "next/server";

import {
  buildFilterCacheKey,
  flattenOrganizedCandidates,
  loadCache,
  organizeCandidates,
  normalizeKeywords,
  resolveFilterConfig,
  resolveDateRange,
  submitExpansionTasks,
} from "@/lib/keyword-research";
import type { ExpandResponse } from "@/lib/types";

import { getAuthUser } from "@/lib/auth";
import { createJob } from "@/lib/research-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const debug = process.env.DEBUG_API_LOGS === "true";
  const startedAt = Date.now();
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const keywordsInput = Array.isArray(body?.keywords) ? body.keywords : [];
    const useCache = body?.useCache !== false;
    const useFilter = body?.useFilter !== false;
    const includeTop = body?.includeTop === true;
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

    if (useCache) {
      const cached = await loadCache(keywords, dateFrom, dateTo, cacheKey);
      if (cached) {
        if (debug) {
          console.log("[api/expand] cache hit", {
            candidates: cached.candidates.length,
            filter: cached.filterSummary,
          });
        }
        const organized = organizeCandidates(cached.candidates);
        const response: ExpandResponse = {
          keywords: cached.keywords,
          dateFrom: cached.dateFrom,
          dateTo: cached.dateTo,
          candidates: cached.candidates,
          organized,
          flatList: flattenOrganizedCandidates(organized),
          fromCache: true,
          filter: cached.filterSummary,
          filteredOut: cached.filteredOut,
        };
        return NextResponse.json(response);
      }
    }

    const taskIds = await submitExpansionTasks(keywords, dateFrom, dateTo);
    if (taskIds.length === 0) {
      if (debug) {
        console.log("[api/expand] task creation failed");
      }
      return NextResponse.json(
        { error: "No tasks were created" },
        { status: 502 }
      );
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
    });

    if (debug) {
      console.log("[api/expand] job created", {
        jobId,
        tookMs: Date.now() - startedAt,
      });
    }

    return NextResponse.json({ jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (debug) {
      console.log("[api/expand] error", message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
