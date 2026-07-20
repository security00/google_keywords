import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import {
  claimOwnedJob,
  completeOwnedJobWithPayload,
  finishClaimedJob,
  getJobForRequest,
  getInternalJobById,
  getOwnedJob,
  linkJobToRequest,
} from "./research-jobs";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);

const jobRow = {
  id: "job-1",
  user_id: "user-1",
  job_type: "expand",
  status: "pending",
  task_ids: '["task-1"]',
  payload: '{"keywords":["alpha"]}',
  session_id: null,
  error: null,
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
};

describe("research job ownership", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
  });

  test("owned reads require id, owner, and job type", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [jobRow] });

    const job = await getOwnedJob("job-1", "user-1", "expand");

    expect(job?.task_ids).toEqual(["task-1"]);
    expect(String(mockD1Query.mock.calls[0][0])).toContain(
      "id = ? AND user_id = ? AND job_type = ?",
    );
    expect(mockD1Query.mock.calls[0][1]).toEqual([
      "job-1",
      "user-1",
      "expand",
    ]);
  });

  test("internal reads are explicit and still require a job type", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [jobRow] });

    await getInternalJobById("job-1", "expand");

    expect(String(mockD1Query.mock.calls[0][0])).toContain(
      "id = ? AND job_type = ?",
    );
    expect(String(mockD1Query.mock.calls[0][0])).not.toContain("user_id");
  });

  test("request mappings are owner- and type-scoped", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [jobRow] });

    const job = await getJobForRequest(
      "user-1",
      "expand",
      "logical-request",
    );

    expect(job?.id).toBe("job-1");
    expect(String(mockD1Query.mock.calls[0][0])).toContain(
      "j.user_id = r.user_id AND j.job_type = r.job_type",
    );
    expect(mockD1Query.mock.calls[0][1]?.slice(1)).toEqual([
      "user-1",
      "expand",
      expect.any(String),
    ]);
  });

  test("job references are stored outside result cache", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [], meta: { changes: 1 } });

    await linkJobToRequest(
      "user-1",
      "expand",
      "logical-request",
      "job-1",
    );

    expect(String(mockD1Query.mock.calls[0][0])).toContain(
      "INSERT INTO research_job_requests",
    );
    expect(String(mockD1Query.mock.calls[0][0])).not.toContain("query_cache");
    expect(mockD1Query.mock.calls[0][1]?.slice(1, 3)).toEqual([
      "user-1",
      "expand",
    ]);
    expect(mockD1Query.mock.calls[0][1]?.slice(5)).toEqual([
      "job-1",
      "user-1",
      "expand",
    ]);
  });

  test("claims are atomic and cannot cross the ownership boundary", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [], meta: { changes: 1 } });

    const claim = await claimOwnedJob(
      "job-1",
      "user-1",
      "expand",
    );

    expect(claim?.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(mockD1Query.mock.calls[0][0])).toContain(
      "WHERE id = ? AND user_id = ? AND job_type = ?",
    );
    expect(String(mockD1Query.mock.calls[0][0])).toContain("status = 'pending'");
  });

  test("only the current claim token can finish an owned job", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [], meta: { changes: 1 } });

    const changed = await finishClaimedJob(
      "job-1",
      "user-1",
      "claim-1",
      "complete",
      { sessionId: "session-1" },
    );

    expect(changed).toBe(true);
    expect(String(mockD1Query.mock.calls[0][0])).toContain(
      "WHERE id = ? AND user_id = ? AND claim_token = ?",
    );
  });

  test("payload completion is owner-scoped", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [], meta: { changes: 1 } });

    await completeOwnedJobWithPayload(
      "job-1",
      "user-1",
      "claim-1",
      { results: ["alpha"] },
    );

    expect(String(mockD1Query.mock.calls[0][0])).toContain(
      "WHERE id = ? AND user_id = ?",
    );
    expect(mockD1Query.mock.calls[0][1]?.[0]).toBe(
      '{"results":["alpha"]}',
    );
  });
});
