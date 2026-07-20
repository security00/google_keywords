import { describe, expect, test, vi } from "vitest";

import type { ChatCompletionClient } from "../providers/llm";
import { filterCandidatesWithKeywordModel } from "./ai-filter";

describe("keyword semantic filter core", () => {
  test("uses an injected LLM adapter and preserves rule/result behavior", async () => {
    const complete = vi.fn().mockResolvedValue({
      choices: [{
        message: { content: '{"blocked":["celebrity news"]}' },
      }],
    });
    const llmClient: ChatCompletionClient = {
      provider: "test",
      model: "test-model",
      complete,
    };
    const candidates = [
      { keyword: "ai workflow builder", value: 120, type: "rising" as const, source: "seed" },
      { keyword: "celebrity news", value: 200, type: "rising" as const, source: "seed" },
    ];

    const result = await filterCandidatesWithKeywordModel(
      candidates,
      { enabled: true, model: "ignored-platform-model", terms: [] },
      { llmClient, maxCandidates: 50, batchSize: 10 },
    );

    expect(result.filtered.map((item) => item.keyword)).toEqual([
      "ai workflow builder",
    ]);
    expect(result.blocked.map((item) => item.keyword)).toEqual([
      "celebrity news",
    ]);
    expect(result.summary.model).toBe("test-model");
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
