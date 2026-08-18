import { gzipSync } from "zlib";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  RESEARCH_WEBHOOK_MAX_RAW_BYTES,
  RESEARCH_WEBHOOK_TOKEN_PARAM,
  ResearchWebhookLimitError,
  ResearchWebhookTokenError,
  appendResearchWebhookToken,
  assertResearchWebhookToken,
  decodeResearchWebhookBody,
  signResearchWebhookToken,
} from "./research-webhook";

describe("research webhook helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("leaves postback URLs unchanged when no signing secret is configured", () => {
    vi.stubEnv("RESEARCH_WEBHOOK_TOKEN_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("GK_CRON_SECRET", "");
    expect(
      appendResearchWebhookToken(
        "https://discoverkeywords.co/api/research/webhook?type=serp&cache_key=abc",
        "abc",
        "serp"
      )
    ).toBe("https://discoverkeywords.co/api/research/webhook?type=serp&cache_key=abc");
  });

  test("appends and accepts a signed callback token", () => {
    vi.stubEnv("RESEARCH_WEBHOOK_TOKEN_SECRET", "webhook-secret");
    const token = signResearchWebhookToken("job-1", "expand");
    expect(token).toBeTruthy();
    const url = appendResearchWebhookToken(
      "https://discoverkeywords.co/api/research/webhook?type=expand&cache_key=job-1",
      "job-1",
      "expand"
    );
    expect(url).toContain(`${RESEARCH_WEBHOOK_TOKEN_PARAM}=${token}`);
    expect(() =>
      assertResearchWebhookToken({
        cacheKey: "job-1",
        apiType: "expand",
        token: token ?? null,
      })
    ).not.toThrow();
  });

  test("accepts legacy callbacks without a token unless required", () => {
    vi.stubEnv("RESEARCH_WEBHOOK_TOKEN_SECRET", "webhook-secret");
    vi.stubEnv("RESEARCH_WEBHOOK_TOKEN_REQUIRED", "");
    expect(() =>
      assertResearchWebhookToken({
        cacheKey: "job-1",
        apiType: "expand",
        token: null,
      })
    ).not.toThrow();
  });

  test("rejects a forged token and a missing token when required", () => {
    vi.stubEnv("RESEARCH_WEBHOOK_TOKEN_SECRET", "webhook-secret");
    expect(() =>
      assertResearchWebhookToken({
        cacheKey: "job-1",
        apiType: "expand",
        token: "forged",
      })
    ).toThrow(ResearchWebhookTokenError);

    vi.stubEnv("RESEARCH_WEBHOOK_TOKEN_REQUIRED", "true");
    expect(() =>
      assertResearchWebhookToken({
        cacheKey: "job-1",
        apiType: "expand",
        token: null,
      })
    ).toThrow(ResearchWebhookTokenError);
  });

  test("gunzips bounded payloads and rejects oversized bodies", () => {
    const payload = Buffer.from('{"ok":true}');
    expect(decodeResearchWebhookBody(gzipSync(payload)).toString("utf-8")).toBe(
      '{"ok":true}'
    );
    expect(decodeResearchWebhookBody(payload).toString("utf-8")).toBe('{"ok":true}');
    expect(() =>
      decodeResearchWebhookBody(Buffer.alloc(RESEARCH_WEBHOOK_MAX_RAW_BYTES + 1))
    ).toThrow(ResearchWebhookLimitError);
  });
});
