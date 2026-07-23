import {
  createJsonHttpTransport,
  type JsonHttpTransport,
} from "./json-http";
import type { ChatCompletionClient } from "./llm";

export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.2";

export type OpenRouterCredentials = {
  apiKey: string;
};

export type OpenRouterClientOptions = {
  model?: string;
  referer?: string;
  appName?: string;
  transport?: JsonHttpTransport;
};

const createOpenRouterClientWithBaseUrl = (
  credentials: OpenRouterCredentials,
  options: OpenRouterClientOptions & { baseUrl: string },
): ChatCompletionClient => {
  const apiKey = credentials.apiKey.trim();
  if (!apiKey) throw new Error("OpenRouter API key is required");

  const model = options.model?.trim() || DEFAULT_OPENROUTER_MODEL;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const transport = options.transport ?? createJsonHttpTransport();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (options.referer) headers["HTTP-Referer"] = options.referer;
  if (options.appName) headers["X-Title"] = options.appName;

  return {
    provider: "openrouter",
    model,
    complete: (input, requestOptions = {}) =>
      transport.request(
        "post",
        `${baseUrl}/chat/completions`,
        {
          headers,
          body: JSON.stringify({ model, ...input }),
          redirect: "manual",
        },
        requestOptions.maxRetries ?? 3,
        requestOptions.timeoutMs ?? 60_000,
      ),
  };
};

export const createOpenRouterClient = (
  credentials: OpenRouterCredentials,
  options: OpenRouterClientOptions = {},
) =>
  createOpenRouterClientWithBaseUrl(credentials, {
    ...options,
    baseUrl: OPENROUTER_API_BASE_URL,
  });

export const getPlatformOpenRouterSettings = () => ({
  model: process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
  baseUrl: process.env.OPENROUTER_BASE_URL || OPENROUTER_API_BASE_URL,
  referer: process.env.OPENROUTER_SITE_URL,
  appName: process.env.OPENROUTER_APP_NAME,
});

export const getPlatformOpenRouterClient = (): ChatCompletionClient | null => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const settings = getPlatformOpenRouterSettings();
  return createOpenRouterClientWithBaseUrl(
    { apiKey },
    { ...settings },
  );
};
