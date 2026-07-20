import type { ComparisonIntent } from "@/lib/types";
import type { SerpSummary } from "./serp";
import { OPENROUTER_REQUEST_TIMEOUT_MS, SERP_LLM_RESULTS } from "./dataforseo-client";
import { createBatches } from "./keyword-utils";
import type { ChatCompletionClient } from "./providers/llm";
import { getPlatformOpenRouterClient } from "./providers/openrouter";
import {
  extractChatResponseText,
  extractJsonObject,
} from "./providers/chat-response";

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
  summaries: SerpSummary[],
  options: { llmClient?: ChatCompletionClient | null } = {},
): Promise<Map<string, ComparisonIntent>> => {
  const llmClient = options.llmClient === undefined
    ? getPlatformOpenRouterClient()
    : options.llmClient;
  if (!llmClient || summaries.length === 0) return new Map();

  const intentMap = new Map<string, ComparisonIntent>();
  const batches = createBatches(summaries, INTENT_BATCH_SIZE);
  const systemPrompt = [
    "You are a keyword intent classification assistant.",
    "Infer the user intent from SERP evidence and map it to one of the provided categories.",
    "Return JSON only.",
  ].join("\n");

  for (const batch of batches) {
    const payload: import("./providers/llm").ChatCompletionInput = {
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
      const result = await llmClient.complete(payload, {
        maxRetries: 3,
        timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
      });
      const content = extractChatResponseText(result);
      const parsed = extractJsonObject(content);
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
