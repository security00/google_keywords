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

export const GAME_TREND_SCANNER_MAX_SILENCE_MS = 36 * 60 * 60 * 1000;

export type PipelineSilenceAlert = {
  pipeline: "game-trend-scanner";
  stale: boolean;
  lastSuccessAt: string | null;
  message: string;
};

export const gameTrendScannerSilence = (
  lastSuccessAt: string | null,
  nowMs: number,
): PipelineSilenceAlert => {
  const parsed = lastSuccessAt ? Date.parse(lastSuccessAt) : Number.NaN;
  const ageMs = Number.isFinite(parsed) ? nowMs - parsed : Number.NaN;
  const stale = !Number.isFinite(ageMs) || ageMs > GAME_TREND_SCANNER_MAX_SILENCE_MS;
  const ageHours = Number.isFinite(ageMs) ? Math.floor(ageMs / (60 * 60 * 1000)) : null;
  return {
    pipeline: "game-trend-scanner",
    stale,
    lastSuccessAt,
    message: stale
      ? ageHours === null
        ? "新游扫描没有成功记录。每天 10:00 UTC 的定时任务可能没有挂上。"
        : `新游扫描已经 ${ageHours} 小时没有成功记录，超过 36 小时。`
      : "新游扫描在 36 小时内有成功记录。",
  };
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
