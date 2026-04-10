/**
 * D1-based query cache.
 * Same keywords + same query type + same day = cache hit.
 * Cache expires after 24 hours (next day triggers fresh DataForSEO call).
 */
import { d1Query } from "./d1";

const CACHE_TTL_HOURS = 24;

type CacheRow = {
  id: string;
  cache_key: string;
  response_data: string;
  created_at: string;
};

/**
 * Build a deterministic cache key from query type + keywords + optional params.
 */
export function buildCacheKey(
  queryType: string,
  keywords: string[],
  extra?: Record<string, string>
): string {
  const sorted = [...keywords].sort().join(",");
  const extraPart = extra
    ? ":" + Object.entries(extra).sort().map(([k, v]) => `${k}=${v}`).join(",")
    : "";
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${today}:${queryType}:${sorted}${extraPart}`;
}

/**
 * Try to get cached result. Returns null on miss or expiry.
 */
export async function getCached<T>(cacheKey: string): Promise<T | null> {
  const cutoff = new Date(
    Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { rows } = await d1Query<CacheRow>(
    `SELECT cache_key, response_data, created_at
     FROM query_cache
     WHERE cache_key = ? AND created_at > ?
     LIMIT 1`,
    [cacheKey, cutoff]
  );

  if (rows.length > 0) {
    try {
      return JSON.parse(rows[0].response_data) as T;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Store a result in cache. Overwrites existing entry for same key.
 */
export async function setCache(
  cacheKey: string,
  data: unknown
): Promise<void> {
  const id = `cache_${cacheKey.replace(/[:/]/g, "_").slice(0, 64)}`;
  const now = new Date().toISOString();

  await d1Query(
    `INSERT INTO query_cache (id, cache_key, response_data, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET response_data = excluded.response_data, created_at = excluded.created_at`,
    [id, cacheKey, JSON.stringify(data), now]
  );
}
