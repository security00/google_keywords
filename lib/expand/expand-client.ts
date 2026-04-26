import type { Candidate } from "@/lib/types";
import {
  TASK_POST_URL,
  TASKS_READY_URL,
  TASK_GET_URL,
  MAX_WAIT_MS,
  POLL_INTERVAL_MS,
  EXPANSION_TASK_POST_BATCH_SIZE,
  normalizeDate,
  buildPostbackUrl,
  buildAuthHeaders,
  requestWithRetry,
  sleep,
  extractDataForSeoCost,
  mergeCostSummaries,
} from "../dataforseo-client";
import { createBatches } from "../keyword-utils";

export const submitExpansionTasksWithCost = async (
  keywords: string[],
  dateFrom: string,
  dateTo: string,
  options?: { postbackUrl?: string; cacheKey?: string }
) => {
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

    const result = await requestWithRetry("post", TASK_POST_URL, {
      headers: buildAuthHeaders(),
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
  options?: { postbackUrl?: string; cacheKey?: string }
) => {
  const submission = await submitExpansionTasksWithCost(keywords, dateFrom, dateTo, options);
  return submission.taskIds;
};

export const waitForTasks = async (taskIds: string[]) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];
  const startedAt = Date.now();

  while (pending.size > 0 && Date.now() - startedAt < MAX_WAIT_MS) {
    const result = await requestWithRetry("get", TASKS_READY_URL, {
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

export const getReadyTaskIds = async (taskIds: string[]) => {
  const pending = new Set(taskIds);
  const completed: string[] = [];

  if (pending.size === 0) return completed;

  const result = await requestWithRetry("get", TASKS_READY_URL, {
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

export const getExpansionResults = async (taskIds: string[]) => {
  const allCandidates: Candidate[] = [];

  for (const taskId of taskIds) {
    const result = await requestWithRetry("get", `${TASK_GET_URL}/${taskId}`, {
      headers: buildAuthHeaders(),
    });

    if (result?.status_code !== 20000) {
      continue;
    }

    for (const task of result?.tasks ?? []) {
      if (task?.status_code !== 20000) continue;

      const taskResult = task?.result?.[0];
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
  }

  return allCandidates;
};
