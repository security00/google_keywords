import type { Candidate, FilterSummary } from "@/lib/types";
import {
  OPENROUTER_REQUEST_TIMEOUT_MS,
  OPENROUTER_BATCH_SIZE,
  SERP_LLM_RESULTS,
  requestWithRetry,
} from "../dataforseo-client";
import { createBatches } from "../keyword-utils";
import { submitSerpTasks, waitForSerpTasks, getSerpResults } from "../serp";
import {
  type FilterConfig,
  type SerpSummary,
  getOpenRouterConfig,
  buildOpenRouterHeaders,
  extractJsonBlock,
  extractResponseText,
  ruleBasedBlockKeyword,
  shouldUseSerpForKeyword,
} from "./expand-helpers";

export const filterCandidatesWithModel = async (
  candidates: Candidate[],
  config: FilterConfig,
  options: {
    debug?: boolean;
  } = {}
) => {
  const log = (message: string, meta?: Record<string, unknown>) => {
    if (!options.debug) return;
    if (meta) {
      console.log(message, meta);
    } else {
      console.log(message);
    }
  };
  const sampleList = (items: string[], size = 8) => items.slice(0, size);
  const snippet = (text: string, size = 200) =>
    text.length > size ? `${text.slice(0, size)}...` : text;

  const summary: FilterSummary = {
    enabled: config.enabled,
    model: config.enabled ? config.model : undefined,
    total: candidates.length,
    removed: 0,
    kept: candidates.length,
  };

  if (!config.enabled) {
    log("[filter] skipped", { reason: "disabled" });
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    summary.skippedReason = "OPENROUTER_API_KEY is not configured";
    log("[filter] skipped", { reason: "missing_api_key" });
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  const uniqueKeywords = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidate.keyword.toLowerCase();
    if (!uniqueKeywords.has(key)) {
      uniqueKeywords.set(key, candidate);
    }
  }

  const keywords = Array.from(uniqueKeywords.values()).map(
    (candidate) => candidate.keyword
  );
  const normalizedTerms = config.terms.map((term) => term.toLowerCase());
  const preBlocked = new Set<string>();
  const serpKeywords: string[] = [];
  const keepDirect: string[] = [];
  const filterStartedAt = Date.now();

  for (const keyword of keywords) {
    if (ruleBasedBlockKeyword(keyword, normalizedTerms)) {
      preBlocked.add(keyword.toLowerCase());
      continue;
    }
    if (shouldUseSerpForKeyword(keyword)) {
      serpKeywords.push(keyword);
    } else {
      keepDirect.push(keyword);
    }
  }

  log("[filter] start", {
    total: keywords.length,
    preBlocked: preBlocked.size,
    serp: serpKeywords.length,
    keepDirect: keepDirect.length,
    model: config.model,
    serpSample: sampleList(serpKeywords),
    keepSample: sampleList(keepDirect),
    filterTermsCount: config.terms.length,
    filterTermsSample: sampleList(config.terms),
  });

  const blocked = new Set<string>(preBlocked);

  const { baseUrl, model } = getOpenRouterConfig();
  const baseSystemPrompt = [
    "You are a keyword filtering assistant for discovering NEW, EMERGING keywords with commercial potential.",
    "Your primary job is to distinguish between SUSTAINED DEMAND (keep) and SHORT-TERM HYPE (block).",
    "",
    "KEEP keywords that suggest:",
    "1) Tool/utility intent: builder, generator, converter, checker, analyzer, calculator, finder, remover, enhancer",
    "2) AI/automation intent: ai, gpt, copilot, agent, chatbot, automation, machine learning",
    "3) Software/SaaS intent: app, platform, extension, plugin, template, workflow, dashboard",
    "4) Informational search intent with commercial potential (not just curiosity)",
    "",
    "BLOCK keywords that suggest:",
    "1) ONE-TIME EVENTS: game launches, movie releases, album drops, celebrity news, seasonal trends",
    "   → Clues: specific game/movie/show names, release dates, patch notes, episode titles",
    "2) BRANDS & PRODUCTS: specific company names, product SKUs, retail brands",
    "3) ENTERTAINMENT: anime, manga, novels, TV shows, celebrities (unless AI-related)",
    "4) NEWS & EVENTS: crime, politics, weather, sports scores, awards",
    "5) GENERIC QUERIES: 'how to', 'what is', definitions, translations, spellings",
    "6) AUTH PAGES: login, sign up, register, portal, account",
    "7) PLACES & GEO: cities, countries, landmarks, airports, festivals",
    "",
    "KEY DISTINCTION:",
    "- 'ai character creator' → KEEP (tool intent, sustained demand)",
    "- 'palworld update 1.2' → BLOCK (one-time game event)",
    "- 'free ai headshot generator' → KEEP (tool + commercial)",
    "- 'spider man 4 trailer' → BLOCK (entertainment event)",
    "- 'ai video enhancer' → KEEP (tool + AI trend)",
    "- 'pokemon legends z-a release date' → BLOCK (game launch hype)",
    "",
    "When uncertain, lean toward KEEPING AI/tool-related keywords.",
  ].join("\n");

  const runOpenRouterBatches = async (summaries: SerpSummary[]) => {
    const batches = createBatches(summaries, OPENROUTER_BATCH_SIZE);
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const batchStartedAt = Date.now();
      log("[filter] openrouter batch start", {
        batch: index + 1,
        totalBatches: batches.length,
        size: batch.length,
        sample: sampleList(batch.map((item) => item.keyword)),
      });

      const payload = {
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: config.prompt
              ? `${baseSystemPrompt}\nAdditional instruction: ${config.prompt}`
              : baseSystemPrompt,
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                blacklist_topics: config.terms,
                keywords: batch.map((item) => ({
                  keyword: item.keyword,
                  item_types: item.itemTypes,
                  item_type_counts: item.itemTypeCounts,
                  top_results: item.topResults.slice(0, SERP_LLM_RESULTS),
                })),
                output: 'Return strict JSON: { "blocked": ["keyword"] }',
                rules: [
                  "blocked may only contain keywords from the provided input and must preserve original spelling",
                  "Judge by semantic meaning rather than exact word matching",
                  "Do not output explanations or extra fields",
                  "If nothing should be blocked, return an empty blocked array",
                ],
              },
              null,
              2
            ),
          },
        ],
        max_tokens: 800,
      };

      try {
        const beforeBlocked = blocked.size;
        const result = await requestWithRetry(
          "post",
          `${baseUrl}/chat/completions`,
          {
            headers: buildOpenRouterHeaders(),
            body: JSON.stringify(payload),
          },
          3,
          OPENROUTER_REQUEST_TIMEOUT_MS
        );

        const content =
          result?.choices?.[0]?.message?.content ??
          result?.choices?.[0]?.text ??
          "";
        const parsed = extractJsonBlock(content);
        if (!parsed) {
          log("[filter] openrouter parse failed", {
            batch: index + 1,
            totalBatches: batches.length,
            size: batch.length,
            content: snippet(content),
          });
        }

        const blockedList = Array.isArray(parsed?.blocked) ? parsed.blocked : [];
        const newlyBlocked: string[] = [];
        for (const item of blockedList) {
          if (typeof item === "string") {
            const lowered = item.toLowerCase();
            if (!blocked.has(lowered)) {
              newlyBlocked.push(item);
            }
            blocked.add(lowered);
          }
        }

        log("[filter] openrouter batch done", {
          batch: index + 1,
          totalBatches: batches.length,
          size: batch.length,
          blocked: blocked.size - beforeBlocked,
          newlyBlockedSample: sampleList(newlyBlocked),
          tookMs: Date.now() - batchStartedAt,
        });
      } catch (error) {
        console.warn("OpenRouter filter batch failed", error);
        log("[filter] openrouter batch error", {
          batch: index + 1,
          totalBatches: batches.length,
          size: batch.length,
          tookMs: Date.now() - batchStartedAt,
        });
      }
    }
  };

  if (serpKeywords.length > 0) {
    log("[filter] serp start", {
      keywords: serpKeywords.length,
      sample: sampleList(serpKeywords),
    });
    try {
      const taskIds = await submitSerpTasks(serpKeywords);
      log("[filter] serp tasks submitted", { taskCount: taskIds.length });
      const completed = await waitForSerpTasks(taskIds);
      log("[filter] serp tasks ready", { readyCount: completed.length });
      const summaries = await getSerpResults(completed);
      log("[filter] serp results", { summaries: summaries.size });

      const summariesForModel: SerpSummary[] = [];
      for (const keyword of serpKeywords) {
        const summary = summaries.get(keyword.toLowerCase());
        if (!summary) {
          blocked.add(keyword.toLowerCase());
          log("[filter] serp missing", { keyword });
          continue;
        }
        summariesForModel.push(summary);
      }

      if (summariesForModel.length > 0) {
        await runOpenRouterBatches(summariesForModel);
      }
    } catch (error) {
      console.warn("SERP filter failed", error);
      log("[filter] serp error", { message: (error as Error).message });
    }
  }

  if (blocked.size === 0) {
    summary.kept = candidates.length;
    log("[filter] done", {
      removed: summary.removed,
      kept: summary.kept,
      blocked: blocked.size,
      tookMs: Date.now() - filterStartedAt,
    });
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  const filtered = candidates.filter(
    (candidate) => !blocked.has(candidate.keyword.toLowerCase())
  );
  const blockedCandidates = candidates.filter((candidate) =>
    blocked.has(candidate.keyword.toLowerCase())
  );

  summary.removed = candidates.length - filtered.length;
  summary.kept = filtered.length;
  log("[filter] done", {
    removed: summary.removed,
    kept: summary.kept,
    blocked: blocked.size,
    tookMs: Date.now() - filterStartedAt,
  });
  return { filtered, blocked: blockedCandidates, summary };
};

