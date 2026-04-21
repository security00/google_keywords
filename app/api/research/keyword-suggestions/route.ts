import { NextResponse } from "next/server";

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";

function buildAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("DataForSEO credentials not configured");
  // btoa not available in all edge runtimes, use Buffer
  const encoded = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

async function requireAuth(request: Request): Promise<boolean> {
  const cronSecret = request.headers.get("x-cron-secret");
  if (cronSecret && cronSecret === process.env.CRON_SECRET) return true;
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7).trim();
    if (apiKey.startsWith("gk_live_")) return true;
  }
  return false;
}

export async function POST(request: Request) {
  if (!(await requireAuth(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { keyword, limit = 20 } = body;

  if (!keyword || typeof keyword !== "string") {
    return NextResponse.json({ error: "keyword required" }, { status: 400 });
  }

  try {
    const authHeader = buildAuthHeader();
    console.log(`[keyword-suggestions] Fetching suggestions for: ${keyword}, limit: ${limit}`);
    const response = await fetch(`${DATAFORSEO_BASE}/dataforseo_labs/google/keyword_suggestions/live`, {
      method: "POST",
      headers: {
        "Authorization": buildAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{
        keyword,
        location_code: 2840,
        language_code: "en",
        include_seed_keyword: true,
        limit: Math.min(limit, 100),
      }]),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: `DataForSEO ${response.status}: ${text}` }, { status: 502 });
    }

    const data = await response.json();

    // Extract and simplify results
    const items: Array<{
      keyword: string;
      volume: number;
      cpc: number;
      competition: string;
      kd: number;
    }> = [];

    for (const task of data.tasks || []) {
      for (const result of task.result || []) {
        for (const item of result.items || []) {
          const info = item.keyword_info || {};
          const props = item.keyword_properties || {};
          items.push({
            keyword: item.keyword || "",
            volume: info.search_volume || 0,
            cpc: info.cpc || 0,
            competition: info.competition_level || "",
            kd: props.keyword_difficulty || 0,
          });
        }
      }
    }

    return NextResponse.json({
      seed: keyword,
      count: items.length,
      items,
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
