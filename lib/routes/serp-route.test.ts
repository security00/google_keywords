import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/research/serp/route";
import { getPrincipal, requirePaidApiPermission } from "@/lib/authz";
import { getCached, setCache } from "@/lib/cache";
import { getLiveSerpResultsWithCost, getSerpResults, submitSerpTasksWithCost, waitForSerpTasks } from "@/lib/keyword-research";

vi.mock("@/lib/authz", () => ({
  getPrincipal: vi.fn(),
  isAuthzError: vi.fn((value) => value instanceof Response),
  requirePaidApiPermission: vi.fn(),
}));

vi.mock("@/lib/usage", () => ({
  checkStudentAccess: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/lib/cache", () => ({
  buildCacheKey: vi.fn(() => "serp-cache-key"),
  getCached: vi.fn(),
  setCache: vi.fn(),
}));

vi.mock("@/lib/keyword-research", () => ({
  getLiveSerpResultsWithCost: vi.fn(),
  submitSerpTasksWithCost: vi.fn(),
  waitForSerpTasks: vi.fn(),
  getSerpResults: vi.fn(),
}));

const mockGetPrincipal = vi.mocked(getPrincipal);
const mockRequirePaidApiPermission = vi.mocked(requirePaidApiPermission);
const mockGetCached = vi.mocked(getCached);
const mockSetCache = vi.mocked(setCache);
const mockGetLiveSerpResultsWithCost = vi.mocked(getLiveSerpResultsWithCost);
const mockSubmitSerpTasksWithCost = vi.mocked(submitSerpTasksWithCost);
const mockWaitForSerpTasks = vi.mocked(waitForSerpTasks);
const mockGetSerpResults = vi.mocked(getSerpResults);

describe("POST /api/research/serp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPrincipal.mockResolvedValue({ authMethod: "cron" });
    mockRequirePaidApiPermission.mockResolvedValue({ authMethod: "cron" });
    mockGetCached.mockResolvedValue(null);
    mockGetLiveSerpResultsWithCost.mockResolvedValue({
      summaries:
      new Map([
        [
          "planet clicker",
          {
            keyword: "Planet Clicker",
            itemTypes: ["organic"],
            itemTypeCounts: { organic: 1 },
            topResults: [
              {
                title: "Planet Clicker - Play Online",
                domain: "poki.com",
                description: "A browser game",
              },
            ],
          },
        ],
      ])
,
      cost: { estimatedCostUsd: 0.0006, actualCostUsd: 0.0006 },
    });
    mockSubmitSerpTasksWithCost.mockResolvedValue({
      taskIds: ["task-1"],
      cost: { estimatedCostUsd: 0.0006, actualCostUsd: 0.0006 },
    });
    mockWaitForSerpTasks.mockResolvedValue(["task-1"]);
    mockGetSerpResults.mockResolvedValue(
      new Map([
        [
          "planet clicker",
          {
            keyword: "Planet Clicker",
            itemTypes: ["organic"],
            itemTypeCounts: { organic: 1 },
            topResults: [
              {
                title: "Planet Clicker - Play Online",
                domain: "poki.com",
                description: "A browser game",
              },
            ],
          },
        ],
      ])
    );
  });

  it("allows cron callers through the live SERP path", async () => {
    const response = await POST(
      new Request("https://example.com/api/research/serp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cron-secret": "secret" },
        body: JSON.stringify({ keywords: ["Planet Clicker"], maxWaitMs: 90_000 }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results["planet clicker"].signals.organicCount).toBe(1);
    expect(mockGetLiveSerpResultsWithCost).toHaveBeenCalledWith(["Planet Clicker"]);
    expect(mockSubmitSerpTasksWithCost).not.toHaveBeenCalled();
    expect(mockWaitForSerpTasks).not.toHaveBeenCalled();
    expect(mockSetCache).toHaveBeenCalledTimes(1);
  });
  it("falls back to direct task_get when tasks_ready returns no completed ids", async () => {
    mockGetPrincipal.mockResolvedValue({ authMethod: "api_key", userId: "user-1" });
    mockWaitForSerpTasks.mockResolvedValue([]);

    const response = await POST(
      new Request("https://example.com/api/research/serp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer gk_live_test" },
        body: JSON.stringify({ keywords: ["Planet Clicker"], maxWaitMs: 10_000 }),
      })
    );

    expect(response.status).toBe(200);
    expect(mockSubmitSerpTasksWithCost).toHaveBeenCalledWith(["Planet Clicker"]);
    expect(mockGetSerpResults).toHaveBeenCalledWith(["task-1"]);
  });

});
