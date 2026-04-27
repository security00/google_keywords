import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { isAuthzError, requireCronOrAdmin } from "@/lib/authz";
import { d1Query } from "@/lib/d1";
import {
  getSerpResults,
  submitSerpTasksWithCost,
  waitForSerpTasks,
} from "@/lib/keyword-research";
import {
  completePipelineRun,
  makeCostEventKey,
  makePipelineRunKey,
  recordPipelineCostEvent,
  startPipelineRun,
  updatePipelineRun,
} from "@/lib/pipelines";
import type { SerpSummary } from "@/lib/serp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVALUATION_VERSION = "serp-v1";
const PIPELINE_NAME = "old-keyword-evaluation";
const SERP_BATCH_SIZE = 20;
const SERP_UNIT_PRICE_USD = 0.0006;
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 100;

type OldKeywordRow = {
  keyword: string;
  source_seed: string;
  volume: number;
  cpc: number;
  kd: number;
  competition: string;
  intent: string;
  toolable: number;
  score: number;
  scan_date: string;
};

type OldKeywordCandidateRow = OldKeywordRow & {
  already_evaluated: number;
};

type Evaluation = {
  realScore: number;
  baseScore: number;
  serpScore: number;
  brandSafetyScore: number;
  intentScore: number;
  contentFeasibilityScore: number;
  serpOrganic: number;
  serpAuth: number;
  serpFeatured: number;
  serpAiOverview: number;
  topDomains: string[];
  signals: Record<string, unknown>;
};

const AUTHORITY_DOMAINS = [
  "wikipedia.org",
  "youtube.com",
  "reddit.com",
  "amazon.com",
  "facebook.com",
  "twitter.com",
  "instagram.com",
  "linkedin.com",
  "apple.com",
  "microsoft.com",
  "google.com",
  "adobe.com",
  "forbes.com",
  "nytimes.com",
  "bbc.com",
  "techcrunch.com",
  "g2.com",
  "capterra.com",
  "chromewebstore.google.com",
];

const BRAND_TERMS = [
  "chatgpt",
  "openai",
  "claude",
  "gemini",
  "deepseek",
  "copilot",
  "canva",
  "adobe",
  "grammarly",
  "quillbot",
  "midjourney",
  "perplexity",
  "cursor",
  "bolt",
  "lovable",
  "replit",
  "github",
  "notion",
  "figma",
  "capcut",
  "pixelcut",
  "copyleaks",
  "scribbr",
  "synthesia",
  "topaz",
  "walter",
];

const TOOL_TERMS = [
  "generator",
  "maker",
  "builder",
  "creator",
  "converter",
  "editor",
  "detector",
  "checker",
  "solver",
  "tracker",
  "planner",
  "scraper",
  "viewer",
  "writer",
  "translator",
  "transcriber",
  "summarizer",
  "optimizer",
  "uploader",
  "downloader",
  "enhancer",
  "upscaler",
  "processor",
  "compiler",
  "finder",
  "explorer",
  "comparator",
  "analyzer",
  "verifier",
  "restorer",
  "modifier",
  "calculator",
  "tool",
  "app",
  "software",
  "template",
];

const WEAK_INTENT_TERMS = [
  "job",
  "jobs",
  "salary",
  "class",
  "classes",
  "course",
  "courses",
  "reddit",
  "discord",
  "youtube",
];

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const round1 = (value: number) => Math.round(value * 10) / 10;

const normalizeKeyword = (value: string) =>
  value.toLowerCase().trim().replace(/\s+/g, " ");

const chunk = <T,>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const containsAny = (value: string, terms: string[]) =>
  terms.some((term) => value.includes(term));

const domainIsAuthority = (domain: string) =>
  AUTHORITY_DOMAINS.some((authority) => domain.includes(authority));

const scoreBase = (row: OldKeywordRow) => {
  const volume = Math.max(0, Number(row.volume || 0));
  const kd = clamp(Number(row.kd || 0));
  const cpc = Math.max(0, Number(row.cpc || 0));
  const volumeScore = clamp((Math.log10(volume + 1) / 5) * 100);
  const kdScore = clamp(100 - kd);
  const cpcScore = clamp((cpc / 5) * 100);
  return round1(volumeScore * 0.45 + kdScore * 0.35 + cpcScore * 0.2);
};