export const filterCandidatesWithKeywordModel = async (
  candidates: Candidate[],
  config: FilterConfig,
  options: {
    debug?: boolean;
    batchSize?: number;
    maxCandidates?: number;
  } = {}
) => {
  const log = (message: string, meta?: Record<string, unknown>) => {
    if (!options.debug) return;
    if (meta) {
      console.log(message, meta);
    } else {
      console.log(message);
    }
  };

  const summary: FilterSummary = {
    enabled: config.enabled,
    model: config.enabled ? config.model : undefined,
    total: candidates.length,
    removed: 0,
    kept: candidates.length,
  };

  if (!config.enabled) {
    summary.skippedReason = "disabled";
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  if (!process.env.OPENROUTER_API_KEY) {
    summary.skippedReason = "OPENROUTER_API_KEY is not configured";
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  const uniqueCandidates = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidate.keyword.toLowerCase().trim();
    if (key && !uniqueCandidates.has(key)) uniqueCandidates.set(key, candidate);
  }

  const maxCandidates = Math.min(
    Math.max(Number(options.maxCandidates ?? process.env.OPENROUTER_PRECOMPUTE_FILTER_MAX ?? 900), 50),
    uniqueCandidates.size
  );
  const batchSize = Math.min(Math.max(Number(options.batchSize ?? 80), 10), 120);
  const candidatesForModel = Array.from(uniqueCandidates.values()).slice(0, maxCandidates);
  const batches = createBatches(candidatesForModel, batchSize);
  const blocked = new Set<string>();
  const { baseUrl, model } = getOpenRouterConfig();
  const startedAt = Date.now();

  const systemPrompt = [
    "You are filtering keyword research candidates before they are shown to a human operator.",
    "Keep durable, productizable, commercial keywords, especially AI tools, software, utilities, SaaS, templates, workflows, and automation.",
    "Block short-lived noise, entertainment/news/sports/games/politics/celebrity/exam answers/coupons/gambling/adult/domain spam/local navigation queries.",
    "Block exact brands or one-off entities unless the query clearly describes a reusable software/tool opportunity.",
    "When uncertain, keep AI/tool/SaaS intent and block pure news/event curiosity.",
    "Return strict JSON only.",
  ].join("\n");

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const payload = {
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: config.prompt
            ? `${systemPrompt}\nAdditional filter instruction: ${config.prompt}`
            : systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify({
            blacklist_topics: config.terms,
            keywords: batch.map((candidate) => ({
              keyword: candidate.keyword,
              trend_value: candidate.value,
              source_seed: candidate.source,
              rule_score: candidate.score ?? 0,
            })),
            output: '{ "blocked": ["keyword"] }',
            rules: [
              "blocked may only include exact keywords from the provided input",
              "preserve original spelling",
              "do not include explanations",
              "if all keywords should be kept, return {\"blocked\":[]}",
            ],
          }),
        },
      ],
      max_tokens: 1400,
    };

    try {
      const response = await requestWithRetry(
        "post",
        `${baseUrl}/chat/completions`,
        {
          headers: buildOpenRouterHeaders(),
          body: JSON.stringify(payload),
        },
        2,
        OPENROUTER_REQUEST_TIMEOUT_MS
      );
      const content = extractResponseText(response);
      const parsed = extractJsonBlock(content);
      const blockedList = Array.isArray(parsed?.blocked) ? parsed.blocked : [];
      for (const item of blockedList) {
        if (typeof item === "string") blocked.add(item.toLowerCase().trim());
      }
      log("[precompute-llm-filter] batch done", {
        batch: index + 1,
        totalBatches: batches.length,
        size: batch.length,
        blocked: blockedList.length,
      });
    } catch (error) {
      log("[precompute-llm-filter] batch failed", {
        batch: index + 1,
        totalBatches: batches.length,
        message: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  }

  if (blocked.size === 0) {
    summary.skippedReason = "model returned no blocked keywords";
    return { filtered: candidates, blocked: [] as Candidate[], summary };
  }

  const filtered = candidates.filter(
    (candidate) => !blocked.has(candidate.keyword.toLowerCase().trim())
  );
  const blockedCandidates = candidates.filter((candidate) =>
    blocked.has(candidate.keyword.toLowerCase().trim())
  );

  summary.removed = blockedCandidates.length;
  summary.kept = filtered.length;
  log("[precompute-llm-filter] done", {
    removed: summary.removed,
    kept: summary.kept,
    tookMs: Date.now() - startedAt,
  });

  return { filtered, blocked: blockedCandidates, summary };
};
