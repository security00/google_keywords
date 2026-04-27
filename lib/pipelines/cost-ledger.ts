import "server-only";

import { d1Query } from "@/lib/d1";
import type { CostEventInput } from "./types";

export type RecordCostEventResult = {
  inserted: boolean;
};

export const recordPipelineCostEvent = async (
  input: CostEventInput
): Promise<RecordCostEventResult> => {
  const estimatedCostUsd =
    input.estimatedCostUsd ??
    (input.unitPriceUsd !== null && input.unitPriceUsd !== undefined
      ? Number((input.unitPriceUsd * input.unitCount).toFixed(6))
      : null);

  const result = await d1Query(
    `INSERT OR IGNORE INTO pipeline_cost_events
      (run_id, pipeline, provider, endpoint, unit_type, unit_count, unit_price_usd,
       estimated_cost_usd, actual_cost_usd, task_id, research_job_id, event_key,
       provider_request_id, idempotency_key, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.runId,
      input.pipeline,
      input.provider,
      input.endpoint,
      input.unitType,
      input.unitCount,
      input.unitPriceUsd ?? null,
      estimatedCostUsd,
      input.actualCostUsd ?? null,
      input.taskId ?? null,
      input.researchJobId ?? null,
      input.eventKey ?? null,
      input.providerRequestId ?? null,
      input.idempotencyKey ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );

  return { inserted: (result.meta?.changes ?? 0) > 0 };
};
