import type { Candidate, OrganizedCandidates, FilterSummary } from "@/lib/types";
import type { SerpSummary } from "./serp";
import {
  TASK_POST_URL,
  TASKS_READY_URL,
  TASK_GET_URL,
  MAX_WAIT_MS,
  POLL_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  OPENROUTER_REQUEST_TIMEOUT_MS,
  EXPANSION_TASK_POST_BATCH_SIZE,
  OPENROUTER_BATCH_SIZE,
  SERP_LLM_RESULTS,
  FILTER_CACHE_VERSION,
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_FILTER_TERMS,
  normalizeDate,
  buildPostbackUrl,
  buildAuthHeaders,
  requestWithRetry,
  sleep,
} from "./dataforseo-client";
import { createBatches, normalizeFilterTerms } from "./keyword-utils";
import { submitSerpTasks, waitForSerpTasks, getSerpResults } from "./serp";

export type FilterConfig = {
  enabled: boolean;
  model: string;
  terms: string[];
  prompt?: string;
};

export const resolveFilterConfig = ({
  useFilter,
  overrideTerms,
  prompt,
}: {
  useFilter: boolean;
  overrideTerms?: string[];
  prompt?: string;
}) => {
  const terms = overrideTerms?.length
    ? normalizeFilterTerms(overrideTerms)
    : getFilterTerms();
  const cleanedPrompt =
    typeof prompt === "string" && prompt.trim() ? prompt.trim() : undefined;

  if (!useFilter) {
    return {
      enabled: false,
      model: DEFAULT_OPENROUTER_MODEL,
      terms,
      prompt: cleanedPrompt,
    } satisfies FilterConfig;
  }

  const { model } = getOpenRouterConfig();
  return {
    enabled: true,
    model,
    terms,
    prompt: cleanedPrompt,
  } satisfies FilterConfig;
};

export const buildFilterCacheKey = (config: FilterConfig) => {
  if (!config.enabled) return "filter:off";
  const terms = config.terms.map((term) => term.toLowerCase()).sort().join("|");
  const promptKey = config.prompt ? `:prompt:${config.prompt.toLowerCase()}` : "";
  const serpKey = getSerpCacheKeyPart();
  return `filter:on:${FILTER_CACHE_VERSION}:${config.model}:${serpKey}:${terms}${promptKey}`;
};

/* ── Internal helpers ───────────────────────────────────────── */

const getFilterTerms = () => {
  const envTerms = process.env.OPENROUTER_FILTER_TERMS;
  if (envTerms) {
    const parsed = envTerms.split(/[,;\n]+/).map((term) => term.trim());
    const normalized = normalizeFilterTerms(parsed);
    if (normalized.length > 0) return normalized;
  }
  return DEFAULT_FILTER_TERMS;
};

const getSerpConfig = () => {
  const locationCodeRaw = process.env.SERP_LOCATION_CODE;
  const locationCode = locationCodeRaw ? Number(locationCodeRaw) : undefined;
  const locationName = process.env.SERP_LOCATION_NAME || "United States";
  const languageCode = process.env.SERP_LANGUAGE_CODE || "en";
  const device = process.env.SERP_DEVICE || "desktop";
  const os = process.env.SERP_OS || "windows";
  const depthRaw = process.env.SERP_DEPTH;
  const depth = depthRaw ? Number(depthRaw) : 10;

  return {
    locationCode: Number.isFinite(locationCode) ? locationCode : undefined,
    locationName,
    languageCode,
    device,
    os,
    depth: Number.isFinite(depth) && depth > 0 ? depth : 10,
  };
};

const getSerpCacheKeyPart = () => {
  const config = getSerpConfig();
  const location = config.locationCode ?? config.locationName;
  return `serp:${location}:${config.languageCode}:${config.device}:${config.os}:${config.depth}`;
};

const getOpenRouterConfig = () => {
  const baseUrl = (process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL)
    .replace(/\/+$/, "");
  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  return { baseUrl, model };
};

const buildOpenRouterHeaders = () => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY in environment variables.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const referer = process.env.OPENROUTER_SITE_URL;
  const title = process.env.OPENROUTER_APP_NAME;

  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;

  return headers satisfies HeadersInit;
};

const extractJsonBlock = (text: string) => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
};

const extractResponseText = (result: unknown) => {
  const response = result as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };

  if (typeof response?.output_text === "string" && response.output_text) {
    return response.output_text;
  }

  const output = response?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (item?.type !== "message" || !Array.isArray(item.content)) continue;
      const text = item.content.find(
        (content) => content?.type === "output_text"
      )?.text;
      if (text) return text;
    }
  }

  return (
    response?.choices?.[0]?.message?.content ??
    response?.choices?.[0]?.text ??
    ""
  );
};

