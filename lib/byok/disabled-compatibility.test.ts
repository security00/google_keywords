import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { requireEffectiveUser } from "@/lib/authz";
import { requireProviderConnectionOwner } from "@/lib/provider-connections/api";
import {
  DATAFORSEO_ENDPOINTS,
  getPlatformDataForSeoClient,
} from "@/lib/providers/dataforseo";
import { getPlatformOpenRouterClient } from "@/lib/providers/openrouter";
import { requireByokLiveOwner } from "./api";

vi.mock("@/lib/authz", () => ({
  requireEffectiveUser: vi.fn(),
}));

const mockRequireEffectiveUser = vi.mocked(requireEffectiveUser);

describe("BYOK disabled compatibility", () => {
  beforeEach(() => {
    vi.stubEnv("BYOK_PROVIDER_CONNECTIONS_ENABLED", "false");
    vi.stubEnv("BYOK_LIVE_MODE_ENABLED", "false");
    vi.stubEnv("DATAFORSEO_LOGIN", "platform@example.com");
    vi.stubEnv("DATAFORSEO_PASSWORD", "platform-password");
    vi.stubEnv("OPENROUTER_API_KEY", "platform-openrouter-key");
    vi.stubEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test("hides management and live routes before authentication", async () => {
    const management = await requireProviderConnectionOwner(
      new Request("https://app.test/api/provider-connections"),
    );
    const live = await requireByokLiveOwner(
      new Request("https://app.test/api/research/byok/expand"),
    );

    expect(management).toBeInstanceOf(Response);
    expect((management as Response).status).toBe(404);
    expect(live).toBeInstanceOf(Response);
    expect((live as Response).status).toBe(404);
    expect(mockRequireEffectiveUser).not.toHaveBeenCalled();
  });

  test("preserves the pre-BYOK platform redirect behavior", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response('{"choices":[]}', { status: 200 }),
    );

    await getPlatformDataForSeoClient().request(
      "get",
      DATAFORSEO_ENDPOINTS.userData,
      {},
      1,
    );
    await getPlatformOpenRouterClient()?.complete({
      messages: [{ role: "user", content: "hello" }],
    }, { maxRetries: 1 });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchSpy.mock.calls) {
      expect(Object.hasOwn(init ?? {}, "redirect")).toBe(false);
    }
  });
});