const evaluateKeyword = (row: OldKeywordRow, summary: SerpSummary | null): Evaluation => {
  const keyword = normalizeKeyword(row.keyword);
  const topResults = summary?.topResults ?? [];
  const topDomains = topResults.map((result) => result.domain || "").filter(Boolean);
  const joinedSerpText = topResults
    .map((result) => `${result.title} ${result.domain || ""} ${result.description || ""}`)
    .join(" ")
    .toLowerCase();

  const authDomains = topDomains.filter(domainIsAuthority).length;
  const nicheDomains = Math.max(0, topDomains.length - authDomains);
  const hasFeaturedSnippet = Boolean(summary?.itemTypes.includes("featured_snippet"));
  const hasAiOverview = Boolean(summary?.itemTypes.includes("ai_overview"));
  const keywordBrandMatches = BRAND_TERMS.filter((term) => keyword.includes(term));
  const serpBrandMatches = BRAND_TERMS.filter((term) => joinedSerpText.includes(term));
  const brandMatches = Array.from(new Set([...keywordBrandMatches, ...serpBrandMatches]));
  const hasToolIntent = containsAny(keyword, TOOL_TERMS);
  const hasWeakIntent = containsAny(keyword, WEAK_INTENT_TERMS);
  const hasCommercialModifier = containsAny(keyword, [
    "best",
    "top",
    "review",
    "vs",
    "alternative",
    "compare",
  ]);

  const baseScore = scoreBase(row);
  const serpScore = round1(
    clamp(
      100 -
        authDomains * 12 -
        (hasFeaturedSnippet ? 10 : 0) -
        (hasAiOverview ? 15 : 0) +
        Math.min(nicheDomains * 4, 20)
    )
  );
  const brandSafetyScore = round1(
    clamp(100 - brandMatches.length * 30 - (authDomains >= 3 ? 10 : 0))
  );
  const intentScore = round1(
    hasWeakIntent
      ? 25
      : brandMatches.length > 0
        ? 35
        : hasToolIntent
          ? 85
          : hasCommercialModifier
            ? 75
            : row.intent === "commercial"
              ? 70
              : row.intent === "transactional"
                ? 65
                : 45
  );
  const contentFeasibilityScore = round1(
    hasWeakIntent
      ? 25
      : brandMatches.length > 0
        ? 35
        : hasToolIntent
          ? 85
          : authDomains >= 4
            ? 45
            : 65
  );
  const realScore = round1(
    baseScore * 0.35 +
      serpScore * 0.25 +
      brandSafetyScore * 0.15 +
      intentScore * 0.15 +
      contentFeasibilityScore * 0.1
  );

  return {
    realScore,
    baseScore,
    serpScore,
    brandSafetyScore,
    intentScore,
    contentFeasibilityScore,
    serpOrganic: summary?.itemTypeCounts.organic ?? 0,
    serpAuth: authDomains,
    serpFeatured: hasFeaturedSnippet ? 1 : 0,
    serpAiOverview: hasAiOverview ? 1 : 0,
    topDomains,
    signals: {
      evaluationVersion: EVALUATION_VERSION,
      authDomains,
      nicheDomains,
      hasFeaturedSnippet,
      hasAiOverview,
      brandMatches,
      hasToolIntent,
      hasWeakIntent,
      hasCommercialModifier,
      weights: {
        baseScore: 0.35,
        serpScore: 0.25,
        brandSafetyScore: 0.15,
        intentScore: 0.15,
        contentFeasibilityScore: 0.1,
      },
    },
  };
};

