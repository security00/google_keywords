import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { requireEffectiveUser } from "@/lib/authz";
import {
  getByokSpendControlPolicy,
  getByokSpendControls,
  updateByokSpendControls,
} from "@/lib/byok/spend-controls";
import { GET, PUT } from "./route";

vi.mock("@/lib/authz", () => ({ requireEffectiveUser: vi.fn() }));
vi.mock("@/lib/byok/spend-controls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/byok/spend-controls")>();
  return {
    ...actual,
    getByokSpendControlPolicy: vi.fn(),
    getByokSpendControls: vi.fn(),
    updateByokSpendControls: vi.fn(),
  };
});

const mockAuth = vi.mocked(requireEffectiveUser);
const mockGet = vi.mocked(getByokSpendControls);
const mockPolicy = vi.mocked(getByokSpendControlPolicy);
const mockUpdate = vi.mocked(updateByokSpendControls);

const principal = {
  userId: "owner-1",
  role: "student" as const,
  scopes: [],
  authMethod: "cookie" as const,
  access: { allowed: true as const },
};

describe("BYOK spend-control route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BYOK_PROVIDER_CONNECTIONS_ENABLED", "true");
    vi.stubEnv("BYOK_PROVIDER_CONNECTIONS_ALLOWLIST", "owner-1");
    mockAuth.mockResolvedValue(principal as never);
    mockGet.mockResolvedValue({ dailyBudgetUsd: 1, maxConcurrentJobs: 1 });
    mockPolicy.mockReturnValue({ maxDailyBudgetUsd: 10, maxConcurrentJobs: 2 });
    mockUpdate.mockResolvedValue({ dailyBudgetUsd: 2, maxConcurrentJobs: 1 });
  });

  afterEach(() => vi.unstubAllEnvs());

  test("returns only the current owner controls and operator ceilings", async () => {
    const response = await GET(new Request(
      "https://www.discoverkeywords.co/api/provider-connections/spend-controls",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      controls: { dailyBudgetUsd: 1, maxConcurrentJobs: 1 },
      policy: { maxDailyBudgetUsd: 10, maxConcurrentJobs: 2 },
    });
    expect(mockGet).toHaveBeenCalledWith("owner-1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("updates controls only through a same-origin exact JSON request", async () => {
    const response = await PUT(new Request(
      "https://www.discoverkeywords.co/api/provider-connections/spend-controls",
      {
        method: "PUT",
        headers: {
          origin: "https://www.discoverkeywords.co",
          "content-type": "application/json",
        },
        body: JSON.stringify({ dailyBudgetUsd: 2, maxConcurrentJobs: 1 }),
      },
    ));

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      ownerId: "owner-1",
      dailyBudgetUsd: 2,
      maxConcurrentJobs: 1,
    });
  });

  test("rejects unknown fields before persistence", async () => {
    const response = await PUT(new Request(
      "https://www.discoverkeywords.co/api/provider-connections/spend-controls",
      {
        method: "PUT",
        headers: {
          origin: "https://www.discoverkeywords.co",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          dailyBudgetUsd: 2,
          maxConcurrentJobs: 1,
          bypass: true,
        }),
      },
    ));

    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
