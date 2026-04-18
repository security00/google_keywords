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

export const buildPrecomputeHealthCacheKey = (sharedDate: string) =>
  `${HEALTH_PREFIX}${sharedDate}`;

export async function writePrecomputeHealth(
  health: PrecomputeHealth
): Promise<void> {
  await setCache(buildPrecomputeHealthCacheKey(health.sharedDate), health);
}

export async function getPrecomputeHealth(
  sharedDate: string
): Promise<PrecomputeHealth | null> {
  return getCached<PrecomputeHealth>(buildPrecomputeHealthCacheKey(sharedDate));
}

export async function listRecentPrecomputeHealth(
  limit = 7
): Promise<PrecomputeHealth[]> {
  const { rows } = await d1Query<{
    cache_key: string;
    response_data: string;
    created_at: string;
  }>(
    `SELECT cache_key, response_data, created_at
     FROM query_cache
     WHERE substr(cache_key, 1, ?) = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [HEALTH_PREFIX.length, HEALTH_PREFIX, limit]
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
