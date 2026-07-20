import { getCached, setCache } from "@/lib/cache";
import { d1Query } from "@/lib/d1";

export type PrecomputeHealth = {
  sharedDate: string;
  status: string;
  stage: string;
  updatedAt?: string | null;
  stageStartedAt?: string | null;
  expandCompletedAt?: string | null;
  compareCompletedAt?: string | null;
  intentCompletedAt?: string | null;
  expandJobId?: string | null;
  compareJobId?: string | null;
  intentJobId?: string | null;
};

const HEALTH_PREFIX = "precompute_health:";
const HEALTH_TTL_HOURS = 24 * 14;

export const buildPrecomputeHealthCacheKey = (sharedDate: string) =>
  `${HEALTH_PREFIX}${sharedDate}`;

export async function writePrecomputeHealth(
  health: PrecomputeHealth
): Promise<void> {
  await setCache(buildPrecomputeHealthCacheKey(health.sharedDate), health, {
    namespace: "precompute-health",
    ttlHours: HEALTH_TTL_HOURS,
  });
}

export async function getPrecomputeHealth(
  sharedDate: string
): Promise<PrecomputeHealth | null> {
  return getCached<PrecomputeHealth>(buildPrecomputeHealthCacheKey(sharedDate), {
    namespace: "precompute-health",
    ttlHours: HEALTH_TTL_HOURS,
  });
}

export async function listRecentPrecomputeHealth(
  limit = 7
): Promise<PrecomputeHealth[]> {
  const now = new Date().toISOString();
  const legacyCutoff = new Date(
    Date.now() - HEALTH_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();
  const { rows } = await d1Query<{
    cache_key: string;
    response_data: string;
    created_at: string;
  }>(
    `SELECT cache_key, response_data, created_at
     FROM query_cache
     WHERE substr(cache_key, 1, ?) = ?
       AND cache_scope = 'shared'
       AND (
         (namespace = 'precompute-health' AND expires_at > ?)
         OR (namespace = 'legacy' AND created_at > ?)
       )
     ORDER BY created_at DESC
     LIMIT ?`,
    [HEALTH_PREFIX.length, HEALTH_PREFIX, now, legacyCutoff, limit]
  );

  const items: PrecomputeHealth[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.response_data) as PrecomputeHealth;
      if (!parsed.sharedDate) continue;
      items.push(parsed);
    } catch {
      continue;
    }
  }

  return items;
}
