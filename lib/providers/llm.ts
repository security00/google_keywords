export type ChatCompletionInput = {
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  response_format?:
    | { type: "json_object" }
    | {
      type: "json_schema";
      json_schema: {
        name: string;
        strict?: boolean;
        schema: Readonly<Record<string, unknown>>;
      };
    };
  provider?: {
    require_parameters?: boolean;
  };
  plugins?: Array<{
    id: string;
  }>;
};
export type ChatCompletionClient = {
  provider: string;
  model: string;
  complete: (
    input: ChatCompletionInput,
    options?: { maxRetries?: number; timeoutMs?: number },
  ) => Promise<ReturnType<typeof JSON.parse>>;
};
