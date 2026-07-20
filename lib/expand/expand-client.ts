import type { Candidate } from "@/lib/types";
import {
  MAX_WAIT_MS,
  POLL_INTERVAL_MS,
  EXPANSION_TASK_POST_BATCH_SIZE,
  normalizeDate,
  buildPostbackUrl,
  sleep,
  extractDataForSeoCost,
  mergeCostSummaries,
} from "../dataforseo-client";
import { createBatches } from "../keyword-utils";
import {
  DATAFORSEO_ENDPOINTS,
  getPlatformDataForSeoClient,
  type DataForSeoClient,
} from "../providers/dataforseo";

type ExpansionClientOptions = {
  postbackUrl?: string;
  cacheKey?: string;
  providerClient?: DataForSeoClient;
};

export const submitExpansionTasksWithCost = async (
  keywords: string[],
  dateFrom: string,
  dateTo: string,
  options?: ExpansionClientOptions
) => {
  const providerClient = options?.providerClient ?? getPlatformDataForSeoClient();
  const postback = buildPostbackUrl(options?.postbackUrl, options?.cacheKey, "expand");
  const batches = createBatches(keywords, EXPANSION_TASK_POST_BATCH_SIZE);
  const taskIds: string[] = [];
  const costs = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const payload = batch.map((keyword) => ({
      keywords: [keyword],
      date_from: normalizeDate(dateFrom),
      date_to: normalizeDate(dateTo),
      type: "web",
      item_types: ["google_trends_queries_list"],
      ...(postback ? { postback_url: postback } : {}),
    }));

    const result = await providerClient.request("post", DATAFORSEO_ENDPOINTS.trendsTaskPost, {
      body: JSON.stringify(payload),
    });

    if (result?.status_code !== 20000) {
      console.error("[dataforseo/expand] task_post failed", {
        batchIndex: batchIndex + 1,
        totalBatches: batches.length,
        keywords: batch,
        statusCode: result?.status_code,
        statusMessage: result?.status_message,
        tasksCount: Array.isArray(result?.tasks) ? result.tasks.length : 0,
      });
      throw new Error(result?.status_message || "Failed to create expansion tasks");
    }

    costs.push(extractDataForSeoCost(result));

    const createdTaskIds = (result.tasks || [])
      .filter((task: { status_code: number }) => task.status_code === 20100)
      .map((task: { id: string }) => task.id);

    if (createdTaskIds.length === 0) {
      const taskDetails = (result.tasks || []).map((task: {
        status_code?: number;
        status_message?: string;
      }) => `${task.status_code ?? "unknown"}:${task.status_message ?? "unknown"}`);
      console.error("[dataforseo/expand] batch created 0 tasks", {
        batchIndex: batchIndex + 1,
        totalBatches: batches.length,
        keywords: batch,
        taskDetails,
        rawStatusCode: result?.status_code,
        rawStatusMessage: result?.status_message,
      });
      throw new Error(
        `Expansion batch ${batchIndex + 1}/${batches.length} created 0 tasks (${taskDetails.join("; ") || "no task details"})`
      );
    }

    taskIds.push(...createdTaskIds);
  }

  return { taskIds, cost: mergeCostSummaries(costs) };
};

export const submitExpansionTasks = async (
  keywords: string[],
  dateFrom: string,
  dateTo: string,
  options?: ExpansionClientOptions
) => {
  const submission = await submitExpansionTasksWithCost(keywords, dateFrom, dateTo, options);
  return submission.taskIds;
};

export const waitForTasks = async (
  taskIds: string[],
  options: { providerClient?: DataForSeoClient } = {},
) => {
  const providerClient = options.providerClient ?? getPlatformDataForSeoClient();
  const pending = new Set(taskIds);
  const completed: string[] = [];
  const startedAt = Date.now();

  while (pending.size > 0 && Date.now() - startedAt < MAX_WAIT_MS) {
    const result = await providerClient.request(
      "get",
      DATAFORSEO_ENDPOINTS.trendsTasksReady,
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

export const getReadyTaskIds = async (
  taskIds: string[],
  options: { providerClient?: DataForSeoClient } = {},
) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];

  if (pending.size === 0) return completed;

  const providerClient = options.providerClient ?? getPlatformDataForSeoClient();
  const result = await providerClient.request(
    "get",
    DATAFORSEO_ENDPOINTS.trendsTasksReady,
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

export const getExpansionResultsFromTasks = (
  tasks: Array<Record<string, unknown>>,
) => {
  const allCandidates: Candidate[] = [];

  for (const task of tasks) {
      if (Number(task?.status_code ?? 0) !== 20000) continue;

      const taskResult = Array.isArray(task.result) ? task.result[0] : undefined;
      if (!taskResult) continue;

      const items = taskResult.items ?? [];
      const sourceKeyword = taskResult?.keywords?.[0] ?? "unknown";

      for (const item of items) {
        if (item?.type !== "google_trends_queries_list") continue;
        const data = item?.data;

        if (Array.isArray(data)) {
          for (const queryItem of data) {
            const queryText = queryItem?.query ?? "";
            const value = Number(queryItem?.value ?? 0);
            const queryType = String(queryItem?.type ?? "");
            const isRising = queryType.toLowerCase().includes("rising");

            if (queryText) {
              allCandidates.push({
                keyword: queryText,
                value,
                type: isRising ? "rising" : "top",
                source: sourceKeyword,
              });
            }
          }
        } else if (data && typeof data === "object") {
          for (const queryItem of data.top ?? []) {
            const queryText = queryItem?.query ?? "";
            const value = Number(queryItem?.value ?? 0);
            if (queryText) {
              allCandidates.push({
                keyword: queryText,
                value,
                type: "top",
                source: sourceKeyword,
              });
            }
          }

          for (const queryItem of data.rising ?? []) {
            const queryText = queryItem?.query ?? "";
            const value = Number(queryItem?.value ?? 0);
            if (queryText) {
              allCandidates.push({
                keyword: queryText,
                value,
                type: "rising",
                source: sourceKeyword,
              });
            }
          }
        }
      }
  }

  return allCandidates;
};

export const getExpansionResults = async (
  taskIds: string[],
  options: { providerClient?: DataForSeoClient } = {},
) => {
  const providerClient = options.providerClient ?? getPlatformDataForSeoClient();
  const tasks: Array<Record<string, unknown>> = [];

  for (const taskId of taskIds) {
    const result = await providerClient.request(
      "get",
      `${DATAFORSEO_ENDPOINTS.trendsTaskGet}/${taskId}`,
    );
    if (result?.status_code !== 20000 || !Array.isArray(result?.tasks)) continue;
    for (const task of result.tasks) {
      if (task && typeof task === "object") {
        tasks.push(task as Record<string, unknown>);
      }
    }
  }

  return getExpansionResultsFromTasks(tasks);
};
