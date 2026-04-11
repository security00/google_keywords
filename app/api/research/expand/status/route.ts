import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import {
  filterCandidatesWithModel,
  getExpansionResults,
  getReadyTaskIds,
  saveCache,
  organizeCandidates,
  flattenOrganizedCandidates,
} from "@/lib/keyword-research";
import type { ExpandResponse } from "@/lib/types";
import type { FilterConfig } from "@/lib/keyword-research";
import { d1InsertMany, d1Query } from "@/lib/d1";
import { authenticate } from "@/lib/auth_middleware";
import { fetchSessionPayload } from "@/lib/session-store";
import { getJob, updateJobStatus } from "@/lib/research-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryD1 = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("network connection lost") ||
    lowered.includes("exceeded timeout") ||
    lowered.includes("timeout") ||
    lowered.includes("exceeded its memory limit") ||
    lowered.includes("storage operation") ||
    lowered.includes("internal error") ||
    lowered.includes("too many requests queued") ||
    lowered.includes("d1_error") ||
    lowered.includes("error code: 1031") ||
    /d1 request failed \\((429|500|502|503|504|520|522|524)\\)/.test(lowered)
  );
};

const normalizeCandidateType = (value: unknown): "top" | "rising" =>
  value === "top" ? "top" : "rising";

const parseJobKeywords = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((keyword): keyword is string => typeof keyword === "string")
    : [];

const parseFilterConfig = (value: unknown): FilterConfig | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const terms = Array.isArray(raw.terms)
    ? raw.terms.filter((term): term is string => typeof term === "string")
    : [];
  const prompt =
    typeof raw.prompt === "string" && raw.prompt.trim()
      ? raw.prompt.trim()
      : undefined;

  return {
    enabled: raw.enabled === true,
    model: typeof raw.model === "string" ? raw.model : "openai/gpt-5.2",
    terms,
    prompt,
  };
};

