import { d1Query } from "@/lib/d1";

export type GameRadarSourceUpdate = {
  id: string;
  enabled?: boolean;
  qualityTier?: number;
  statusNote?: string | null;
};

const validateUpdate = (input: GameRadarSourceUpdate) => {
  if (!input.id.trim()) throw new Error("Source id is required");
  if (input.qualityTier !== undefined && (!Number.isInteger(input.qualityTier) || input.qualityTier < 1 || input.qualityTier > 99)) {
    throw new Error("Invalid quality tier");
  }
  if (input.statusNote !== undefined && input.statusNote !== null && input.statusNote.length > 500) {
    throw new Error("Status note is too long");
  }
};

export const updateGameRadarSource = async (input: GameRadarSourceUpdate) => {
  validateUpdate(input);
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(input.enabled ? 1 : 0);
  }
  if (input.qualityTier !== undefined) {
    sets.push("quality_tier = ?");
    params.push(input.qualityTier);
  }
  if (input.statusNote !== undefined) {
    sets.push("status_note = ?");
    params.push(input.statusNote?.trim() || null);
  }

  if (!sets.length) throw new Error("No source changes provided");
  sets.push("updated_at = datetime('now')");
  params.push(input.id);

  const result = await d1Query(
    `UPDATE game_radar_sources SET ${sets.join(", ")} WHERE id = ? RETURNING id`,
    params
  );
  if (!result.rows.length) throw new Error("Source not found");
};
