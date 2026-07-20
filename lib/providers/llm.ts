export type ChatCompletionInput = {
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
};
export type ChatCompletionClient = {
  provider: string;
  model: string;
  complete: (
    input: ChatCompletionInput,
    options?: { maxRetries?: number; timeoutMs?: number },
  ) => Promise<ReturnType<typeof JSON.parse>>;
};
