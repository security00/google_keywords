import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import {
  filterCandidatesWithModel,
  getExpansionResults,
  getReadyTaskIds,
  organizeCandidates,
  flattenOrganizedCandidates,
  submitSerpTasks,
  waitForSerpTasks,
  getSerpResults,
} from "@/lib/keyword-research";
import type { ExpandResponse, Candidate, FilterSummary } from "@/lib/types";
import type { FilterConfig } from "@/lib/keyword-research";
import {
  submitComparisonTasks,
  waitForTasks,
  getComparisonResults,
  resolveBenchmark,
  resolveComparisonDateRange,
} from "@/lib/keyword-research";
import { d1InsertMany, d1Query } from "@/lib/d1";
import { authenticate } from "@/lib/auth_middleware";
import { fetchSessionPayload } from "@/lib/session-store";
import { getJob, updateJobStatus } from "@/lib/research-jobs";
import { batchScoreKeywords } from "@/lib/rule-engine";
import { saveKeywordHistory, getFilterCache, setFilterCache } from "@/lib/history";
import { getSerpConfidence, setSerpConfidence } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getGameKeywords = async () => {
  try {
    const { rows } = await d1Query<{
      keyword: string;
      source_site: string;
      trend_ratio: number;
      trend_slope: number;
      trend_verdict: string;
      trend_checked_at: string;
    }>(
      `SELECT keyword, source_site, trend_ratio, trend_slope, trend_verdict, trend_checked_at
       FROM game_keyword_pipeline
       WHERE status = 'worth_doing'
       ORDER BY trend_ratio DESC
       LIMIT 20`
    );
    if (!rows.length) return undefined;
    return rows.map((r) => ({
      keyword: r.keyword,
      source: r.source_site,
      ratio: Number(r.trend_ratio),
      slope: Number(r.trend_slope),
      verdict: r.trend_verdict,
      checkedAt: r.trend_checked_at,
      isGame: true as const,
    }));
  } catch {
    return undefined;
  }
};

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
            score: Number(item.score ?? 0),
            confidence: item.confidence ?? undefined,
          }));

        const filteredOut = (payload.candidates ?? [])
          .filter((item) => item.filtered)
          .map((item) => ({
            keyword: item.keyword,
            value: Number(item.value ?? 0),
            type: normalizeCandidateType(item.type),
            source: item.source ?? "",
            score: Number(item.score ?? 0),
            confidence: item.confidence ?? undefined,
          }));

        const organized = organizeCandidates(unfiltered);

        // Include game keywords (worth_doing + low SERP competition)
        const gameKws = await getGameKeywords();

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
          gameKeywords: gameKws,
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
          // DataForSEO postback format: { tasks: [{ result: [...] }] }
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
                  const kw = qi?.query ?? "";
                  if (kw) candidates.push({ keyword: kw, value: Number(qi?.value ?? 0), type: String(qi?.type ?? "").toLowerCase().includes("rising") ? "rising" as const : "top" as const, source: sourceKeyword });
                }
              } else if (data && typeof data === "object") {
                for (const qi of data.top ?? []) {
                  const kw = qi?.query ?? "";
                  if (kw) candidates.push({ keyword: kw, value: Number(qi?.value ?? 0), type: "top" as const, source: sourceKeyword });
                }
                for (const qi of data.rising ?? []) {
                  const kw = qi?.query ?? "";
                  if (kw) candidates.push({ keyword: kw, value: Number(qi?.value ?? 0), type: "rising" as const, source: sourceKeyword });
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

      // === Optimization 1: Rule engine pre-filter ===
      // Remove obvious junk before expensive LLM call
      const ruleResult = batchScoreKeywords(candidates.map(c => c.keyword));
      const ruleBlockedSet = new Set(ruleResult.blocked.map(k => k.toLowerCase()));
      const ruleKeptMap = new Map(ruleResult.kept.map(k => [k.keyword.toLowerCase(), k.score]));
      candidates = candidates.filter(c => !ruleBlockedSet.has(c.keyword.toLowerCase()));

      // Sort by rule score (descending) — trend acceleration proxy
      candidates.sort((a, b) => {
        const sa = Number(ruleKeptMap.get(a.keyword.toLowerCase())) || 0;
        const sb = Number(ruleKeptMap.get(b.keyword.toLowerCase())) || 0;
        return sb - sa;
      });

      let filteredCandidates = candidates;
      let filterSummary = undefined;
      let filteredOut: ExpandResponse["filteredOut"] = undefined;

      if (useFilter && filterConfig) {
        stage = "filter";

        // === Optimization 2: AI filter cache ===
        // Same keyword set = same filter result (skip LLM)
        const sortedKw = [...new Set(candidates.map(c => c.keyword))].sort();
        const filterCacheKey = `filter:v1:${sortedKw.join(",")}:${filterConfig.model}:${(filterConfig.terms ?? []).sort().join(",")}:${filterConfig.prompt ?? ""}`;
        const cachedFilter = await getFilterCache(filterCacheKey);

        if (cachedFilter) {
          stage = "filter-cache-hit";
          const blockedSet = new Set(cachedFilter.blockedKeywords.map(k => k.toLowerCase()));
          filteredCandidates = candidates.filter(c => !blockedSet.has(c.keyword.toLowerCase()));
          filteredOut = candidates.filter(c => blockedSet.has(c.keyword.toLowerCase()));
          filterSummary = (cachedFilter.summary as FilterSummary) ?? {
            enabled: true,
            model: cachedFilter.model,
            total: candidates.length,
            removed: filteredOut.length,
            kept: filteredCandidates.length,
            fromCache: true,
          };
        } else {
          // === Optimization 3: Improved AI prompt (sustainability focus) ===
          const improvedConfig: FilterConfig = {
            ...filterConfig,
            prompt: filterConfig.prompt || undefined, // keep user's custom prompt if set
          };
          // The prompt improvement is in keyword-research.ts baseSystemPrompt (updated below)

          const { filtered, blocked, summary } = await filterCandidatesWithModel(
            candidates,
            improvedConfig,
            { debug }
          );
          filteredCandidates = filtered;
          filterSummary = summary;
          filteredOut = blocked;

          // Cache the filter result
          try {
            await setFilterCache({
              cacheKey: filterCacheKey,
              blockedKeywords: (blocked ?? []).map(c => c.keyword),
              keptKeywords: filtered.map(c => c.keyword),
              summary: summary as Record<string, unknown> | undefined,
              model: filterConfig.model,
            });
          } catch (e) {
            // Cache write failure shouldn't break the flow
            console.warn("[filter-cache] write failed", e);
          }
        }
      }

      // === Optimization 4: Save keyword history ===
      try {
        await saveKeywordHistory(candidates); // all candidates (before filter) for trend tracking
      } catch (e) {
        console.warn("[history] save failed", e);
      }

      // === Enrich candidates with trends comparison (top 10 vs benchmark) ===
      let trendsMap: Record<string, { ratio: number; ratioMean: number; ratioRecent: number; slopeRatio?: number; volatility: number; verdict: string; }> = {};
      console.log("[trends] step starting, candidates:", candidates.length);
      try {
        const trendCandidates = candidates
          .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
          .slice(0, 10)
          .map((c) => c.keyword);

        console.log("[trends] trendCandidates:", trendCandidates.length, trendCandidates.slice(0, 3));

        if (trendCandidates.length > 0) {
          const benchmark = resolveBenchmark();
          const { dateFrom: compFrom, dateTo: compTo } = resolveComparisonDateRange();
          const compareTaskIds = await submitComparisonTasks(trendCandidates, compFrom, compTo, benchmark);

          console.log("[trends] submitComparisonTasks returned:", compareTaskIds.length);
          if (compareTaskIds.length > 0) {
            console.log("[trends] waitForTasks starting...");
            const completedIds = await waitForTasks(compareTaskIds);
            console.log("[trends] waitForTasks completed:", completedIds.length);
            if (completedIds.length > 0) {
              console.log("[trends] getComparisonResults starting...");
              const compResults = await getComparisonResults(completedIds, benchmark);
              console.log("[trends] getComparisonResults returned:", compResults.length);
              for (const r of compResults) {
                trendsMap[r.keyword.toLowerCase()] = {
                  ratio: r.ratio,
                  ratioMean: r.ratioMean,
                  ratioRecent: r.ratioRecent,
                  slopeRatio: r.slopeRatio,
                  volatility: r.volatility,
                  verdict: r.verdict,
                };
              }
            }
          }
        }
        log("trends done", { keywords: Object.keys(trendsMap).length });
      } catch (trendErr) {
        // Non-blocking: trends failure should not break whole pipeline
        const trendMsg = trendErr instanceof Error ? trendErr.message : String(trendErr);
        log("trends failed (non-blocking)", { error: trendMsg });
      }

      // === Enrich candidates with score and isNew flag ===
      const today = new Date().toISOString().slice(0, 10);
      const seenDates = new Map<string, Set<string>>();
      for (const c of candidates) {
        const norm = c.keyword.toLowerCase().trim();
        if (!seenDates.has(norm)) seenDates.set(norm, new Set());
      }
      // Batch query first-seen dates for all candidates
      if (candidates.length > 0) {
        const norms = [...new Set(candidates.map(c => c.keyword.toLowerCase().trim()))];
 const placeholders = norms.map(() => "?").join(",");
        const { rows: historyRows } = await d1Query<{ keyword_normalized: string; first_seen: string }>(
          `SELECT keyword_normalized, MIN(date) as first_seen FROM keyword_history WHERE keyword_normalized IN (${placeholders}) GROUP BY keyword_normalized`,
          norms
        );
        for (const hr of historyRows) {
          if (seenDates.has(hr.keyword_normalized)) {
            seenDates.get(hr.keyword_normalized)!.add(hr.first_seen);
          }
        }
      }

      let enrichedCandidates: Candidate[] = filteredCandidates.map(c => {
        const norm = c.keyword.toLowerCase().trim();
        const dates = seenDates.get(norm);
        const firstSeen = dates?.size ? [...dates].sort()[0] : null;
        const isNew = firstSeen === today;
        const score = Number(ruleKeptMap.get(norm)) || 0;
        const trends = trendsMap[norm];
        return { ...c, isNew, score, trends };
      });

      // === Optimization 5: Cross-validation (expand × SERP) with per-day cache ===
      const crossValidateTopN = 20;
      const topCandidates = enrichedCandidates.slice(0, crossValidateTopN);
      const keywordsToValidate = topCandidates.map(c => c.keyword);

      if (keywordsToValidate.length > 0) {
        try {
          stage = "cross-validate";

          // Check cache first — same keyword same day = skip SERP API call
          const cachedConfidence = await getSerpConfidence(keywordsToValidate);
          const uncachedKeywords = keywordsToValidate.filter(
            kw => !cachedConfidence.has(kw.toLowerCase().trim())
          );

          // Compute confidence from SERP only for uncached keywords
          const newEntries: Array<{ keyword: string; confidence: number; organicCount: number; hasFeatured: boolean; aiInTitles: number }> = [];

          if (uncachedKeywords.length > 0) {
            const serpTaskIds = await submitSerpTasks(uncachedKeywords);
            const completedIds = await waitForSerpTasks(serpTaskIds);
            const serpResults = await getSerpResults(completedIds);

            for (const kw of uncachedKeywords) {
              const serpData = serpResults.get(kw.toLowerCase());
              let confidence = 10;
              let organicCount = 0;
              let hasFeatured = false;
              let aiInTitles = 0;

              if (serpData) {
                organicCount = serpData.topResults?.length ?? 0;
                hasFeatured = (serpData.itemTypes ?? []).some((t: string) =>
                  t.includes("featured_snippet") || t.includes("knowledge_graph")
                );
                confidence = 50;
                if (organicCount >= 5) confidence += 25;
                else if (organicCount >= 2) confidence += 15;
                if (hasFeatured) confidence += 15;
                aiInTitles = (serpData.topResults ?? []).filter((r: { title?: string }) =>
                  /\b(ai|tool|generator|builder|free|online|app)\b/i.test(r.title ?? "")
                ).length;
                confidence += Math.min(aiInTitles * 5, 15);
                confidence = Math.min(confidence, 100);
              }
              newEntries.push({ keyword: kw, confidence, organicCount, hasFeatured, aiInTitles });
            }

            // Cache new results for today
            try { await setSerpConfidence(newEntries); } catch (e) { console.warn("[cross-validate] cache write failed", e); }
          }

          // Merge cached + new confidence into candidates
          const allConfidence = new Map(cachedConfidence);
          for (const e of newEntries) {
            allConfidence.set(e.keyword.toLowerCase().trim(), e.confidence);
          }
          for (const c of topCandidates) {
            const conf = allConfidence.get(c.keyword.toLowerCase().trim());
            if (conf !== undefined) {
              const idx = enrichedCandidates.findIndex(ec => ec.keyword.toLowerCase() === c.keyword.toLowerCase());
              if (idx >= 0) enrichedCandidates[idx] = { ...enrichedCandidates[idx], confidence: conf };
            }
          }
        } catch (e) {
          console.warn("[cross-validate] failed, skipping", e);
        }
      }

      // D1 cache already populated by webhook (postback_results + query_cache)
      // Filesystem cache not supported on CF Workers (fs.mkdir unsupported)

      const sessionId = randomUUID();
      const now = new Date().toISOString();

      const candidateRows = [
        ...enrichedCandidates.map((candidate) => [
          randomUUID(),
          sessionId,
          user.id,
          candidate.keyword,
          candidate.value ?? null,
          candidate.type,
          candidate.source,
          0,
          candidate.score ?? 0,
          candidate.confidence ?? null,
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
          candidate.score ?? 0,
          candidate.confidence ?? null,
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
              "score",
              "confidence",
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

      const organized = organizeCandidates(enrichedCandidates);
      const gameKws = await getGameKeywords();
      const response: ExpandResponse = {
        keywords,
        dateFrom: dateFrom ?? "",
        dateTo: dateTo ?? "",
        candidates: enrichedCandidates,
        organized,
        flatList: flattenOrganizedCandidates(organized),
        fromCache: false,
        filter: filterSummary,
        filteredOut,
        sessionId,
        ruleStats: {
          blocked: ruleBlockedSet.size,
          kept: ruleKeptMap.size,
        },
        gameKeywords: gameKws,
        trendsSummary: Object.keys(trendsMap).length > 0 ? {
          benchmark: resolveBenchmark(),
          totalCompared: Object.keys(trendsMap).length,
          keywords: trendsMap,
        } : undefined,
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
