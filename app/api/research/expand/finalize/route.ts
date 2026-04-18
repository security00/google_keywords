import { NextResponse } from "next/server";

import {
  flattenOrganizedCandidates,
  getReadyTaskIds,
  organizeCandidates,
} from "@/lib/keyword-research";
import type { Candidate, ExpandResponse } from "@/lib/types";
import { d1Query } from "@/lib/d1";
import { getJobById, updateJobStatus } from "@/lib/research-jobs";
import { batchScoreKeywords } from "@/lib/rule-engine";
import { setCache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const D1_IN_QUERY_CHUNK_SIZE = 100;

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

const loadPostbackResults = async (taskIds: string[]) => {
  const rows: { task_id: string; result_data: string }[] = [];

  for (let index = 0; index < taskIds.length; index += D1_IN_QUERY_CHUNK_SIZE) {
    const chunk = taskIds.slice(index, index + D1_IN_QUERY_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await d1Query<{ task_id: string; result_data: string }>(
      `SELECT task_id, result_data
       FROM postback_results
       WHERE task_id IN (${placeholders})`,
      chunk
    );
    rows.push(...result.rows);
  }

  return rows;
};

const parseCandidatesFromPostbacks = (postbackResults: string[]) => {
  const candidates: Candidate[] = [];

  for (const resultJson of postbackResults) {
    const parsed = JSON.parse(resultJson);
    const taskResult = parsed?.tasks?.[0]?.result;
    if (!Array.isArray(taskResult)) continue;

    for (const entry of taskResult) {
      const sourceKeyword = entry?.keywords?.[0] ?? "unknown";
      const items = Array.isArray(entry?.items) ? entry.items : [];

      for (const item of items) {
        if (item?.type !== "google_trends_queries_list") continue;
        const data = item?.data;

        if (Array.isArray(data)) {
          for (const qi of data) {
            const keyword = qi?.query ?? "";
            if (!keyword) continue;
            candidates.push({
              keyword,
              value: Number(qi?.value ?? 0),
              type: String(qi?.type ?? "").toLowerCase().includes("rising")
                ? "rising"
                : "top",
              source: sourceKeyword,
            });
          }
        } else if (data && typeof data === "object") {
          for (const qi of data.top ?? []) {
            const keyword = qi?.query ?? "";
            if (!keyword) continue;
            candidates.push({
              keyword,
              value: Number(qi?.value ?? 0),
              type: "top",
              source: sourceKeyword,
            });
          }
          for (const qi of data.rising ?? []) {
            const keyword = qi?.query ?? "";
            if (!keyword) continue;
            candidates.push({
              keyword,
              value: Number(qi?.value ?? 0),
              type: "rising",
              source: sourceKeyword,
            });
          }
        }
      }
    }
  }

  return candidates;
};

export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const job = await getJobById(jobId, "expand");
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const payload = job.payload ?? {};
    const keywords = Array.isArray(payload.keywords)
      ? payload.keywords.filter((item): item is string => typeof item === "string")
      : [];
    const dateFrom = typeof payload.dateFrom === "string" ? payload.dateFrom : "";
    const dateTo = typeof payload.dateTo === "string" ? payload.dateTo : "";
    const includeTop = payload.includeTop === true;
    const sharedResultCacheKey =
      typeof payload.sharedResultCacheKey === "string"
        ? payload.sharedResultCacheKey
        : "";

    const rows = await loadPostbackResults(job.task_ids);
    const resultMap = new Map(rows.map((row) => [row.task_id, row.result_data]));
    const postbackResults: string[] = [];
    const postbackTaskIds: string[] = [];
    for (const taskId of job.task_ids) {
      const result = resultMap.get(taskId);
      if (result) {
        postbackTaskIds.push(taskId);
        postbackResults.push(result);
      }
    }

    if (postbackResults.length < job.task_ids.length) {
      const readyIds = await getReadyTaskIds(job.task_ids);
      const availableIds = Array.from(new Set([...postbackTaskIds, ...readyIds]));
      return NextResponse.json({
        status: "pending",
        ready: availableIds.length,
        total: job.task_ids.length,
      });
    }

    let candidates = parseCandidatesFromPostbacks(postbackResults);
    if (!includeTop) {
      candidates = candidates.filter((candidate) => candidate.type === "rising");
    }

    const ruleResult = batchScoreKeywords(candidates.map((candidate) => candidate.keyword));
    const ruleBlockedSet = new Set(ruleResult.blocked.map((keyword) => keyword.toLowerCase()));
    const ruleKeptMap = new Map(
      ruleResult.kept.map((item) => [item.keyword.toLowerCase(), item.score])
    );
    const filteredOut = candidates.filter((candidate) =>
      ruleBlockedSet.has(candidate.keyword.toLowerCase())
    );
    const enrichedCandidates = candidates
      .filter((candidate) => !ruleBlockedSet.has(candidate.keyword.toLowerCase()))
      .map((candidate) => ({
        ...candidate,
        isNew: false,
        score: Number(ruleKeptMap.get(candidate.keyword.toLowerCase())) || 0,
      }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const organized = organizeCandidates(enrichedCandidates);
    const response: ExpandResponse = {
      keywords,
      dateFrom,
      dateTo,
      candidates: enrichedCandidates,
      organized,
      flatList: flattenOrganizedCandidates(organized),
      fromCache: false,
      filteredOut,
      ruleStats: {
        blocked: ruleBlockedSet.size,
        kept: ruleKeptMap.size,
      },
    };

    if (sharedResultCacheKey) {
      await setCache(sharedResultCacheKey, response);
    }

    await updateJobStatus(job.id, "complete", { sessionId: null });

    return NextResponse.json({
      status: "complete",
      ...response,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
