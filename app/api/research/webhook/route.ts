/**
 * Webhook endpoint for DataForSEO postback notifications.
 * 
 * DataForSEO sends gzip-compressed JSON with task results when tasks complete.
 * The `$tag` variable in postback_url carries our cache_key.
 * The `$id` variable carries the DataForSEO task_id.
 * 
 * We store raw results in postback_results table so status route can
 * use them without calling DataForSEO again (avoids Worker CPU timeout).
 * 
 * DataForSEO postback IPs (V3):
 * 144.76.154.130, 144.76.153.113, 144.76.153.106,
 * 94.130.155.89, 178.63.193.217, 94.130.93.29
 */

import { NextRequest, NextResponse } from "next/server";
import { setCache } from "@/lib/cache";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DFS_POSTBACK_IPS = new Set([
  "144.76.154.130",
  "144.76.153.113",
  "144.76.153.106",
  "94.130.155.89",
  "178.63.193.217",
  "94.130.93.29",
]);

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  // IP whitelist check (skip if WEBHOOK_SKIP_IP_CHECK env set, e.g. for testing)
  if (
    process.env.WEBHOOK_SKIP_IP_CHECK !== "true" &&
    process.env.NODE_ENV === "production" &&
    !DFS_POSTBACK_IPS.has(clientIp)
  ) {
    console.warn("[webhook] rejected IP:", clientIp);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Extract params from query string (passed via $tag and $id in postback_url)
  const cacheKey = request.nextUrl.searchParams.get("tag");
  const apiType = request.nextUrl.searchParams.get("type") || "unknown";
  const dfsTaskId = request.nextUrl.searchParams.get("task_id") || "";

  try {
    // Decompress gzip body
    const arrayBuffer = await request.arrayBuffer();
    const { gunzipSync } = await import("zlib");
    const decompressed = gunzipSync(Buffer.from(arrayBuffer));
    const resultJson = decompressed.toString("utf-8");

    console.log("[webhook] received", {
      apiType,
      dfsTaskId,
      cacheKey: cacheKey?.slice(0, 80),
      size: decompressed.length,
      ip: clientIp,
    });

    // Store raw result for status route to consume
    if (dfsTaskId) {
      const id = `pb_${dfsTaskId}`;
      const now = new Date().toISOString();
      await d1Query(
        `INSERT INTO postback_results (id, task_id, api_type, cache_key, result_data, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET result_data = excluded.result_data, created_at = excluded.created_at`,
        [id, dfsTaskId, apiType, cacheKey || null, resultJson, now]
      );
    }

    // Also store in query_cache for serp/trends direct cache hits
    if (cacheKey) {
      const data = JSON.parse(resultJson);
      await setCache(cacheKey, data);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[webhook] error", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
