/**
 * Webhook endpoint for DataForSEO postback notifications.
 * 
 * DataForSEO sends gzip-compressed JSON with task results when tasks complete.
 * For SERP tasks, the `$tag` variable in postback_url carries our cache_key.
 * For Trends tasks, cache_key is embedded directly in the postback URL query.
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

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
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

  try {
    const arrayBuffer = await request.arrayBuffer();
    const rawBuffer = Buffer.from(arrayBuffer);
    const { gunzipSync } = await import("zlib");

    let payloadBuffer = rawBuffer;
    try {
      payloadBuffer = gunzipSync(rawBuffer);
    } catch {
      payloadBuffer = rawBuffer;
    }

    const resultJson = payloadBuffer.toString("utf-8");
    const parsed =
      resultJson.trim().length > 0
        ? JSON.parse(resultJson)
        : {};
    const parsedRecord = toRecord(parsed);

    // Extract params from query string first, then fall back to JSON payload.
    let cacheKey =
      request.nextUrl.searchParams.get("cache_key") ||
      request.nextUrl.searchParams.get("tag");
    let apiType = request.nextUrl.searchParams.get("type") || "unknown";
    let dfsTaskId = request.nextUrl.searchParams.get("task_id") || "";

    if (parsedRecord) {
      const body = parsedRecord;
      if (typeof body.tag === "string" && !cacheKey) cacheKey = body.tag;
      if (typeof body.type === "string" && apiType === "unknown") apiType = body.type;
      if (typeof body.task_id === "string" && !dfsTaskId) dfsTaskId = body.task_id;
    }

    const firstTask =
      Array.isArray(parsedRecord?.tasks) &&
      parsedRecord.tasks.length > 0
        ? toRecord(parsedRecord.tasks[0])
        : undefined;

    if (!dfsTaskId && typeof firstTask?.id === "string") {
      dfsTaskId = firstTask.id;
    }
    if (!cacheKey) {
      const taskData = toRecord(firstTask?.data);
      const taskTag = taskData?.tag ?? firstTask?.tag;
      if (typeof taskTag === "string") {
        cacheKey = taskTag;
      }
    }

    console.log("[webhook] received", {
      apiType,
      dfsTaskId,
      cacheKey: cacheKey?.slice(0, 80),
      size: payloadBuffer.length,
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

    // Only direct-result APIs should populate query_cache here.
    // expand/compare cache slots store jobId and must not be overwritten.
    if (cacheKey && (apiType === "serp" || apiType === "trends")) {
      await setCache(cacheKey, parsed);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[webhook] error", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
