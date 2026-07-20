import {
  MAX_WAIT_MS,
  POLL_INTERVAL_MS,
  SERP_TASK_BATCH_SIZE,
  SERP_TOP_RESULTS,
  buildPostbackUrl,
  sleep,
  extractDataForSeoCost,
  mergeCostSummaries,
} from "./dataforseo-client";
import { createBatches } from "./keyword-utils";
import {
  DATAFORSEO_ENDPOINTS,
  getPlatformDataForSeoClient,
  type DataForSeoClient,
} from "./providers/dataforseo";

export type SerpSummary = {
  keyword: string;
  itemTypes: string[];
  itemTypeCounts: Record<string, number>;
  topResults: Array<{
    title: string;
    url?: string;
    domain?: string;
    description?: string;
  }>;
};

export type SerpRequestConfig = {
  locationCode?: number;
  locationName: string;
  languageCode: string;
  device: string;
  os: string;
  depth: number;
};

export const getPlatformSerpConfig = (): SerpRequestConfig => {
  const locationCodeRaw = process.env.SERP_LOCATION_CODE;
  const locationCode = locationCodeRaw ? Number(locationCodeRaw) : undefined;
  const locationName =
    process.env.SERP_LOCATION_NAME || "United States";
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

export const buildSerpTask = (
  keyword: string,
  config: SerpRequestConfig = getPlatformSerpConfig(),
) => {
  const task: Record<string, unknown> = {
    keyword,
    language_code: config.languageCode,
    device: config.device,
    os: config.os,
    depth: config.depth,
  };

  if (config.locationCode) {
    task.location_code = config.locationCode;
  } else {
    task.location_name = config.locationName;
  }

  return task;
};

export const submitSerpTasksWithCost = async (
  keywords: string[],
  options?: {
    postbackUrl?: string;
    cacheKey?: string;
    providerClient?: DataForSeoClient;
    config?: SerpRequestConfig;
  }
) => {
  const providerClient = options?.providerClient ?? getPlatformDataForSeoClient();
  const config = options?.config ?? getPlatformSerpConfig();
  const batches = createBatches(keywords, SERP_TASK_BATCH_SIZE);
  const taskIds: string[] = [];
  const costs = [];
  const postback = buildPostbackUrl(options?.postbackUrl, options?.cacheKey, "serp");

  for (const batch of batches) {
    const payload = batch.map((keyword) => ({
      ...buildSerpTask(keyword, config),
      ...(postback ? { postback_url: postback } : {}),
    }));
    const result = await providerClient.request("post", DATAFORSEO_ENDPOINTS.serpTaskPost, {
      body: JSON.stringify(payload),
    });

    if (result?.status_code !== 20000) {
      throw new Error(result?.status_message || "Failed to create SERP tasks");
    }

    costs.push(extractDataForSeoCost(result));

    for (const task of result.tasks ?? []) {
      if (task?.status_code === 20100 && task?.id) {
        taskIds.push(task.id);
      }
    }
  }

  return { taskIds, cost: mergeCostSummaries(costs) };
};

export const submitSerpTasks = async (
  keywords: string[],
  options?: {
    postbackUrl?: string;
    cacheKey?: string;
    providerClient?: DataForSeoClient;
    config?: SerpRequestConfig;
  }
) => {
  const submission = await submitSerpTasksWithCost(keywords, options);
  return submission.taskIds;
};

export const waitForSerpTasks = async (
  taskIds: string[],
  options: { maxWaitMs?: number; providerClient?: DataForSeoClient } = {}
) => {
  const providerClient = options.providerClient ?? getPlatformDataForSeoClient();
  const pending = new Set(taskIds);
  const completed: string[] = [];
  const startedAt = Date.now();
  const maxWaitMs = Number.isFinite(options.maxWaitMs) && Number(options.maxWaitMs) > 0
    ? Math.min(Math.max(Number(options.maxWaitMs), 10_000), MAX_WAIT_MS)
    : MAX_WAIT_MS;

  while (pending.size > 0 && Date.now() - startedAt < maxWaitMs) {
    const result = await providerClient.request(
      "get",
      DATAFORSEO_ENDPOINTS.serpTasksReady,
    );

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

export const getReadySerpTaskIds = async (
  taskIds: string[],
  options: { providerClient?: DataForSeoClient } = {},
) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];

  if (pending.size === 0) return completed;

  const providerClient = options.providerClient ?? getPlatformDataForSeoClient();
  const result = await providerClient.request(
    "get",
    DATAFORSEO_ENDPOINTS.serpTasksReady,
  );

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

export const summarizeSerpResult = (taskResult: Record<string, unknown>): SerpSummary => {
  const itemsRaw = taskResult.items;
  const items = Array.isArray(itemsRaw) ? itemsRaw : [];
  const toRecord = (value: unknown) =>
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  const itemTypeCounts: Record<string, number> = {};
  for (const item of items) {
    const record = toRecord(item);
    const type = record && typeof record.type === "string" ? record.type : "unknown";
    itemTypeCounts[type] = (itemTypeCounts[type] ?? 0) + 1;
  }

  const organicItems = items
    .map((item) => toRecord(item))
    .filter(
      (item): item is Record<string, unknown> =>
        item !== null && item.type === "organic"
    );
  const topResults = organicItems.slice(0, SERP_TOP_RESULTS).map((item) => ({
    title: typeof item.title === "string" ? item.title : "",
    url: typeof item.url === "string" ? item.url : undefined,
    domain: typeof item.domain === "string" ? item.domain : undefined,
    description:
      typeof item.description === "string" ? item.description : undefined,
  }));

  const itemTypes =
    Array.isArray(taskResult.item_types)
      ? taskResult.item_types
          .filter((type): type is string => typeof type === "string")
      : Object.keys(itemTypeCounts);

  return {
    keyword: typeof taskResult.keyword === "string" ? taskResult.keyword : "",
    itemTypes,
    itemTypeCounts,
    topResults,
  };
};

export const parseSerpSummariesResponse = (response: unknown) => {
  const summaries = new Map<string, SerpSummary>();
  const root = response as {
    status_code?: number;
    tasks?: Array<{
      status_code?: number;
      result?: Array<Record<string, unknown>>;
    }>;
  } | null;

  if (root?.status_code !== 20000) return summaries;
  for (const task of root.tasks ?? []) {
    if (task?.status_code !== 20000) continue;
    const taskResult = task.result?.[0];
    if (!taskResult) continue;
    const summary = summarizeSerpResult(taskResult);
    if (summary.keyword) {
      summaries.set(summary.keyword.toLowerCase(), summary);
    }
  }
  return summaries;
};

export const getLiveSerpResultsWithCost = async (
  keywords: string[],
  options: { providerClient?: DataForSeoClient; config?: SerpRequestConfig } = {},
) => {
  const providerClient = options.providerClient ?? getPlatformDataForSeoClient();
  const config = options.config ?? getPlatformSerpConfig();
  const summaries = new Map<string, SerpSummary>();
  const costs = [];

  for (const batch of createBatches(keywords, SERP_TASK_BATCH_SIZE)) {
    const payload = batch.map((keyword) => buildSerpTask(keyword, config));
    const result = await providerClient.request("post", DATAFORSEO_ENDPOINTS.serpLiveAdvanced, {
      body: JSON.stringify(payload),
    }, 2, 120_000);

    if (result?.status_code !== 20000) {
      throw new Error(result?.status_message || "Failed to fetch live SERP results");
    }

    costs.push(extractDataForSeoCost(result));

    for (const [key, summary] of parseSerpSummariesResponse(result)) {
      summaries.set(key, summary);
    }
  }

  return { summaries, cost: mergeCostSummaries(costs) };
};

export const getSerpResults = async (
  taskIds: string[],
  options: { providerClient?: DataForSeoClient } = {},
) => {
  const providerClient = options.providerClient ?? getPlatformDataForSeoClient();
  const summaries = new Map<string, SerpSummary>();

  for (const taskId of taskIds) {
    const result = await providerClient.request(
      "get",
      `${DATAFORSEO_ENDPOINTS.serpTaskGetAdvanced}/${taskId}`,
    );

    for (const [key, summary] of parseSerpSummariesResponse(result)) {
      summaries.set(key, summary);
    }
  }

  return summaries;
};
