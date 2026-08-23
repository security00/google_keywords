import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { d1Batch, d1Query } from "@/lib/d1";
import {
  ByokAllowlistError,
  grantByokAllowlist,
  isByokOwnerAllowed,
  listByokAllowlist,
  revokeByokAllowlist,
} from "./allowlist";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
  d1Batch: vi.fn(),
}));

const mockQuery = vi.mocked(d1Query);
const mockBatch = vi.mocked(d1Batch);

const result = <T,>(rows: T[] = []) => ({ rows, meta: { changes: rows.length } });

const expectCode = (code: string) => (error: unknown) => {
  expect(error).toBeInstanceOf(ByokAllowlistError);
  expect((error as ByokAllowlistError).code).toBe(code);
  return true;
};

describe("BYOK allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BYOK_PROVIDER_CONNECTIONS_ALLOWLIST", "env-owner");
    vi.stubEnv("BYOK_MAX_DAILY_BUDGET_USD", "10");
    vi.stubEnv("BYOK_MAX_CONCURRENT_JOBS", "2");
  });

  afterEach(() => vi.unstubAllEnvs());

  test("allows env-pinned owners without querying D1", async () => {
    await expect(isByokOwnerAllowed("env-owner")).resolves.toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("allows database testers and fails closed when D1 is unavailable", async () => {
    mockQuery.mockResolvedValueOnce(result([{ owner_id: "db-owner" }]));
    await expect(isByokOwnerAllowed("db-owner")).resolves.toBe(true);

    mockQuery.mockRejectedValueOnce(new Error("no binding"));
    await expect(isByokOwnerAllowed("db-owner")).resolves.toBe(false);
  });

  test("merges env and database entries without exposing extra fields", async () => {
    mockQuery
      .mockResolvedValueOnce(result([{
        owner_id: "db-owner",
        email: "tester@example.com",
        created_by: "admin-1",
        created_at: "2026-08-23T00:00:00.000Z",
      }]))
      .mockResolvedValueOnce(result([
        { id: "env-owner", email: "ops@example.com", role: "admin" },
        { id: "db-owner", email: "tester@example.com", role: "student" },
      ]))
      .mockResolvedValueOnce(result([{
        owner_id: "db-owner",
        daily_budget_micro_usd: 50_000,
        max_concurrent_jobs: 1,
      }]));

    await expect(listByokAllowlist()).resolves.toEqual([
      {
        ownerId: "env-owner",
        email: "ops@example.com",
        role: "admin",
        source: "env",
        createdBy: null,
        createdAt: null,
        dailyBudgetUsd: null,
        maxConcurrentJobs: null,
        removable: false,
      },
      {
        ownerId: "db-owner",
        email: "tester@example.com",
        role: "student",
        source: "database",
        createdBy: "admin-1",
        createdAt: "2026-08-23T00:00:00.000Z",
        dailyBudgetUsd: 0.05,
        maxConcurrentJobs: 1,
        removable: true,
      },
    ]);
  });

  test("grants an existing student with conservative spend controls", async () => {
    mockQuery
      .mockResolvedValueOnce(result([{
        id: "student-1",
        email: "bote@example.com",
        role: "student",
      }]))
      .mockResolvedValueOnce(result([{
        owner_id: "student-1",
        email: "bote@example.com",
        created_by: "admin-1",
        created_at: "2026-08-23T00:00:00.000Z",
      }]))
      .mockResolvedValueOnce(result([{
        id: "student-1",
        email: "bote@example.com",
        role: "student",
      }]))
      .mockResolvedValueOnce(result([{
        owner_id: "student-1",
        daily_budget_micro_usd: 50_000,
        max_concurrent_jobs: 1,
      }]));
    mockBatch.mockResolvedValueOnce([]);

    const granted = await grantByokAllowlist({
      actorId: "admin-1",
      email: "Bote@example.com",
    });

    expect(granted).toMatchObject({
      ownerId: "student-1",
      email: "bote@example.com",
      source: "database",
      dailyBudgetUsd: 0.05,
      maxConcurrentJobs: 1,
      removable: true,
    });
    expect(mockBatch).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO byok_allowlist"),
      }),
      expect.objectContaining({
        sql: expect.stringContaining("ON CONFLICT(owner_id) DO NOTHING"),
        params: expect.arrayContaining(["student-1", 50_000, 1]),
      }),
    ]));
  });

  test("rejects missing or banned users before writing", async () => {
    mockQuery.mockResolvedValueOnce(result());
    await expect(grantByokAllowlist({
      actorId: "admin-1",
      email: "missing@example.com",
    })).rejects.toSatisfy(expectCode("USER_NOT_FOUND"));

    mockQuery.mockResolvedValueOnce(result([{
      id: "banned-1",
      email: "banned@example.com",
      role: "banned",
    }]));
    await expect(grantByokAllowlist({
      actorId: "admin-1",
      email: "banned@example.com",
    })).rejects.toSatisfy(expectCode("USER_BANNED"));
    expect(mockBatch).not.toHaveBeenCalled();
  });

  test("revokes database testers and refuses to unpin env owners", async () => {
    mockQuery.mockResolvedValueOnce(result([{
      owner_id: "db-owner",
      email: "tester@example.com",
      created_by: "admin-1",
      created_at: "2026-08-23T00:00:00.000Z",
    }]));
    mockBatch.mockResolvedValueOnce([]);
    await expect(revokeByokAllowlist({
      actorId: "admin-1",
      ownerId: "db-owner",
    })).resolves.toEqual({ ownerId: "db-owner", stillAllowed: false });

    mockQuery.mockResolvedValueOnce(result());
    await expect(revokeByokAllowlist({
      actorId: "admin-1",
      ownerId: "env-owner",
    })).rejects.toSatisfy(expectCode("ENV_PINNED"));
  });
});
