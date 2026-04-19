import { NextResponse } from "next/server";

import { buildCacheKey, setCache } from "@/lib/cache";
import type { ExpandResponse } from "@/lib/types";
import { organizeCandidates, flattenOrganizedCandidates } from "@/lib/keyword-research";

const TRIM_LIMIT = 200;

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

  // Store full version
  await setCache(cacheKey, {
    ...response,
    fromCache: false,
  });

  // Store trimmed version for lightweight fallback (avoids Worker CPU timeout on 400KB+ payloads)
  if (response.flatList.length > TRIM_LIMIT) {
    const fullOrganized = organizeCandidates(response.candidates);
    const sectionKeys = ["explosive", "fastRising", "steadyRising", "slowRising"] as const;
    const baseQuota = Math.floor(TRIM_LIMIT / sectionKeys.length);
    const trimmedOrganized = {
      explosive: fullOrganized.explosive.slice(0, baseQuota),
      fastRising: fullOrganized.fastRising.slice(0, baseQuota),
      steadyRising: fullOrganized.steadyRising.slice(0, baseQuota),
      slowRising: fullOrganized.slowRising.slice(0, baseQuota),
    };
    const trimmedCandidates = flattenOrganizedCandidates(trimmedOrganized);
    await setCache(cacheKey + ":_trimmed", {
      ...response,
      candidates: trimmedCandidates,
      organized: trimmedOrganized,
      flatList: trimmedCandidates,
      totalCandidates: response.flatList.length,
      returnedCandidates: trimmedCandidates.length,
      hasMoreCandidates: true,
      fromCache: false,
    });
  }

  return NextResponse.json({
    ok: true,
    cacheKey,
    candidates: response.candidates.length,
    flatList: response.flatList.length,
  });
}
