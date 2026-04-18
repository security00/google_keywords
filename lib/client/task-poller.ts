type PollPayload = {
  status?: string;
  error?: unknown;
  ready?: unknown;
  total?: unknown;
  [key: string]: unknown;
};

export type TaskCompletePayload<T> = T & {
  status: "complete";
  ready?: number;
  total?: number;
};

type PollTaskOptions = {
  jobId: string;
  statusUrl: string;
  maxWaitMs: number;
  pollIntervalMs: number;
  maxPollIntervalMs?: number;
  credentials?: RequestCredentials;
  requestErrorMessage?: string;
  failedErrorMessage?: string;
  timeoutErrorMessage?: string;
  networkErrorMessage?: string;
  throwOnTimeout?: boolean;
  maxTransientNetworkErrors?: number;
  onPending?: (payload: PollPayload) => void | Promise<void>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseOptionalNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const parseErrorMessage = (value: unknown, fallback: string) => {
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
};

export async function pollTaskUntilComplete<T extends Record<string, unknown>>(
  options: PollTaskOptions
): Promise<TaskCompletePayload<T> | null> {
  const {
    jobId,
    statusUrl,
    maxWaitMs,
    pollIntervalMs,
    maxPollIntervalMs = Math.max(pollIntervalMs, pollIntervalMs * 3),
    credentials = "include",
    requestErrorMessage = "任务轮询失败",
    failedErrorMessage = "任务失败",
    timeoutErrorMessage = "任务等待超时",
    networkErrorMessage = "任务轮询网络异常",
    throwOnTimeout = true,
    maxTransientNetworkErrors = 3,
    onPending,
  } = options;

  const separator = statusUrl.includes("?") ? "&" : "?";
  const url = `${statusUrl}${separator}jobId=${encodeURIComponent(jobId)}`;
  const startedAt = Date.now();
  let currentPollIntervalMs = pollIntervalMs;
  let lastReady = -1;
  let transientNetworkErrors = 0;

  while (Date.now() - startedAt < maxWaitMs) {
    let response: Response;
    try {
      response = await fetch(url, {
        credentials,
        cache: "no-store",
      });
      transientNetworkErrors = 0;
    } catch (error) {
      transientNetworkErrors += 1;
      if (transientNetworkErrors > maxTransientNetworkErrors) {
        throw new Error(parseErrorMessage(error instanceof Error ? error.message : undefined, networkErrorMessage));
      }
      await sleep(Math.min(maxPollIntervalMs, currentPollIntervalMs));
      continue;
    }

    const payload = (await response.json()) as PollPayload;

    const ready = parseOptionalNumber(payload.ready);
    const total = parseOptionalNumber(payload.total);
    if (ready !== undefined) payload.ready = ready;
    if (total !== undefined) payload.total = total;

    if (!response.ok) {
      throw new Error(parseErrorMessage(payload.error, requestErrorMessage));
    }

    if (payload.status === "pending") {
      const nextReady = ready ?? 0;
      if (nextReady > lastReady) {
        currentPollIntervalMs = pollIntervalMs;
      } else {
        currentPollIntervalMs = Math.min(
          maxPollIntervalMs,
          Math.round(currentPollIntervalMs * 1.5)
        );
      }
      lastReady = nextReady;
      if (onPending) {
        await onPending(payload);
      }
      await sleep(currentPollIntervalMs);
      continue;
    }

    if (payload.status === "failed") {
      throw new Error(parseErrorMessage(payload.error, failedErrorMessage));
    }

    if (payload.status === "complete") {
      return payload as TaskCompletePayload<T>;
    }

    await sleep(currentPollIntervalMs);
  }

  if (!throwOnTimeout) return null;
  throw new Error(timeoutErrorMessage);
}
