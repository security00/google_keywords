import { NextResponse } from "next/server";

import { isAuthzError, requirePaidApiPermission } from "@/lib/authz";

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";

function buildAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("DataForSEO credentials not configured");
  const encoded = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

export async function POST(request: Request) {
  const principal = await requirePaidApiPermission(request);
  if (isAuthzError(principal)) return principal;

  const body = await request.json();
  const { keyword, months = 12, benchmark = "gpts" } = body;

  if (!keyword || typeof keyword !== "string") {
    return NextResponse.json({ error: "keyword required" }, { status: 400 });
  }

  try {
    const response = await fetch(`${DATAFORSEO_BASE}/keywords_data/google_trends/explore/live`, {
      method: "POST",
      headers: {
        "Authorization": buildAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{
        keywords: [keyword, benchmark],
        location_code: 2840,
        language_code: "en",
        date_from: new Date(Date.now() - months * 30 * 86400000).toISOString().slice(0, 10),
        date_to: new Date().toISOString().slice(0, 10),
        type: "web",
      }]),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: `DataForSEO ${response.status}: ${text}` }, { status: 502 });
    }

    const data = await response.json();

    // DEBUG: capture raw structure for first item
    let debugRaw: string | null = null;

    // Build keyword-indexed data
    // DataForSEO returns one item per keyword position
    const keywordSeries: Array<{ date: string; value: number }> = [];
    const benchmarkSeries: Array<{ date: string; value: number }> = [];
    for (const task of data.tasks || []) {
      for (const result of task.result || []) {
        for (const item of result.items || []) {
          if (item.type !== "google_trends_graph") continue;
          const kwIdx = (item.keywords as string[])?.indexOf(keyword) ?? -1;
          const bmIdx = (item.keywords as string[])?.indexOf(benchmark) ?? -1;
          const points = item.data || [];
          if (!debugRaw && points.length > 0) {
            debugRaw = JSON.stringify(points[0]);
          }
          for (const point of points) {
            const date = point.date_from || point.date || "";
            if (!date) continue;
            const ds = date.slice(0, 10);
            const vals = point.values as number[];
            if (kwIdx >= 0 && vals && vals.length > kwIdx) {
              keywordSeries.push({ date: ds, value: vals[kwIdx] });
            }
            if (bmIdx >= 0 && vals && vals.length > bmIdx) {
              benchmarkSeries.push({ date: ds, value: vals[bmIdx] });
            }
          }
        }
      }
    }

    return NextResponse.json({
      keyword, benchmark, months,
      points: keywordSeries.length,
      series: keywordSeries,
      benchmarkSeries,
      cost: {
        estimatedCostUsd: null,
        actualCostUsd: typeof data.cost === "number" ? data.cost : null,
      },
      _debug: debugRaw,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Trends fetch failed: ${msg}` }, { status: 502 });
  }
}
