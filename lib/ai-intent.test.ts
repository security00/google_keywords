import { describe, expect, test, vi } from "vitest";

import { inferIntentWithModel } from "./ai-intent";
import type { ChatCompletionClient } from "./providers/llm";

describe("intent model core", () => {
  test("uses an injected LLM client and normalizes the returned intent", async () => {
    const complete = vi.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            intents: [{
              keyword: "alpha tool",
              label: "AI Tools",
              demand: "Build an AI utility",
              reason: "Tool results dominate",
              confidence: 0.9,
            }],
          }),
        },
      }],
    });
    const llmClient: ChatCompletionClient = {
      provider: "test",
      model: "test-model",
      complete,
    };

    const intents = await inferIntentWithModel([{
      keyword: "alpha tool",
      itemTypes: ["organic"],
      itemTypeCounts: { organic: 3 },
      topResults: [{ title: "Alpha" }],
    }], { llmClient });

    expect(intents.get("alpha tool")).toMatchObject({
      label: "AI Tools",
      confidence: 0.9,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  test("explicitly missing credentials produce a safe empty result", async () => {
    const intents = await inferIntentWithModel([], { llmClient: null });
    expect(intents.size).toBe(0);
  });
});