const loadCandidates = async (input: {
  scanDate?: string;
  minScore: number;
  limit: number;
  force: boolean;
}) => {
  const dateFilterSql = input.scanDate
    ? "o.scan_date = ?"
    : "o.scan_date = (SELECT MAX(scan_date) FROM old_keyword_opportunities)";
  const reliableKdSql =
    "NOT (o.kd <= 0 AND (o.volume >= 10000 OR o.competition != 'LOW'))";
  const params: Array<string | number> = input.scanDate
    ? [EVALUATION_VERSION, input.minScore, input.scanDate, input.limit]
    : [EVALUATION_VERSION, input.minScore, input.limit];

  const { rows } = await d1Query<OldKeywordCandidateRow>(
    `SELECT o.keyword, o.source_seed, o.volume, o.cpc, o.kd, o.competition,
            o.intent, o.toolable, o.score, o.scan_date,
            EXISTS (
              SELECT 1
              FROM old_keyword_evaluations e
              WHERE e.keyword_normalized = lower(trim(o.keyword))
                AND e.scan_date = o.scan_date
                AND e.evaluation_version = ?
            ) AS already_evaluated
     FROM old_keyword_opportunities o
     WHERE o.score >= ? AND ${dateFilterSql} AND ${reliableKdSql}
     ORDER BY o.score DESC
     LIMIT ?`,
    params
  );
  const topCandidateCount = rows.length;
  const candidates = input.force
    ? rows
    : rows.filter((row) => !row.already_evaluated);
  const skippedExisting = topCandidateCount - candidates.length;
  return {
    candidates: candidates.map((row) => ({
      keyword: row.keyword,
      source_seed: row.source_seed,
      volume: row.volume,
      cpc: row.cpc,
      kd: row.kd,
      competition: row.competition,
      intent: row.intent,
      toolable: row.toolable,
      score: row.score,
      scan_date: row.scan_date,
    })),
    skippedExisting,
    topCandidateCount,
  };
};

const saveEvaluation = async (
  row: OldKeywordRow,
  evaluation: Evaluation,
  costJson: Record<string, unknown> | null
) => {
  await d1Query(
    `INSERT INTO old_keyword_evaluations
       (keyword, keyword_normalized, scan_date, evaluation_version, real_score,
        base_score, serp_score, brand_safety_score, intent_score, content_feasibility_score,
        serp_organic, serp_auth, serp_featured, serp_ai_overview, top_domains_json,
        signals_json, cost_json, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(keyword_normalized, scan_date, evaluation_version) DO UPDATE SET
       keyword = excluded.keyword,
       real_score = excluded.real_score,
       base_score = excluded.base_score,
       serp_score = excluded.serp_score,
       brand_safety_score = excluded.brand_safety_score,
       intent_score = excluded.intent_score,
       content_feasibility_score = excluded.content_feasibility_score,
       serp_organic = excluded.serp_organic,
       serp_auth = excluded.serp_auth,
       serp_featured = excluded.serp_featured,
       serp_ai_overview = excluded.serp_ai_overview,
       top_domains_json = excluded.top_domains_json,
       signals_json = excluded.signals_json,
       cost_json = excluded.cost_json,
       evaluated_at = datetime('now')`,
    [
      row.keyword,
      normalizeKeyword(row.keyword),
      row.scan_date,
      EVALUATION_VERSION,
      evaluation.realScore,
      evaluation.baseScore,
      evaluation.serpScore,
      evaluation.brandSafetyScore,
      evaluation.intentScore,
      evaluation.contentFeasibilityScore,
      evaluation.serpOrganic,
      evaluation.serpAuth,
      evaluation.serpFeatured,
      evaluation.serpAiOverview,
      JSON.stringify(evaluation.topDomains),
      JSON.stringify(evaluation.signals),
      costJson ? JSON.stringify(costJson) : null,
    ]
  );
};

