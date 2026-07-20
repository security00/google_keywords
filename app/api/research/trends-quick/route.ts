import { NextResponse } from "next/server";

import { isAuthzError, requirePaidApiPermission } from "@/lib/authz";
import {
  DATAFORSEO_ENDPOINTS,
  getPlatformDataForSeoClient,
} from "@/lib/providers/dataforseo";
import {
  extractRootCost,
  parseLiveTrendsResponse,
} from "@/lib/providers/dataforseo-parsers";

export async function POST(request: Request) {
  const principal = await requirePaidApiPermission(request);
  if (isAuthzError(principal)) return principal;

  const body = await request.json();
  const { keyword, months = 12, benchmark = "gpts" } = body;

  if (!keyword || typeof keyword !== "string") {
    return NextResponse.json({ error: "keyword required" }, { status: 400 });
  }

  try {
    const providerClient = getPlatformDataForSeoClient();
    const data = await providerClient.request("post", DATAFORSEO_ENDPOINTS.trendsLive, {
      body: JSON.stringify([{
        keywords: [keyword, benchmark],
        location_code: 2840,
        language_code: "en",
        date_from: new Date(Date.now() - months * 30 * 86400000).toISOString().slice(0, 10),
        date_to: new Date().toISOString().slice(0, 10),
        type: "web",
      }]),
    }, 1);
    const { keywordSeries, benchmarkSeries, debugRaw } =
      parseLiveTrendsResponse(data, keyword, benchmark);

    return NextResponse.json({
      keyword, benchmark, months,
      points: keywordSeries.length,
      series: keywordSeries,
      benchmarkSeries,
      cost: {
        estimatedCostUsd: null,
        actualCostUsd: extractRootCost(data),
      },
      _debug: debugRaw,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Trends fetch failed: ${msg}` }, { status: 502 });
  }
}
