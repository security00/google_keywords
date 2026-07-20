import { afterEach, describe, expect, test, vi } from "vitest";

import { pollTaskUntilComplete } from "./task-poller";

describe("pollTaskUntilComplete", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("uses the explicit POST executor by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ status: "complete", ready: 1, total: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await pollTaskUntilComplete({
      jobId: "job-1",
      statusUrl: "/api/research/expand/status",
      maxWaitMs: 1_000,
      pollIntervalMs: 1,
    });

    expect(result?.status).toBe("complete");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/research/expand/status?jobId=job-1",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
