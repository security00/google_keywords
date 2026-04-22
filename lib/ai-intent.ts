import type { ComparisonIntent } from "@/lib/types";
import type { SerpSummary } from "./serp";
import {
  OPENROUTER_REQUEST_TIMEOUT_MS,
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
  SERP_LLM_RESULTS,
  requestWithRetry,
} from "./dataforseo-client";
import { createBatches } from "./keyword-utils";

const INTENT_CATEGORIES = [
  "AI Tools",
  "AI News",
  "Games",
  "Game Info",
  "Utility Tools",
  "Commerce / Services",
  "Other",
];
const INTENT_BATCH_SIZE = 6;

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

const normalizeIntentLabel = (label: string) => {
  const cleaned = label.trim();
  if (!cleaned) return "Other";
  const matched = INTENT_CATEGORIES.find(
    (item) => item === cleaned || cleaned.includes(item)
  );
  return matched ?? "Other";
};

const buildIntentPayload = (summaries: SerpSummary[]) => ({
  categories: INTENT_CATEGORIES,
  keywords: summaries.map((summary) => ({
    keyword: summary.keyword,
    item_types: summary.itemTypes,
    item_type_counts: summary.itemTypeCounts,
    top_results: summary.topResults.slice(0, SERP_LLM_RESULTS),
  })),
  output:
    'Return strict JSON: { "intents": [ { "keyword": "", "label": "", "demand": "", "reason": "", "confidence": 0.0 } ] }',
  rules: [
    "label must be one of the values in categories",
    "demand must be a single concise sentence describing the user intent",
    "reason must briefly cite the SERP evidence",
    "confidence must be a number between 0 and 1 and may be omitted",
    "Return JSON only with no extra explanation",
  ],
});

export const inferIntentWithModel = async (
  summaries: SerpSummary[]
): Promise<Map<string, ComparisonIntent>> => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || summaries.length === 0) return new Map();

  const { baseUrl, model } = getOpenRouterConfig();
  const intentMap = new Map<string, ComparisonIntent>();
  const batches = createBatches(summaries, INTENT_BATCH_SIZE);
  const systemPrompt = [
    "You are a keyword intent classification assistant.",
    "Infer the user intent from SERP evidence and map it to one of the provided categories.",
    "Return JSON only.",
  ].join("\n");

  for (const batch of batches) {
    const payload = {
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: JSON.stringify(buildIntentPayload(batch), null, 2),
        },
      ],
    };

    try {
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
      const content = extractResponseText(result);
      const parsed = extractJsonBlock(content);
      const intents = Array.isArray(parsed?.intents) ? parsed.intents : [];
      for (const item of intents) {
        const keyword = typeof item?.keyword === "string" ? item.keyword.trim() : "";
        if (!keyword) continue;
        const label = normalizeIntentLabel(
          typeof item?.label === "string" ? item.label : ""
        );
        const demand =
          typeof item?.demand === "string" && item.demand.trim()
            ? item.demand.trim()
            : "用户需求未明确";
        const reason =
          typeof item?.reason === "string" && item.reason.trim()
            ? item.reason.trim()
            : "SERP 证据不足";
        const confidence =
          typeof item?.confidence === "number" ? item.confidence : undefined;
        intentMap.set(keyword.toLowerCase(), {
          label,
          demand,
          reason,
          confidence,
        });
      }
    } catch (error) {
      console.warn("OpenRouter intent batch failed", error);
    }
  }

  return intentMap;
};
