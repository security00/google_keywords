import { NextResponse } from "next/server";

import { isAuthzError, requirePaidApiPermission } from "@/lib/authz";
import {
  DATAFORSEO_ENDPOINTS,
  getPlatformDataForSeoClient,
} from "@/lib/providers/dataforseo";
import {
  extractRootCost,
  parseKeywordSuggestionsResponse,
} from "@/lib/providers/dataforseo-parsers";

export async function POST(request: Request) {
  const principal = await requirePaidApiPermission(request);
  if (isAuthzError(principal)) return principal;

  const body = await request.json();
  const { keyword, limit = 20 } = body;

  if (!keyword || typeof keyword !== "string") {
    return NextResponse.json({ error: "keyword required" }, { status: 400 });
  }

  try {
    console.log(`[keyword-suggestions] Fetching suggestions for: ${keyword}, limit: ${limit}`);
    const providerClient = getPlatformDataForSeoClient();
    const data = await providerClient.request("post", DATAFORSEO_ENDPOINTS.keywordSuggestionsLive, {
      body: JSON.stringify([{
        keyword,
        location_code: 2840,
        language_code: "en",
        include_seed_keyword: true,
        limit: Math.min(limit, 100),
      }]),
    }, 1);
    const items = parseKeywordSuggestionsResponse(data);

    return NextResponse.json({
      seed: keyword,
      count: items.length,
      items,
      cost: {
        estimatedCostUsd: null,
        actualCostUsd: extractRootCost(data),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[keyword-suggestions] Error:", msg);
    return NextResponse.json(
      { error: `DataForSEO call failed: ${msg}` },
      { status: 502 }
    );
  }
}
