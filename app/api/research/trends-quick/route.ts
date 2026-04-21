import { NextResponse } from "next/server";
import { d1Query } from "@/lib/d1";
import { requireAdmin } from "@/lib/admin";

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";

function buildAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("DataForSEO credentials not configured");
  const encoded = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

async function checkAuth(request: Request): Promise<boolean> {
  const cronSecret = request.headers.get("x-cron-secret");
  if (cronSecret && cronSecret === process.env.CRON_SECRET) return true;
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7).trim();
    if (apiKey.startsWith("gk_live_")) return true;
  }
  const { error } = await requireAdmin();
  return !error;
}

export async function POST(request: Request) {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { keyword, months = 12 } = body;

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
        keywords: [keyword],
        location_code: 2840,
        language_code: "en",
        time_range: `past_${months}_months`,
        item_types: ["google_trends_graph"],
      }]),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: `DataForSEO ${response.status}: ${text}` }, { status: 502 });
    }

    const data = await response.json();

    // Extract trend series
    const series: Array<{ date: string; value: number }> = [];
    for (const task of data.tasks || []) {
      for (const result of task.result || []) {
        for (const item of result.items || []) {
          if (item.type !== "google_trends_graph") continue;
          const points = item.data || [];
          for (const point of points) {
            const date = point.date_from || point.date || "";
            const value = typeof point.value === "number" ? point.value :
                          (point.value?.value ?? 0);
            if (date) series.push({ date: date.slice(0, 10), value: Number(value) });
          }
        }
      }
    }

    return NextResponse.json({ keyword, months, points: series.length, series });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Trends fetch failed: ${msg}` }, { status: 502 });
  }
}