const AI_HINTS = [
  "ai", "gpt", "llm", "agent", "chatbot", "prompt", "model", "rag",
  "embedding", "vector", "copilot", "assistant", "automation", "workflow",
  "sdk", "api",
];

const isLikelyAiKeyword = (keyword: string) => {
  const lower = keyword.toLowerCase();
  return AI_HINTS.some((hint) => lower.includes(hint));
};

const ruleBasedBlockKeyword = (keyword: string, terms: string[]) => {
  const text = keyword.trim();
  if (!text) return true;
  const lower = text.toLowerCase();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;

  if (wordCount >= 7 || lower.length >= 60) return true;
  if (lower.includes("?")) return true;
  if (/(含义|释义|字谜|猜字谜|meaning|definition|riddle|crossword|puzzle)/i.test(text)) return true;
  if (/(城市|国家|机场|车站|港口|景区|公园|寺庙|教堂|city|country|airport|station|port|park|temple|church)/i.test(text)) {
    return true;
  }
  if (/\b(meaning|definition|riddle|crossword|puzzle|word game|word puzzle)\b/.test(lower)) {
    return true;
  }
  if (/\b(how to|where to|what is|who is|best|top|review)\b/.test(lower)) {
    return true;
  }
  if (/\b(trailer|cast|episode|season|movie|film|tv|series|anime|manga|novel|book|author|comic)\b/.test(lower)) {
    return true;
  }
  if (/\b(news|outage|incident|killed|shot|arrest|crime|weather|forecast)\b/.test(lower)) {
    return true;
  }

  for (const term of terms) {
    const cleaned = term.trim().toLowerCase();
    if (cleaned && lower.includes(cleaned)) {
      return true;
    }
  }

  return false;
};

const shouldUseSerpForKeyword = (keyword: string) => {
  const text = keyword.trim();
  if (!text) return false;
  if (isLikelyAiKeyword(text)) return false;

  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const hasUpper = /[A-Z]/.test(text);
  const hasDigit = /\d/.test(text);

  if (hasUpper || hasDigit) return true;
  if (words.length >= 2) return true;

  const single = words[0] ?? "";
  if (single && /^[a-z]+$/.test(single) && single.length >= 3) {
    return true;
  }

  return false;
};

/* ── Exported functions ─────────────────────────────────────── */

export const submitExpansionTasks = async (
  keywords: string[],
  dateFrom: string,
  dateTo: string,
  options?: { postbackUrl?: string; cacheKey?: string }
) => {
  const postback = buildPostbackUrl(options?.postbackUrl, options?.cacheKey, "expand");
  const batches = createBatches(keywords, EXPANSION_TASK_POST_BATCH_SIZE);
  const taskIds: string[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const payload = batch.map((keyword) => ({
      keywords: [keyword],
      date_from: normalizeDate(dateFrom),
      date_to: normalizeDate(dateTo),
      type: "web",
      item_types: ["google_trends_queries_list"],
      ...(postback ? { postback_url: postback } : {}),
    }));

    const result = await requestWithRetry("post", TASK_POST_URL, {
      headers: buildAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (result?.status_code !== 20000) {
      console.error("[dataforseo/expand] task_post failed", {
        batchIndex: batchIndex + 1,
        totalBatches: batches.length,
        keywords: batch,
        statusCode: result?.status_code,
        statusMessage: result?.status_message,
        tasksCount: Array.isArray(result?.tasks) ? result.tasks.length : 0,
      });
      throw new Error(result?.status_message || "Failed to create expansion tasks");
    }

    const createdTaskIds = (result.tasks || [])
      .filter((task: { status_code: number }) => task.status_code === 20100)
      .map((task: { id: string }) => task.id);

    if (createdTaskIds.length === 0) {
      const taskDetails = (result.tasks || []).map((task: {
        status_code?: number;
        status_message?: string;
      }) => `${task.status_code ?? "unknown"}:${task.status_message ?? "unknown"}`);
      console.error("[dataforseo/expand] batch created 0 tasks", {
        batchIndex: batchIndex + 1,
        totalBatches: batches.length,
        keywords: batch,
        taskDetails,
        rawStatusCode: result?.status_code,
        rawStatusMessage: result?.status_message,
      });
      throw new Error(
        `Expansion batch ${batchIndex + 1}/${batches.length} created 0 tasks (${taskDetails.join("; ") || "no task details"})`
      );
    }

    taskIds.push(...createdTaskIds);
  }

  return taskIds;
};

export const waitForTasks = async (taskIds: string[]) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];
  const startedAt = Date.now();

  while (pending.size > 0 && Date.now() - startedAt < MAX_WAIT_MS) {
    const result = await requestWithRetry("get", TASKS_READY_URL, {
      headers: buildAuthHeaders(),
    });

    if (result?.status_code === 20000) {
      const readyTasks = result?.tasks?.[0]?.result ?? [];
      for (const task of readyTasks) {
        const id = task?.id;
        if (id && pending.has(id)) {
          pending.delete(id);
          completed.push(id);
        }
      }
    }

    if (pending.size > 0) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  return completed;
};

export const getReadyTaskIds = async (taskIds: string[]) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];

  if (pending.size === 0) return completed;

  const result = await requestWithRetry("get", TASKS_READY_URL, {
    headers: buildAuthHeaders(),
  });

  if (result?.status_code === 20000) {
    const readyTasks = result?.tasks?.[0]?.result ?? [];
    for (const task of readyTasks) {
      const id = task?.id;
      if (id && pending.has(id)) {
        completed.push(id);
      }
    }
  }

  return completed;
};

