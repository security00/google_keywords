import { NextRequest } from "next/server";
import { gzipSync } from "zlib";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { signResearchWebhookToken } from "@/lib/research-webhook";

const mockD1Query = vi.hoisted(() => vi.fn());
const mockSetCache = vi.hoisted(() => vi.fn());

vi.mock("@/lib/d1", () => ({
  d1Query: mockD1Query,
}));

vi.mock("@/lib/cache", () => ({
  setCache: mockSetCache,
}));

const { POST } = await import("./route");

const postWebhook = (input: {
  url?: string;
  body?: BodyInit;
  headers?: HeadersInit;
}) =>
  POST(
    new NextRequest(input.url ?? "https://discoverkeywords.co/api/research/webhook?type=serp&cache_key=ck_1", {
      method: "POST",
      headers: input.headers,
      body: input.body ?? JSON.stringify({ tasks: [{ id: "task_1" }] }),
    })
  );

describe("POST /api/research/webhook", () => {
  beforeEach(() => {
    vi.stubEnv("WEBHOOK_SKIP_IP_CHECK", "true");
    vi.stubEnv("RESEARCH_WEBHOOK_TOKEN_SECRET", "webhook-secret");
    vi.stubEnv("RESEARCH_WEBHOOK_TOKEN_REQUIRED", "");
    mockD1Query.mockReset();
    mockSetCache.mockReset();
    mockD1Query.mockResolvedValue({ rows: [] });
    mockSetCache.mockResolvedValue(undefined);
  });

  test("accepts a legacy callback without a token", async () => {
    const response = await postWebhook({});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mockD1Query).toHaveBeenCalled();
    expect(mockSetCache).toHaveBeenCalledWith("ck_1", expect.any(Object), {
      namespace: "provider-direct",
    });
  });

  test("accepts gzip bodies and a valid callback token", async () => {
    const token = signResearchWebhookToken("ck_1", "serp");
    const response = await postWebhook({
      url: `https://discoverkeywords.co/api/research/webhook?type=serp&cache_key=ck_1&cb=${token}`,
      body: gzipSync(Buffer.from(JSON.stringify({ tasks: [{ id: "task_2" }] }))),
      headers: { "content-encoding": "gzip" },
    });
    expect(response.status).toBe(200);
    expect(mockD1Query).toHaveBeenCalled();
  });

  test("rejects a forged token without writing cache", async () => {
    const response = await postWebhook({
      url: "https://discoverkeywords.co/api/research/webhook?type=serp&cache_key=ck_1&cb=forged",
    });
    expect(response.status).toBe(403);
    expect(mockD1Query).not.toHaveBeenCalled();
    expect(mockSetCache).not.toHaveBeenCalled();
  });

  test("rejects an oversized body", async () => {
    const response = await postWebhook({
      body: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(mockD1Query).not.toHaveBeenCalled();
  });
});
