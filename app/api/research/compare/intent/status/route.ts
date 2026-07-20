import { NextResponse } from "next/server";

import {
  getReadySerpTaskIds,
  getSerpResults,
  inferIntentWithModel,
} from "@/lib/keyword-research";
import type { CompareResponse, ComparisonResult } from "@/lib/types";
import { isAuthzError, requireEffectiveUser } from "@/lib/authz";
import { setCache } from "@/lib/cache";
import {
  claimOwnedJob,
  finishClaimedJob,
  getOwnedJob,
  getOwnedJobStatusSnapshot,
  isLegacyStatusGetExecutionEnabled,
} from "@/lib/research-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const safeCompareResponse = (value: unknown): CompareResponse | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CompareResponse>;
  if (!Array.isArray(raw.results)) return null;
  return raw as CompareResponse;
};

export async function GET(request: Request) {
  try {
    if (request.method === "GET" && isLegacyStatusGetExecutionEnabled()) {
      console.warn(JSON.stringify({ event: "legacy_status_get_execution", jobType: "intent" }));
    }
    const principal = await requireEffectiveUser(request, {
      allowLegacyQueryKey: true,
    });
    if (isAuthzError(principal)) return principal;

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    if (request.method === "GET" && !isLegacyStatusGetExecutionEnabled()) {
      const snapshot = await getOwnedJobStatusSnapshot(
        jobId,
        principal.userId,
        "intent",
      );
      return snapshot
        ? NextResponse.json(snapshot)
        : NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const job = await getOwnedJob(jobId, principal.userId, "intent");
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.status === "complete") {
      return NextResponse.json({ status: "complete", ready: job.task_ids.length, total: job.task_ids.length });
    }
    if (job.status === "failed") {
      return NextResponse.json({ status: "failed", error: job.error ?? "Intent job failed" }, { status: 500 });
    }

    const readyTaskIds = await getReadySerpTaskIds(job.task_ids);
    const jobAgeMs = Date.now() - Date.parse(job.created_at);
    const shouldFallbackFetch = readyTaskIds.length === 0 && jobAgeMs > 60_000;
    const taskIdsToFetch = shouldFallbackFetch ? job.task_ids : readyTaskIds;

    if (taskIdsToFetch.length < job.task_ids.length) {
      return NextResponse.json({
        status: "pending",
        ready: readyTaskIds.length,
        total: job.task_ids.length,
      });
    }

    const claim = await claimOwnedJob(job.id, principal.userId, "intent");
    if (!claim) {
      return NextResponse.json({
        status: "pending",
        stage: "processing",
        ready: taskIdsToFetch.length,
        total: job.task_ids.length,
      });
    }

    const payload = job.payload ?? {};
    const resultCacheKey =
      typeof payload.resultCacheKey === "string" ? payload.resultCacheKey : undefined;
    const compareResult = safeCompareResponse(payload.compareResult);
    if (!resultCacheKey || !compareResult) {
      const error = "Missing intent job payload";
      await finishClaimedJob(
        job.id,
        principal.userId,
        claim.token,
        "failed",
        { error },
      );
      return NextResponse.json({ status: "failed", error }, { status: 500 });
    }

    const summariesMap = await getSerpResults(taskIdsToFetch);
    if (summariesMap.size < job.task_ids.length) {
      return NextResponse.json({
        status: "pending",
        ready: summariesMap.size,
        total: job.task_ids.length,
        fallbackFetch: shouldFallbackFetch,
      });
    }
    const summaries = Array.from(summariesMap.values());
    const intentMap = await inferIntentWithModel(summaries);

    const refreshedResults: ComparisonResult[] = compareResult.results.map((item) => {
      const intent = intentMap.get(item.keyword.toLowerCase());
      return intent ? { ...item, intent } : item;
    });
    const refreshedResponse: CompareResponse = {
      ...compareResult,
      results: refreshedResults,
    };

    await setCache(
      resultCacheKey,
      {
        ...refreshedResponse,
        fromCache: false,
        intentRefreshed: true,
      },
      { namespace: "compare-result" },
    );
    const finished = await finishClaimedJob(
      job.id,
      principal.userId,
      claim.token,
      "complete",
    );
    if (!finished) {
      throw new Error("Intent job claim lost before completion");
    }

    return NextResponse.json({
      status: "complete",
      total: job.task_ids.length,
      ready: taskIdsToFetch.length,
      intents: intentMap.size,
      results: refreshedResults.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}

export const POST = GET;