export const getExpansionResults = async (taskIds: string[]) => {
  const allCandidates: Candidate[] = [];

  for (const taskId of taskIds) {
    const result = await requestWithRetry("get", `${TASK_GET_URL}/${taskId}`, {
      headers: buildAuthHeaders(),
    });

    if (result?.status_code !== 20000) {
      continue;
    }

    for (const task of result?.tasks ?? []) {
      if (task?.status_code !== 20000) continue;

      const taskResult = task?.result?.[0];
      if (!taskResult) continue;

      const items = taskResult.items ?? [];
      const sourceKeyword = taskResult?.keywords?.[0] ?? "unknown";

      for (const item of items) {
        if (item?.type !== "google_trends_queries_list") continue;
        const data = item?.data;

        if (Array.isArray(data)) {
          for (const queryItem of data) {
            const queryText = queryItem?.query ?? "";
            const value = Number(queryItem?.value ?? 0);
            const queryType = String(queryItem?.type ?? "");
            const isRising = queryType.toLowerCase().includes("rising");

            if (queryText) {
              allCandidates.push({
                keyword: queryText,
                value,
                type: isRising ? "rising" : "top",
                source: sourceKeyword,
              });
            }
          }
        } else if (data && typeof data === "object") {
          for (const queryItem of data.top ?? []) {
            const queryText = queryItem?.query ?? "";
            const value = Number(queryItem?.value ?? 0);
            if (queryText) {
              allCandidates.push({
                keyword: queryText,
                value,
                type: "top",
                source: sourceKeyword,
              });
            }
          }

          for (const queryItem of data.rising ?? []) {
            const queryText = queryItem?.query ?? "";
            const value = Number(queryItem?.value ?? 0);
            if (queryText) {
              allCandidates.push({
                keyword: queryText,
                value,
                type: "rising",
                source: sourceKeyword,
              });
            }
          }
        }
      }
    }
  }

  return allCandidates;
};

export const organizeCandidates = (candidates: Candidate[]) => {
  const risingCandidates = candidates.filter((candidate) => candidate.type === "rising");
  const seen = new Map<string, Candidate>();

  for (const candidate of risingCandidates) {
    const key = candidate.keyword.toLowerCase();
    const existing = seen.get(key);
    if (!existing || candidate.value > existing.value) {
      seen.set(key, candidate);
    }
  }

  const uniqueCandidates = Array.from(seen.values());
  const sortedCandidates = uniqueCandidates.sort((a, b) => {
    const scoreDiff = Number(b.score ?? 0) - Number(a.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return b.value - a.value;
  });

  const organized: OrganizedCandidates = {
    explosive: [],
    fastRising: [],
    steadyRising: [],
    slowRising: [],
  };

  for (const candidate of sortedCandidates) {
    if (candidate.value > 500) {
      organized.explosive.push(candidate);
    } else if (candidate.value > 200) {
      organized.fastRising.push(candidate);
    } else if (candidate.value > 100) {
      organized.steadyRising.push(candidate);
    } else {
      organized.slowRising.push(candidate);
    }
  }

  return organized;
};

export const flattenOrganizedCandidates = (organized: OrganizedCandidates) => [
  ...organized.explosive,
  ...organized.fastRising,
  ...organized.steadyRising,
  ...organized.slowRising,
];

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
