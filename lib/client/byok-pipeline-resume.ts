export type ByokPipelineStatus = "processing" | "complete" | "partial" | "failed";

export type ByokPipelineProgress = {
  completed: number;
  total: number;
};

export type ByokPipelineHistoryItem = {
  jobId: string;
  operation: "expand" | "compare";
  status: ByokPipelineStatus;
  progress: ByokPipelineProgress;
};

export type ByokPipelineJob<T> = {
  jobId: string;
  status: ByokPipelineStatus;
  progress: ByokPipelineProgress;
  errorCode?: string | null;
  result?: T | null;
};

const isUsableResult = (status: ByokPipelineStatus) =>
  status === "complete" || status === "partial";

export const pickResumablePipelineJob = (
  items: readonly ByokPipelineHistoryItem[],
  operation: "expand" | "compare",
) => {
  const ofOperation = items.filter((item) => item.operation === operation);
  return ofOperation.find((item) => item.status === "processing")
    ?? ofOperation.find((item) => isUsableResult(item.status))
    ?? null;
};

export const pickResumablePipelineJobs = (items: readonly ByokPipelineHistoryItem[]) => ({
  expand: pickResumablePipelineJob(items, "expand"),
  compare: pickResumablePipelineJob(items, "compare"),
});

export const fetchByokPipelineJob = async <T,>(jobId: string): Promise<ByokPipelineJob<T>> => {
  const response = await fetch(`/api/research/byok/pipeline/jobs/${encodeURIComponent(jobId)}`, {
    credentials: "include",
    cache: "no-store",
  });
  const job = await response.json().catch(() => ({})) as ByokPipelineJob<T> & {
    code?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(job.code || job.error || "实时任务状态不可用");
  }
  return job;
};

export const pollByokPipelineJob = async <T,>(
  initial: ByokPipelineJob<T>,
  options: Readonly<{
    onProgress: (progress: ByokPipelineProgress) => void;
    shouldStop?: () => boolean;
    maxWaitMs?: number;
    pollIntervalMs?: number;
  }>,
): Promise<ByokPipelineJob<T>> => {
  let job = initial;
  const deadline = Date.now() + (options.maxWaitMs ?? 600_000);
  const interval = options.pollIntervalMs ?? 5_000;
  while (job.status === "processing" && Date.now() < deadline) {
    options.onProgress(job.progress);
    if (options.shouldStop?.()) return job;
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (options.shouldStop?.()) return job;
    job = await fetchByokPipelineJob<T>(job.jobId);
  }
  options.onProgress(job.progress);
  return job;
};
