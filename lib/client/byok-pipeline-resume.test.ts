import { afterEach, describe, expect, test, vi } from "vitest";

import {
  fetchByokPipelineJob,
  pickResumablePipelineJobs,
  pollByokPipelineJob,
} from "./byok-pipeline-resume";

const history = [
  {
    jobId: "compare-failed",
    operation: "compare" as const,
    status: "failed" as const,
    progress: { completed: 1, total: 5 },
  },
  {
    jobId: "compare-done",
    operation: "compare" as const,
    status: "complete" as const,
    progress: { completed: 5, total: 5 },
  },
  {
    jobId: "expand-running",
    operation: "expand" as const,
    status: "processing" as const,
    progress: { completed: 2, total: 4 },
  },
  {
    jobId: "expand-done",
    operation: "expand" as const,
    status: "complete" as const,
    progress: { completed: 4, total: 4 },
  },
];

describe("pickResumablePipelineJobs", () => {
  test("prefers an in-flight job, then the latest usable result", () => {
    expect(pickResumablePipelineJobs(history)).toEqual({
      expand: history[2],
      compare: history[1],
    });
  });

  test("ignores a failed latest compare when a completed one exists", () => {
    expect(pickResumablePipelineJobs(history).compare?.jobId).toBe("compare-done");
  });
});

describe("pollByokPipelineJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("stops polling once the owner-scoped job completes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        jobId: "job-1",
        status: "processing",
        progress: { completed: 2, total: 3 },
      }))
      .mockResolvedValueOnce(Response.json({
        jobId: "job-1",
        status: "complete",
        progress: { completed: 3, total: 3 },
        result: { ok: true },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const progress: Array<{ completed: number; total: number }> = [];
    const job = await pollByokPipelineJob(
      { jobId: "job-1", status: "processing", progress: { completed: 1, total: 3 } },
      {
        onProgress: (value) => progress.push(value),
        pollIntervalMs: 1,
        maxWaitMs: 1_000,
      },
    );

    expect(job.status).toBe("complete");
    expect(job.result).toEqual({ ok: true });
    expect(progress.at(-1)).toEqual({ completed: 3, total: 3 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/research/byok/pipeline/jobs/job-1",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
  });

  test("fetchByokPipelineJob surfaces the API code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ code: "JOB_NOT_FOUND" }, { status: 404 }),
    ));
    await expect(fetchByokPipelineJob("missing")).rejects.toThrow("JOB_NOT_FOUND");
  });
});
