import { beforeEach, describe, expect, test, vi } from "vitest";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { d1Query } from "./d1";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

const mockGetCloudflareContext = vi.mocked(getCloudflareContext);

describe("D1 runtime boundary", () => {
  beforeEach(() => {
    mockGetCloudflareContext.mockReset();
  });

  test("executes Worker queries through the generated DB binding", async () => {
    const all = vi.fn().mockResolvedValue({
      success: true,
      results: [{ value: 1 }],
      meta: { changes: 0 },
    });
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    mockGetCloudflareContext.mockResolvedValue({
      env: { DB: { prepare } },
    } as never);

    const result = await d1Query<{ value: number }>("SELECT ? AS value", [1]);

    expect(result.rows).toEqual([{ value: 1 }]);
    expect(prepare).toHaveBeenCalledWith("SELECT ? AS value");
    expect(bind).toHaveBeenCalledWith(1);
  });

  test("fails closed when the DB binding is unavailable", async () => {
    mockGetCloudflareContext.mockRejectedValue(new Error("outside Worker"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(d1Query("SELECT 1")).rejects.toThrow(
      "must not fall back to the Cloudflare REST API",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
