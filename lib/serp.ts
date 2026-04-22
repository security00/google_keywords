import {
  SERP_TASK_POST_URL,
  SERP_TASKS_READY_URL,
  SERP_TASK_GET_ADV_URL,
  MAX_WAIT_MS,
  POLL_INTERVAL_MS,
  SERP_TASK_BATCH_SIZE,
  SERP_TOP_RESULTS,
  normalizeDate,
  buildPostbackUrl,
  buildAuthHeaders,
  requestWithRetry,
  sleep,
} from "./dataforseo-client";
import { createBatches } from "./keyword-utils";

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

const getSerpConfig = () => {
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

const buildSerpTask = (keyword: string) => {
  const config = getSerpConfig();
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

export const submitSerpTasks = async (
  keywords: string[],
  options?: { postbackUrl?: string; cacheKey?: string }
) => {
  const batches = createBatches(keywords, SERP_TASK_BATCH_SIZE);
  const taskIds: string[] = [];
  const postback = buildPostbackUrl(options?.postbackUrl, options?.cacheKey, "serp");

  for (const batch of batches) {
    const payload = batch.map((keyword) => ({
      ...buildSerpTask(keyword),
      ...(options?.cacheKey ? { tag: options.cacheKey } : {}),
      ...(postback ? { postback_url: postback } : {}),
    }));
    const result = await requestWithRetry("post", SERP_TASK_POST_URL, {
      headers: buildAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (result?.status_code !== 20000) {
      throw new Error(result?.status_message || "Failed to create SERP tasks");
    }

    for (const task of result.tasks ?? []) {
      if (task?.status_code === 20100 && task?.id) {
        taskIds.push(task.id);
      }
    }
  }

  return taskIds;
};

export const waitForSerpTasks = async (taskIds: string[]) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];
  const startedAt = Date.now();

  while (pending.size > 0 && Date.now() - startedAt < MAX_WAIT_MS) {
    const result = await requestWithRetry("get", SERP_TASKS_READY_URL, {
      headers: buildAuthHeaders(),
    });

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

export const getReadySerpTaskIds = async (taskIds: string[]) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];

  if (pending.size === 0) return completed;

  const result = await requestWithRetry("get", SERP_TASKS_READY_URL, {
    headers: buildAuthHeaders(),
  });

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

export const getSerpResults = async (taskIds: string[]) => {
  const summaries = new Map<string, SerpSummary>();

  for (const taskId of taskIds) {
    const result = await requestWithRetry(
      "get",
      `${SERP_TASK_GET_ADV_URL}/${taskId}`,
      {
        headers: buildAuthHeaders(),
      }
    );

    if (result?.status_code !== 20000) {
      continue;
    }

    for (const task of result?.tasks ?? []) {
      if (task?.status_code !== 20000) continue;
      const taskResult = task?.result?.[0];
      if (!taskResult) continue;
      const summary = summarizeSerpResult(taskResult);
      if (summary.keyword) {
        summaries.set(summary.keyword.toLowerCase(), summary);
      }
    }
  }

  return summaries;
};
