import {
  createJsonHttpTransport,
  type JsonHttpMethod,
  type JsonHttpTransport,
} from "./json-http";

export const DATAFORSEO_API_BASE_URL = "https://api.dataforseo.com/v3";

export const DATAFORSEO_ENDPOINTS = {
  trendsTaskPost: "/keywords_data/google_trends/explore/task_post",
  trendsTasksReady: "/keywords_data/google_trends/explore/tasks_ready",
  trendsTaskGet: "/keywords_data/google_trends/explore/task_get",
  trendsLive: "/keywords_data/google_trends/explore/live",
  serpLiveAdvanced: "/serp/google/organic/live/advanced",
  serpTaskPost: "/serp/google/organic/task_post",
  serpTasksReady: "/serp/google/organic/tasks_ready",
  serpTaskGetAdvanced: "/serp/google/organic/task_get/advanced",
  keywordSuggestionsLive:
    "/dataforseo_labs/google/keyword_suggestions/live",
} as const;

export type DataForSeoCredentials = {
  login: string;
  password: string;
};
export type DataForSeoClientOptions = {
  transport?: JsonHttpTransport;
};

const normalizeCredentials = (credentials: DataForSeoCredentials) => {
  const login = credentials.login.trim();
  const password = credentials.password;
  if (!login || !password) {
    throw new Error("DataForSEO credentials are required");
  }
  return { login, password };
};

export const createDataForSeoClient = (
  credentials: DataForSeoCredentials,
  options: DataForSeoClientOptions = {},
) => {
  const normalized = normalizeCredentials(credentials);
  const encoded = Buffer.from(
    `${normalized.login}:${normalized.password}`,
  ).toString("base64");
  const transport = options.transport ?? createJsonHttpTransport();

  return {
    provider: "dataforseo" as const,
    request: (
      method: JsonHttpMethod,
      endpoint: string,
      requestOptions: Omit<RequestInit, "headers"> & {
        headers?: HeadersInit;
      } = {},
      maxRetries = 3,
      timeoutMs = 30_000,
    ) => {
      const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
      const url = `${DATAFORSEO_API_BASE_URL}${path}`;
      const headers = new Headers(requestOptions.headers);
      headers.set("Authorization", `Basic ${encoded}`);
      headers.set("Content-Type", "application/json");
      return transport.request(
        method,
        url,
        { ...requestOptions, headers },
        maxRetries,
        timeoutMs,
      );
    },
  };
};

export type DataForSeoClient = ReturnType<typeof createDataForSeoClient>;

export const getPlatformDataForSeoClient = () => {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("Missing DataForSEO credentials in environment variables.");
  }
  return createDataForSeoClient({ login, password });
};
