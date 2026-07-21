import { beforeEach, describe, expect, test, vi } from "vitest";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { d1Batch, d1Query } from "./d1";

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

  test("executes atomic statement batches through the generated DB binding", async () => {
    const batch = vi.fn().mockResolvedValue([
      { success: true, results: [], meta: { changes: 1 } },
      { success: true, results: [], meta: { changes: 1 } },
    ]);
    const firstBind = vi.fn(() => ({ statement: "first" }));
    const secondBind = vi.fn(() => ({ statement: "second" }));
    const prepare = vi.fn()
      .mockImplementationOnce(() => ({ bind: firstBind }))
      .mockImplementationOnce(() => ({ bind: secondBind }));
    mockGetCloudflareContext.mockResolvedValue({
      env: { DB: { prepare, batch } },
    } as never);

    const result = await d1Batch([
      { sql: "INSERT INTO first_table(value) VALUES (?)", params: [undefined] },
      { sql: "DELETE FROM second_table WHERE id = ?", params: ["item-1"] },
    ]);

    expect(firstBind).toHaveBeenCalledWith(null);
    expect(secondBind).toHaveBeenCalledWith("item-1");
    expect(batch).toHaveBeenCalledWith([
      { statement: "first" },
      { statement: "second" },
    ]);
    expect(result.map((entry) => entry.meta?.changes)).toEqual([1, 1]);
  });
});
