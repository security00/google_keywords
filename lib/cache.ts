/**
 * D1-based query cache.
 * Same keywords + same query type + same day = cache hit.
 * Cache expires after 24 hours (next day triggers fresh DataForSEO call).
 */
import { d1Query } from "./d1";

const DEFAULT_CACHE_TTL_HOURS = 24;

export type CacheNamespace =
  | "expand-result"
  | "compare-result"
  | "trends-result"
  | "serp-result"
  | "precompute-health"
  | "provider-direct"
  | "byok-semantic-filter";

export type CacheScope =
  | { type: "shared" }
  | { type: "private"; ownerId: string };

export type CacheOptions = {
  namespace: CacheNamespace;
  version?: number;
  scope?: CacheScope;
  ttlHours?: number;
  allowLegacyRead?: boolean;
};

type CacheRow = {
  id: string;
  cache_key: string;
  response_data: string;
  created_at: string;
};

const resolveTtlHours = (value?: number) => {
  const fromEnv = Number(process.env.CACHE_EXPIRY_HOURS);
  const candidate = value ?? fromEnv;
  return Number.isFinite(candidate) && candidate > 0
    ? Math.min(candidate, 24 * 30)
    : DEFAULT_CACHE_TTL_HOURS;
};

const digest = async (value: string) => {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const buildCacheIdentity = async (
  cacheKey: string,
  options: CacheOptions,
) => {
  const version = options.version ?? 2;
  const scope = options.scope ?? { type: "shared" as const };
  const ownerId = scope.type === "private" ? scope.ownerId.trim() : "";
  if (scope.type === "private" && !ownerId) {
    throw new Error("Private cache requires an ownerId");
  }
  const keyHash = await digest(
    JSON.stringify({
      namespace: options.namespace,
      version,
      scope: scope.type,
      ownerId,
      cacheKey,
    }),
  );
  return {
    id: `cache_v${version}_${keyHash}`,
    keyHash,
    namespace: options.namespace,
    version,
    scope: scope.type,
    ownerId,
  };
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
export async function getCached<T>(
  cacheKey: string,
  options: CacheOptions,
): Promise<T | null> {
  const identity = await buildCacheIdentity(cacheKey, options);
  const now = new Date().toISOString();
  const cutoff = new Date(
    Date.now() - resolveTtlHours(options.ttlHours) * 60 * 60 * 1000
  ).toISOString();

  const { rows } = await d1Query<CacheRow>(
    `SELECT cache_key, response_data, created_at
     FROM query_cache
     WHERE id = ? AND namespace = ? AND cache_version = ?
       AND cache_scope = ? AND owner_id = ? AND key_hash = ?
       AND (expires_at IS NULL OR expires_at > ?)
     LIMIT 1`,
    [
      identity.id,
      identity.namespace,
      identity.version,
      identity.scope,
      identity.ownerId,
      identity.keyHash,
      now,
    ]
  );

  if (rows.length > 0) {
    try {
      return JSON.parse(rows[0].response_data) as T;
    } catch {
      return null;
    }
  }

  if (
    identity.scope === "shared" &&
    options.allowLegacyRead !== false
  ) {
    const legacy = await d1Query<CacheRow>(
      `SELECT cache_key, response_data, created_at
       FROM query_cache
       WHERE cache_key = ? AND namespace = 'legacy'
         AND cache_scope = 'shared' AND created_at > ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [cacheKey, cutoff],
    );
    if (legacy.rows[0]) {
      try {
        return JSON.parse(legacy.rows[0].response_data) as T;
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Store a result in cache. Overwrites existing entry for same key.
 */
export async function setCache(
  cacheKey: string,
  data: unknown,
  options: CacheOptions,
): Promise<void> {
  const identity = await buildCacheIdentity(cacheKey, options);
  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + resolveTtlHours(options.ttlHours) * 60 * 60 * 1000,
  ).toISOString();

  await d1Query(
    `INSERT INTO query_cache
     (id, user_id, query_type, cache_key, response_data, created_at,
      namespace, cache_version, cache_scope, owner_id, key_hash,
      content_type, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'result', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       response_data = excluded.response_data,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
    [
      identity.id,
      identity.ownerId || null,
      identity.namespace,
      cacheKey,
      JSON.stringify(data),
      now,
      identity.namespace,
      identity.version,
      identity.scope,
      identity.ownerId,
      identity.keyHash,
      expiresAt,
      now,
    ]
  );
}
