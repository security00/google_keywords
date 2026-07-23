import "server-only";

import {
  createDataForSeoClient,
  type DataForSeoCredentials,
} from "@/lib/providers/dataforseo";
import {
  createOpenRouterClient,
  type OpenRouterClientOptions,
  type OpenRouterCredentials,
} from "@/lib/providers/openrouter";

export const createByokDataForSeoClient = (
  credentials: DataForSeoCredentials,
) => createDataForSeoClient(credentials, { rejectRedirects: true });

export const createByokOpenRouterClient = (
  credentials: OpenRouterCredentials,
  options: OpenRouterClientOptions = {},
) => createOpenRouterClient(credentials, {
  ...options,
  rejectRedirects: true,
});