export async function POST(request: Request) {
  const principal = await requireCronOrAdmin(request);
  if (isAuthzError(principal)) return principal;

  const startedAt = Date.now();
  let runId: string | null = null;

  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.floor(Number(body?.limit || DEFAULT_LIMIT)))
    );
    const minScore = Math.max(0, Math.floor(Number(body?.minScore || 0)));
    const scanDate =
      typeof body?.scanDate === "string" && body.scanDate.trim()
        ? body.scanDate.trim()
        : undefined;
    const force = body?.force === true;
    const { candidates, skippedExisting, topCandidateCount } = await loadCandidates({
      scanDate,
      minScore,
      limit,
      force,
    });

    if (candidates.length === 0) {
      return NextResponse.json({
        evaluated: 0,
        skippedExisting,
        topCandidateCount,
        force,
        message:
          skippedExisting > 0 && !force
            ? "Top keywords already have real scores. Use force=true to rerun paid SERP evaluation."
            : "No eligible old keywords",
      });
    }

    runId = randomUUID();
    const effectiveScanDate = candidates[0].scan_date;
    const estimatedCostUsd = Number((candidates.length * SERP_UNIT_PRICE_USD).toFixed(6));

    await startPipelineRun({
      runId,
      runKey: makePipelineRunKey(PIPELINE_NAME, effectiveScanDate, {
        evaluationVersion: EVALUATION_VERSION,
        limit,
        minScore,
        requestedScanDate: scanDate ?? null,
        runId,
      }),
      pipeline: PIPELINE_NAME,
      budgetUsd: estimatedCostUsd,
      metadata: {
        source: "admin.old-keywords.evaluate",
        evaluationVersion: EVALUATION_VERSION,
        requestedScanDate: scanDate ?? null,
        scanDate: effectiveScanDate,
        limit,
        minScore,
        force,
        skippedExisting,
        topCandidateCount,
        candidateCount: candidates.length,
      },
    });

    let evaluated = 0;
    let missingSerp = 0;
    let actualCostUsd = 0;

    for (const [batchIndex, batch] of chunk(candidates, SERP_BATCH_SIZE).entries()) {
      const keywords = batch.map((item) => item.keyword);
      const submission = await submitSerpTasksWithCost(keywords);
      const batchActualCostUsd = Number(
        submission.cost.actualCostUsd || submission.cost.estimatedCostUsd || 0
      );
      actualCostUsd += batchActualCostUsd;

      const providerRequestId = submission.taskIds.join(",");
      const idempotencyKey = `old-keyword-evaluation:${runId}:batch:${batchIndex}`;
      await recordPipelineCostEvent({
        runId,
        pipeline: PIPELINE_NAME,
        provider: "dataforseo",
        endpoint: "serp_organic",
        unitType: "task",
        unitCount: submission.taskIds.length || keywords.length,
        unitPriceUsd: SERP_UNIT_PRICE_USD,
        actualCostUsd: submission.cost.actualCostUsd ?? null,
        idempotencyKey,
        providerRequestId: providerRequestId || null,
        eventKey: makeCostEventKey({
          provider: "dataforseo",
          endpoint: "serp_organic",
          providerRequestId: providerRequestId || null,
          idempotencyKey,
          payload: { runId, batchIndex, keywords },
        }),
        metadata: {
          batchIndex,
          keywords,
          taskIds: submission.taskIds,
          cost: submission.cost,
        },
      });

      const completed = await waitForSerpTasks(submission.taskIds);
      const summaries = await getSerpResults(completed);
      const summariesByKeyword = new Map(
        Array.from(summaries.entries()).map(([keyword, summary]) => [
          normalizeKeyword(keyword),
          summary,
        ])
      );

      for (const row of batch) {
        const summary = summariesByKeyword.get(normalizeKeyword(row.keyword)) ?? null;
        if (!summary) missingSerp++;
        await saveEvaluation(row, evaluateKeyword(row, summary), {
          batchIndex,
          cost: submission.cost,
          taskIds: submission.taskIds,
          pipelineRunId: runId,
        });
        evaluated++;
      }
    }

    const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
    const roundedActualCostUsd = Number(actualCostUsd.toFixed(6));
    const completionStatus = missingSerp > 0 ? "success_with_warnings" : "success";
    const completionMetadata = {
      source: "admin.old-keywords.evaluate",
      evaluationVersion: EVALUATION_VERSION,
      requestedScanDate: scanDate ?? null,
      scanDate: effectiveScanDate,
      limit,
      minScore,
      force,
      skippedExisting,
      topCandidateCount,
      candidateCount: candidates.length,
      evaluated,
      missingSerp,
      actualCostUsd: roundedActualCostUsd,
    };

    await updatePipelineRun(runId, {
      checkedCount: candidates.length,
      savedCount: evaluated,
      estimatedCostUsd,
      metadata: completionMetadata,
    });
    await completePipelineRun(runId, {
      status: completionStatus,
      durationSeconds,
      metadata: completionMetadata,
    });

    return NextResponse.json({
      evaluated,
      missingSerp,
      actualCostUsd: roundedActualCostUsd,
      estimatedCostUsd,
      skippedExisting,
      topCandidateCount,
      force,
      scanDate: effectiveScanDate,
      evaluationVersion: EVALUATION_VERSION,
      pipelineRunId: runId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (runId) {
      await completePipelineRun(runId, {
        status: "failed",
        durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
        error: message,
      }).catch((completionError) => {
        console.error(
          "[admin/old-keywords/evaluate] failed to mark pipeline run failed",
          completionError
        );
      });
    }
    return NextResponse.json(
      { error: message, ...(runId ? { pipelineRunId: runId } : {}) },
      { status: 500 }
    );
  }
}
