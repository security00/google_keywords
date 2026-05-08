import { d1Query } from "./d1";

export type GameOpportunityVerdict = "worth_doing" | "not_worth_doing";

export type GameOpportunityFeedback = {
  opportunityId: string;
  keyword: string;
  verdict: GameOpportunityVerdict;
  note: string | null;
  updatedAt: string;
};

type FeedbackRow = {
  opportunity_id: string;
  keyword: string;
  verdict: GameOpportunityVerdict;
  note: string | null;
  updated_at: string;
};

export const listGameOpportunityFeedback = async (
  userId: string
): Promise<GameOpportunityFeedback[]> => {
  const { rows } = await d1Query<FeedbackRow>(
    `SELECT opportunity_id, keyword, verdict, note, updated_at
     FROM game_opportunity_feedback
     WHERE user_id = ?
     ORDER BY updated_at DESC`,
    [userId]
  );

  return rows.map((row) => ({
    opportunityId: row.opportunity_id,
    keyword: row.keyword,
    verdict: row.verdict,
    note: row.note,
    updatedAt: row.updated_at,
  }));
};

const normalizeOpportunityId = (value: string) => {
  const opportunityId = value.trim();
  if (!opportunityId) throw new Error("opportunityId is required");
  return opportunityId;
};

export const upsertGameOpportunityFeedback = async (
  userId: string,
  input: {
    opportunityId: string;
    keyword: string;
    verdict: string;
    note?: string | null;
  }
) => {
  const opportunityId = normalizeOpportunityId(input.opportunityId);

  const keyword = input.keyword.trim();
  if (!keyword) throw new Error("keyword is required");

  if (input.verdict !== "worth_doing" && input.verdict !== "not_worth_doing") {
    throw new Error("Invalid verdict");
  }

  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;

  await d1Query(
    `INSERT INTO game_opportunity_feedback
       (user_id, opportunity_id, keyword, verdict, note, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, opportunity_id) DO UPDATE SET
       keyword = excluded.keyword,
       verdict = excluded.verdict,
       note = excluded.note,
       updated_at = datetime('now')`,
    [userId, opportunityId, keyword, input.verdict, note]
  );
};

export const deleteGameOpportunityFeedback = async (
  userId: string,
  opportunityIdInput: string
) => {
  const opportunityId = normalizeOpportunityId(opportunityIdInput);
  await d1Query(
    `DELETE FROM game_opportunity_feedback
     WHERE user_id = ? AND opportunity_id = ?`,
    [userId, opportunityId]
  );
};
