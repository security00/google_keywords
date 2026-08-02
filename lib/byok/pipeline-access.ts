import "server-only";

import { d1Query } from "@/lib/d1";
import { getByokSpendControls } from "@/lib/byok/spend-controls";
import {
  loadProviderConnectionByProvider,
  type StoredProviderConnection,
} from "@/lib/provider-connections/store";

export type VerifiedPipelineConnections = Readonly<{
  dataforseo: StoredProviderConnection;
  openrouter: StoredProviderConnection;
}>;

export class ByokPipelineAccessError extends Error {
  readonly code: "CONNECTIONS_REQUIRED" | "CONNECTION_NOT_VERIFIED" | "PERSISTENCE_ERROR";
  constructor(code: ByokPipelineAccessError["code"]) {
    super(code);
    this.name = "ByokPipelineAccessError";
    this.code = code;
  }
}

export const loadPipelineConnections = async (
  ownerId: string,
): Promise<VerifiedPipelineConnections> => {
  let dataforseo: StoredProviderConnection | null;
  let openrouter: StoredProviderConnection | null;
  try {
    [dataforseo, openrouter] = await Promise.all([
      loadProviderConnectionByProvider(ownerId, "dataforseo"),
      loadProviderConnectionByProvider(ownerId, "openrouter"),
    ]);
  } catch {
    throw new ByokPipelineAccessError("PERSISTENCE_ERROR");
  }
  if (!dataforseo || !openrouter) {
    throw new ByokPipelineAccessError("CONNECTIONS_REQUIRED");
  }
  if (dataforseo.verificationStatus !== "valid" || openrouter.verificationStatus !== "valid") {
    throw new ByokPipelineAccessError("CONNECTION_NOT_VERIFIED");
  }
  return { dataforseo, openrouter };
};

export const loadPipelineReadiness = async (ownerId: string) => {
  const [dataforseo, openrouter, controls, usage] = await Promise.all([
    loadProviderConnectionByProvider(ownerId, "dataforseo").catch(() => null),
    loadProviderConnectionByProvider(ownerId, "openrouter").catch(() => null),
    getByokSpendControls(ownerId),
    d1Query<{ spent: number; active: number }>(
      `SELECT
         (SELECT COALESCE(SUM(estimated_cost_micro_usd), 0) / 1000000.0
          FROM byok_cost_quotes WHERE owner_id = ?
            AND updated_at >= datetime('now', 'start of day')
            AND status IN ('reserved', 'committed')) AS spent,
         ((SELECT COUNT(*) FROM byok_pipeline_runs
            WHERE owner_id = ? AND status = 'processing')
          + (SELECT COUNT(*) FROM research_jobs WHERE user_id = ?
            AND execution_mode = 'byok' AND status IN ('pending', 'processing'))) AS active`,
      [ownerId, ownerId, ownerId],
    ).catch(() => ({ rows: [{ spent: 0, active: 0 }] })),
  ]);
  const current = usage.rows[0] ?? { spent: 0, active: 0 };
  return {
    ready: dataforseo?.verificationStatus === "valid" && openrouter?.verificationStatus === "valid",
    providers: {
      dataforseo: { configured: Boolean(dataforseo), verified: dataforseo?.verificationStatus === "valid" },
      openrouter: { configured: Boolean(openrouter), verified: openrouter?.verificationStatus === "valid" },
    },
    budget: {
      dailyBudgetUsd: controls.dailyBudgetUsd,
      spentUsd: Number(current.spent ?? 0),
      remainingUsd: Number(Math.max(0, controls.dailyBudgetUsd - Number(current.spent ?? 0)).toFixed(6)),
    },
    concurrency: {
      limit: controls.maxConcurrentJobs,
      active: Number(current.active ?? 0),
      available: Number(current.active ?? 0) < controls.maxConcurrentJobs,
    },
  };
};