export async function GET(request: Request) {
  const debug = process.env.DEBUG_API_LOGS === "true";
  const log = (message: string, meta?: Record<string, unknown>) => {
    if (!debug) return;
    if (meta) {
      console.log(`[api/expand] ${message}`, meta);
    } else {
      console.log(`[api/expand] ${message}`);
    }
  };
  const retryD1 = async <T>(
    label: string,
    fn: () => Promise<T>,
    maxAttempts = 3
  ): Promise<T> => {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected error";
        attempt += 1;
        if (attempt >= maxAttempts || !shouldRetryD1(message)) {
          throw error;
        }
        log(`${label} retry`, { attempt, message });
        await sleep(500 * attempt);
      }
    }
  };
  try {
    const auth = await authenticate(request as any);
    if (!auth.authenticated) { return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 }); }
    const user = { id: auth.userId! };
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const job = await getJob(jobId, user.id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "failed") {
      return NextResponse.json({ status: "failed", error: job.error ?? "Job failed" });
    }

    if (job.status === "processing") {
      return NextResponse.json({
        status: "pending",
        ready: job.task_ids.length,
        total: job.task_ids.length,
      });
    }

    if (job.status === "complete") {
      if (job.session_id) {
        const payload = await fetchSessionPayload(user.id, job.session_id);
        if (!payload?.session) {
          return NextResponse.json({ status: "complete" });
        }

        const unfiltered = (payload.candidates ?? [])
          .filter((item) => !item.filtered)
          .map((item) => ({
            keyword: item.keyword,
            value: Number(item.value ?? 0),
            type: normalizeCandidateType(item.type),
            source: item.source ?? "",
          }));

        const filteredOut = (payload.candidates ?? [])
          .filter((item) => item.filtered)
          .map((item) => ({
            keyword: item.keyword,
            value: Number(item.value ?? 0),
            type: normalizeCandidateType(item.type),
            source: item.source ?? "",
          }));

        const organized = organizeCandidates(unfiltered);

        const response: ExpandResponse = {
          keywords: payload.session.keywords ?? [],
          dateFrom: payload.session.date_from ?? "",
          dateTo: payload.session.date_to ?? "",
          candidates: unfiltered,
          organized,
          flatList: flattenOrganizedCandidates(organized),
          fromCache: false,
          filter: payload.session.filter_summary ?? undefined,
          filteredOut,
          sessionId: payload.session.id,
        };

        return NextResponse.json({ status: "complete", ...response });
      }
      return NextResponse.json({ status: "complete" });
    }

    const payload = job.payload ?? {};
    const keywords = parseJobKeywords(payload.keywords);
    const dateFrom = typeof payload.dateFrom === "string" ? payload.dateFrom : undefined;
    const dateTo = typeof payload.dateTo === "string" ? payload.dateTo : undefined;
    const includeTop = payload.includeTop === true;
    const useFilter = payload.useFilter !== false;
    const filterConfig = parseFilterConfig(payload.filterConfig);
    const cacheKey = typeof payload.cacheKey === "string" ? payload.cacheKey : "";

    // Check if all tasks have postback results (avoids calling DataForSEO)
    const postbackResults: string[] = [];
    for (const tid of job.task_ids) {
      const { rows } = await d1Query<{ result_data: string }>(
        `SELECT result_data FROM postback_results WHERE task_id = ? LIMIT 1`,
        [tid]
      );
      if (rows.length > 0) {
        postbackResults.push(rows[0].result_data);
      }
    }

    const usePostback = postbackResults.length === job.task_ids.length;

    if (!usePostback) {
      // Fallback: check DataForSEO tasks_ready endpoint
      const readyIds = await getReadyTaskIds(job.task_ids);
      if (readyIds.length < job.task_ids.length) {
        return NextResponse.json({
          status: "pending",
          ready: readyIds.length,
          total: job.task_ids.length,
        });
      }
    }

    let stage = "mark-processing";
    try {
      await retryD1("job processing", () => updateJobStatus(job.id, "processing"));

      stage = "fetch-results";
      let candidates;
      if (usePostback) {
        // Parse results from postback (no DataForSEO HTTP call needed)
        stage = "parse-postback";
        candidates = [];
        for (const resultJson of postbackResults) {
          const parsed = JSON.parse(resultJson);
          // DataForSEO task_get format: { tasks: [{ result: [...] }] }
          const taskResult = parsed?.tasks?.[0]?.result;
          if (Array.isArray(taskResult)) {
            for (const item of taskResult) {
              const kw = item?.keyword;
              if (!kw) continue;
              // Extract related keywords from google_trends_queries_list
              const items = Array.isArray(item?.items) ? item.items : [];
              for (const sub of items) {
                if (sub?.type === "google_trends_queries_list" && Array.isArray(sub?.items)) {
                  for (const entry of sub.items) {
                    const keyword = entry?.keyword;
                    const value = entry?.keyword_info?.search_volume ?? 0;
                    if (keyword) {
                      candidates.push({
                        keyword,
                        value: Number(value) || 0,
                        type: entry?.type === "top" ? "top" as const : "rising" as const,
                        source: "google_trends",
                      });
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        candidates = await getExpansionResults(job.task_ids);
      }
      if (!includeTop) {
        candidates = candidates.filter((candidate) => candidate.type === "rising");
      }

      let filteredCandidates = candidates;
      let filterSummary = undefined;
      let filteredOut: ExpandResponse["filteredOut"] = undefined;

      if (useFilter && filterConfig) {
        stage = "filter";
        const { filtered, blocked, summary } = await filterCandidatesWithModel(
          candidates,
          filterConfig,
          { debug }
        );
        filteredCandidates = filtered;
        filterSummary = summary;
        filteredOut = blocked;
      }

      if (keywords.length && dateFrom && dateTo) {
        stage = "cache";
        await saveCache(
          keywords,
          dateFrom,
          dateTo,
          filteredCandidates,
          filterSummary,
          filteredOut,
          cacheKey
        );
      }

      const sessionId = randomUUID();
      const now = new Date().toISOString();

      const candidateRows = [
        ...filteredCandidates.map((candidate) => [
          randomUUID(),
          sessionId,
          user.id,
          candidate.keyword,
          candidate.value ?? null,
          candidate.type,
          candidate.source,
          0,
          now,
        ]),
        ...(filteredOut ?? []).map((candidate) => [
          randomUUID(),
          sessionId,
          user.id,
          candidate.keyword,
          candidate.value ?? null,
          candidate.type,
          candidate.source,
          1,
          now,
        ]),
      ];

      stage = "persist-session";
      const persistSession = async () => {
        stage = "db:clear-candidates";
        await d1Query("DELETE FROM candidates WHERE session_id = ?", [sessionId]);
        stage = "db:clear-session";
        await d1Query("DELETE FROM research_sessions WHERE id = ?", [sessionId]);
        stage = "db:insert-session";
        await d1Query(
          `INSERT INTO research_sessions (id, user_id, title, keywords, date_from, date_to, benchmark, include_top, use_filter, filter_terms, filter_prompt, filter_summary, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionId,
            user.id,
            keywords.slice(0, 3).join(", "),
            JSON.stringify(keywords),
            dateFrom ?? null,
            dateTo ?? null,
            process.env.BENCHMARK_KEYWORD ?? "gpts",
            includeTop ? 1 : 0,
            useFilter ? 1 : 0,
            JSON.stringify(filterConfig?.terms ?? []),
            filterConfig?.prompt ?? null,
            filterSummary ? JSON.stringify(filterSummary) : null,
            now,
          ]
        );
        if (candidateRows.length > 0) {
          stage = "db:insert-candidates";
          await d1InsertMany(
            "candidates",
            [
              "id",
              "session_id",
              "user_id",
              "keyword",
              "value",
              "type",
              "source",
              "filtered",
              "created_at",
            ],
            candidateRows,
            200
          );
        }
      };
      await retryD1("persist session", persistSession);

      stage = "job-complete";
      await retryD1("job complete", () =>
        updateJobStatus(job.id, "complete", { sessionId })
      );

      const organized = organizeCandidates(filteredCandidates);
      const response: ExpandResponse = {
        keywords,
        dateFrom: dateFrom ?? "",
        dateTo: dateTo ?? "",
        candidates: filteredCandidates,
        organized,
        flatList: flattenOrganizedCandidates(organized),
        fromCache: false,
        filter: filterSummary,
        filteredOut,
        sessionId,
      };

      return NextResponse.json({ status: "complete", ...response });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      const errorMessage = `${stage}: ${message}`;
      try {
        await retryD1("job failed", () =>
          updateJobStatus(job.id, "failed", { error: errorMessage })
        );
      } catch (updateError) {
        const updateMessage =
          updateError instanceof Error ? updateError.message : "Unexpected error";
        log("job failed update error", {
          message: updateMessage,
          original: errorMessage,
        });
      }
      return NextResponse.json({ status: "failed", error: errorMessage }, { status: 500 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
