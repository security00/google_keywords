import type { SerpSummary } from "../serp";
import {
  FILTER_CACHE_VERSION,
  DEFAULT_FILTER_TERMS,
} from "../dataforseo-client";
import { normalizeFilterTerms } from "../keyword-utils";
import {
  DEFAULT_OPENROUTER_MODEL,
  getPlatformOpenRouterSettings,
} from "../providers/openrouter";
import {
  extractChatResponseText,
  extractJsonObject,
} from "../providers/chat-response";

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
  model: modelOverride,
}: {
  useFilter: boolean;
  overrideTerms?: string[];
  prompt?: string;
  model?: string;
}) => {
  const terms = overrideTerms?.length
    ? normalizeFilterTerms(overrideTerms)
    : getFilterTerms();
  const cleanedPrompt =
    typeof prompt === "string" && prompt.trim() ? prompt.trim() : undefined;
  const resolvedModel =
    typeof modelOverride === "string" && modelOverride.trim()
      ? modelOverride.trim()
      : getOpenRouterConfig().model;

  if (!useFilter) {
    return {
      enabled: false,
      model: resolvedModel || DEFAULT_OPENROUTER_MODEL,
      terms,
      prompt: cleanedPrompt,
    } satisfies FilterConfig;
  }

  return {
    enabled: true,
    model: resolvedModel,
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

export const getFilterTerms = () => {
  const envTerms = process.env.OPENROUTER_FILTER_TERMS;
  if (envTerms) {
    const parsed = envTerms.split(/[,;\n]+/).map((term) => term.trim());
    const normalized = normalizeFilterTerms(parsed);
    if (normalized.length > 0) return normalized;
  }
  return DEFAULT_FILTER_TERMS;
};

export const getSerpConfig = () => {
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

export const getSerpCacheKeyPart = () => {
  const config = getSerpConfig();
  const location = config.locationCode ?? config.locationName;
  return `serp:${location}:${config.languageCode}:${config.device}:${config.os}:${config.depth}`;
};

export const getOpenRouterConfig = () => {
  const settings = getPlatformOpenRouterSettings();
  return { model: settings.model || DEFAULT_OPENROUTER_MODEL };
};

export const extractJsonBlock = extractJsonObject;
export const extractResponseText = extractChatResponseText;

const AI_HINTS = [
  "ai", "gpt", "llm", "agent", "chatbot", "prompt", "model", "rag",
  "embedding", "vector", "copilot", "assistant", "automation", "workflow",
  "sdk", "api",
];

export const isLikelyAiKeyword = (keyword: string) => {
  const lower = keyword.toLowerCase();
  return AI_HINTS.some((hint) => lower.includes(hint));
};

export const ruleBasedBlockKeyword = (keyword: string, terms: string[]) => {
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
  if (
    /\b(manager|employee|boss|worker|workplace|employer|hr)\b/.test(lower) &&
    /\b(viral|resignation|resign|resigns|resigned|resigning|response|reply|story|details|fired|layoff|quit|quitting)\b/.test(lower) &&
    !/\b(ai|tool|tools|builder|generator|creator|maker|checker|converter|analyzer|calculator|finder|scanner|detector|solver|optimizer|editor|planner|tracker|monitor|extractor|compressor|enhancer|remover|template|workflow|automation|api|sdk|plugin|extension|software|platform|app|game|games|gaming|roblox|steam|minecraft|pokemon|pokémon)\b/.test(lower)
  ) {
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

export const shouldUseSerpForKeyword = (keyword: string) => {
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

// Re-export SerpSummary type for ai-filter.ts
export type { SerpSummary };
