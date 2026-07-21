import { describe, expect, test, vi } from "vitest";

import {
  DATAFORSEO_API_BASE_URL,
  DATAFORSEO_ENDPOINTS,
  createDataForSeoClient,
} from "./dataforseo";
import {
  extractRootCost,
  parseKeywordSuggestionsResponse,
  parseLiveTrendsResponse,
} from "./dataforseo-parsers";
import { createJsonHttpTransport } from "./json-http";
import {
  OPENROUTER_API_BASE_URL,
  createOpenRouterClient,
} from "./openrouter";
import {
  extractChatResponseText,
  extractJsonObject,
} from "./chat-response";

describe("provider transports", () => {
  test("DataForSEO uses only the official endpoint and injects Basic auth", async () => {
    const request = vi.fn().mockResolvedValue({ status_code: 20000 });
    const client = createDataForSeoClient(
      { login: "account@example.com", password: "secret" },
      { transport: { request } },
    );

    await client.request(
      "post",
      DATAFORSEO_ENDPOINTS.trendsTaskPost,
      { body: "[]" },
    );

    const [, url, options] = request.mock.calls[0];
    expect(url).toBe(
      `${DATAFORSEO_API_BASE_URL}${DATAFORSEO_ENDPOINTS.trendsTaskPost}`,
    );
    const headers = new Headers(options.headers);
    expect(headers.get("Authorization")).toBe(
      `Basic ${Buffer.from("account@example.com:secret").toString("base64")}`,
    );
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(options.redirect).toBe("error");
  });

  test("OpenRouter BYOK adapter fixes the official URL and model in transport", async () => {
    const request = vi.fn().mockResolvedValue({ choices: [] });
    const client = createOpenRouterClient(
      { apiKey: "or-key" },
      { model: "test/model", transport: { request } },
    );

    await client.complete({
      messages: [{ role: "user", content: "hello" }],
      temperature: 0,
    });

    const [, url, options] = request.mock.calls[0];
    expect(url).toBe(`${OPENROUTER_API_BASE_URL}/chat/completions`);
    expect(new Headers(options.headers).get("Authorization")).toBe(
      "Bearer or-key",
    );
    expect(JSON.parse(options.body)).toMatchObject({
      model: "test/model",
      temperature: 0,
    });
    expect(options.redirect).toBe("error");
  });

  test("JSON transport preserves bounded retry and timeout behavior", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"status_message":"temporary"}', {
        status: 503,
        statusText: "Unavailable",
      }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const sleepImpl = vi.fn().mockResolvedValue(undefined);
    const transport = createJsonHttpTransport({ fetchImpl, sleepImpl });

    const result = await transport.request("get", "https://example.test", {}, 2);

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(5_000);
  });
});
describe("pure provider response parsers", () => {
  test("parses keyword suggestions without transport or environment state", () => {
    const response = {
      cost: 0.02,
      tasks: [{
        result: [{
          items: [{
            keyword: "alpha tool",
            keyword_info: {
              search_volume: 1200,
              cpc: 1.25,
              competition_level: "LOW",
            },
            keyword_properties: { keyword_difficulty: 18 },
          }],
        }],
      }],
    };

    expect(parseKeywordSuggestionsResponse(response)).toEqual([{
      keyword: "alpha tool",
      volume: 1200,
      cpc: 1.25,
      competition: "LOW",
      kd: 18,
    }]);
    expect(extractRootCost(response)).toBe(0.02);
  });

  test("parses paired live Trends series by keyword position", () => {
    const parsed = parseLiveTrendsResponse({
      tasks: [{
        result: [{
          items: [{
            type: "google_trends_graph",
            keywords: ["alpha", "gpts"],
            data: [
              { date_from: "2026-07-01T00:00:00Z", values: [20, 10] },
              { date: "2026-07-08", values: [30, 15] },
            ],
          }],
        }],
      }],
    }, "alpha", "gpts");

    expect(parsed.keywordSeries).toEqual([
      { date: "2026-07-01", value: 20 },
      { date: "2026-07-08", value: 30 },
    ]);
    expect(parsed.benchmarkSeries).toEqual([
      { date: "2026-07-01", value: 10 },
      { date: "2026-07-08", value: 15 },
    ]);
  });

  test("normalizes common chat response shapes and strict JSON blocks", () => {
    const text = extractChatResponseText({
      choices: [{ message: { content: 'result: {"blocked":[]}' } }],
    });
    expect(extractJsonObject(text)).toEqual({ blocked: [] });
  });
});
