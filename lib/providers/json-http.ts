export type JsonHttpMethod = "get" | "post";

export type JsonHttpTransport = {
  request: (
    method: JsonHttpMethod,
    url: string,
    options?: RequestInit,
    maxRetries?: number,
    timeoutMs?: number,
  ) => Promise<ReturnType<typeof JSON.parse>>;
};

export type JsonHttpTransportOptions = {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const createJsonHttpTransport = (
  options: JsonHttpTransportOptions = {},
): JsonHttpTransport => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? defaultSleep;

  return {
    request: async (
      method,
      url,
      requestOptions = {},
      maxRetries = 3,
      timeoutMs = 30_000,
    ) => {
      let lastError: Error | undefined;
      const attempts = Math.max(1, Math.min(Math.floor(maxRetries), 5));

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(url, {
            ...requestOptions,
            method: method.toUpperCase(),
            signal: controller.signal,
          });
          const text = await response.text();
          const trimmed = text.trim();
          const data = trimmed ? JSON.parse(trimmed) : null;

          if (!response.ok) {
            const statusMessage =
              data && typeof data.status_message === "string"
                ? data.status_message
                : response.statusText;
            throw new Error(statusMessage || `Request failed (${response.status})`);
          }

          return data;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Unknown error");
        } finally {
          clearTimeout(timeout);
        }
        if (attempt < attempts - 1) {
          await sleepImpl((attempt + 1) * 5_000);
        }
      }

      throw lastError ?? new Error("Request failed");
    },
  };
};
