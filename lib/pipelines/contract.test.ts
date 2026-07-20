import { describe, expect, test } from "vitest";

import contract from "@/contracts/pipeline-contract-v1.json";
import {
  hashPayload,
  makeCostEventKey,
  makePipelineRunKey,
  makePipelineTaskKey,
  stableStringify,
} from "./idempotency";
import {
  CREDENTIAL_SOURCES,
  EXECUTION_MODES,
  KNOWN_PIPELINE_NAMES,
  KNOWN_PIPELINE_TASK_STAGES,
  PIPELINE_CONTRACT_VERSION,
  PIPELINE_RUN_STATUSES,
  PIPELINE_TASK_STATUSES,
} from "./types";

describe("pipeline cross-runtime contract", () => {
  test("matches the versioned enum vocabulary", () => {
    expect(PIPELINE_CONTRACT_VERSION).toBe(contract.version);
    expect(PIPELINE_RUN_STATUSES).toEqual(contract.runStatuses);
    expect(PIPELINE_TASK_STATUSES).toEqual(contract.taskStatuses);
    expect(CREDENTIAL_SOURCES).toEqual(contract.credentialSources);
    expect(EXECUTION_MODES).toEqual(contract.executionModes);
    expect(KNOWN_PIPELINE_NAMES).toEqual(contract.pipelineNames);
    expect(KNOWN_PIPELINE_TASK_STAGES).toEqual(contract.taskStages);
  });

  test("matches golden stable JSON and idempotency keys", () => {
    const fixture = contract.keyFixture;
    const runKey = makePipelineRunKey(
      fixture.pipeline,
      fixture.businessDate,
      fixture.runExtra,
    );
    const taskKey = makePipelineTaskKey({
      pipeline: fixture.pipeline,
      runKey,
      stage: fixture.stage,
      payload: fixture.payload,
    });

    expect(stableStringify(fixture.payload)).toBe(fixture.expected.stablePayload);
    expect(hashPayload(fixture.payload)).toBe(fixture.expected.payloadHash);
    expect(runKey).toBe(fixture.expected.runKey);
    expect(taskKey).toBe(fixture.expected.taskKey);
    expect(makeCostEventKey({
      runId: fixture.runId,
      provider: fixture.provider,
      endpoint: fixture.endpoint,
      idempotencyKey: taskKey,
    })).toBe(fixture.expected.costEventKey);
  });
});
