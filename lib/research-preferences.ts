import "server-only";

import { d1Query } from "@/lib/d1";

export type ResearchExecutionMode = "shared" | "byok";

export const getResearchPreference = async (
  ownerId: string,
): Promise<{ executionMode: ResearchExecutionMode }> => {
  const { rows } = await d1Query<{ execution_mode: ResearchExecutionMode }>(
    `SELECT execution_mode FROM research_preferences WHERE owner_id = ? LIMIT 1`,
    [ownerId],
  );
  return { executionMode: rows[0]?.execution_mode === "byok" ? "byok" : "shared" };
};

export const updateResearchPreference = async (
  ownerId: string,
  executionMode: ResearchExecutionMode,
) => {
  if (executionMode !== "shared" && executionMode !== "byok") {
    throw new Error("INVALID_EXECUTION_MODE");
  }
  const now = new Date().toISOString();
  await d1Query(
    `INSERT INTO research_preferences (owner_id, execution_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET
       execution_mode = excluded.execution_mode,
       updated_at = excluded.updated_at`,
    [ownerId, executionMode, now, now],
  );
  return { executionMode };
};
