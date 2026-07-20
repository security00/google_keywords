export const KNOWN_PIPELINE_NAMES = [
  "precompute-shared-expand",
  "old-word-pipeline",
  "game-trend-scanner",
  "community-signals",
] as const;
export type KnownPipelineName = (typeof KNOWN_PIPELINE_NAMES)[number];

export type PipelineName = KnownPipelineName | (string & {});

export const PIPELINE_CONTRACT_VERSION = 1 as const;
export const PIPELINE_RUN_STATUSES = [
  "running",
  "success",
  "success_with_warnings",
  "failed",
  "canceled",
] as const;
export const PIPELINE_TASK_STATUSES = [
  "queued",
  "running",
  "waiting_provider",
  "retry_scheduled",
  "succeeded",
  "success_with_warnings",
  "failed",
  "dead_lettered",
  "skipped",
] as const;
export const CREDENTIAL_SOURCES = ["platform", "user"] as const;
export const EXECUTION_MODES = ["platform", "byok"] as const;

export type PipelineTaskStatus =
  | "queued"
  | "running"
  | "waiting_provider"
  | "retry_scheduled"
  | "succeeded"
  | "success_with_warnings"
  | "failed"
  | "dead_lettered"
  | "skipped";

export const KNOWN_PIPELINE_TASK_STAGES = [
  "run.start",
  "run.finalize",
  "shared-expand.expand-trends",
  "shared-expand.llm-filter",
  "shared-expand.compare-trends",
  "shared-expand.compare-intent",
  "old-word.seed",
  "old-word.trends",
  "old-word.finalize",
  "game.fetch-source",
  "game.trends-14d",
  "game.history-90d",
  "game.serp",
  "game.serp-relevance-retry",
  "game.classify",
] as const;
export type KnownPipelineTaskStage =
  (typeof KNOWN_PIPELINE_TASK_STAGES)[number];

export type PipelineTaskStage = KnownPipelineTaskStage | (string & {});

export type PipelineRunStatus =
  | "running"
  | "success"
  | "success_with_warnings"
  | "failed"
  | "canceled";

export type PipelineRun = {
  runId: string;
  runKey: string | null;
  pipeline: PipelineName;
  status: PipelineRunStatus | string;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  checkedCount: number | null;
  savedCount: number | null;
  estimatedCostUsd: number | null;
  budgetUsd: number | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type PipelineRunInput = {
  runId: string;
  pipeline: PipelineName;
  runKey?: string | null;
  status?: PipelineRunStatus;
  startedAt?: string;
  budgetUsd?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type PipelineRunUpdateInput = {
  checkedCount?: number | null;
  savedCount?: number | null;
  estimatedCostUsd?: number | null;
  budgetUsd?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type PipelineRunCompletionInput = {
  status: Exclude<PipelineRunStatus, "running">;
  completedAt?: string;
  durationSeconds?: number | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type PipelineTask = {
  taskId: string;
  runId: string;
  pipeline: PipelineName;
  stage: PipelineTaskStage;
  status: PipelineTaskStatus;
  idempotencyKey: string;
  queueMessageId: string | null;
  researchJobId: string | null;
  providerTaskIds: string[];
  inputRef: string | null;
  outputRef: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  nextRunAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type PipelineTaskInput = {
  taskId?: string;
  runId: string;
  pipeline: PipelineName;
  stage: PipelineTaskStage;
  idempotencyKey: string;
  queueMessageId?: string | null;
  researchJobId?: string | null;
  providerTaskIds?: string[];
  inputRef?: string | null;
  outputRef?: string | null;
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  maxAttempts?: number;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  nextRunAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type PipelineTaskClaimResult =
  | {
      claimed: true;
      existing: false;
      task: PipelineTask;
    }
  | {
      claimed: true;
      existing: true;
      previousStatus: PipelineTaskStatus;
      task: PipelineTask;
    }
  | {
      claimed: false;
      existing: true;
      reason: "already_completed" | "lease_active" | "max_attempts_exceeded" | "not_due";
      task: PipelineTask;
    };

export type CostEventInput = {
  runId: string;
  pipeline: PipelineName;
  provider: string;
  endpoint: string;
  unitType: string;
  unitCount: number;
  unitPriceUsd?: number | null;
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
  taskId?: string | null;
  researchJobId?: string | null;
  eventKey?: string | null;
  providerRequestId?: string | null;
  idempotencyKey?: string | null;
  credentialSource?: (typeof CREDENTIAL_SOURCES)[number];
  executionMode?: (typeof EXECUTION_MODES)[number];
  ownerId?: string | null;
  metadata?: Record<string, unknown> | null;
};
