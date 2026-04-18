import { NextResponse } from "next/server";

import { buildCacheKey, setCache } from "@/lib/cache";
import type { ExpandResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isAuthorized = (request: Request) => {
  const secret = process.env.CRON_SECRET;
  const externalSecret = process.env.EXTERNAL_CRON_SECRET;
  if (!secret && !externalSecret) return false;

  const authHeader = request.headers.get("authorization");
  if (secret && authHeader === `Bearer ${secret}`) return true;
  if (externalSecret && authHeader === `Bearer ${externalSecret}`) return true;

  const headerSecret = request.headers.get("x-cron-secret");
  if (secret && headerSecret === secret) return true;
  if (externalSecret && headerSecret === externalSecret) return true;

  return false;
};

const isExpandResponse = (value: unknown): value is ExpandResponse => {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return (
    Array.isArray(raw.keywords) &&
    typeof raw.dateFrom === "string" &&
    typeof raw.dateTo === "string" &&
    Array.isArray(raw.candidates) &&
    Array.isArray(raw.flatList) &&
    Boolean(raw.organized)
  );
};

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const response =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).response
      : null;

  if (!isExpandResponse(response)) {
    return NextResponse.json({ error: "Invalid expand response payload" }, { status: 400 });
  }

  const cacheKey = buildCacheKey("expand_result", response.keywords, {
    dateFrom: response.dateFrom,
    dateTo: response.dateTo,
  });

  await setCache(cacheKey, {
    ...response,
    fromCache: false,
  });

  return NextResponse.json({
    ok: true,
    cacheKey,
    candidates: response.candidates.length,
    flatList: response.flatList.length,
  });
}
