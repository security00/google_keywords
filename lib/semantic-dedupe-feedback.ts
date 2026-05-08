import { d1Query } from "./d1";

export type SemanticDedupeVerdict = "merge" | "separate";

export type SemanticDedupeFeedback = {
  semanticKey: string;
  verdict: SemanticDedupeVerdict;
  representativeKeyword: string;
  variants: string[];
  note: string | null;
  updatedAt: string;
};

type FeedbackRow = {
  semantic_key: string;
  verdict: SemanticDedupeVerdict;
  representative_keyword: string;
  variants_json: string;
  note: string | null;
  updated_at: string;
};

const parseVariants = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
};

export const listSemanticDedupeFeedback = async (
  userId: string
): Promise<SemanticDedupeFeedback[]> => {
  const { rows } = await d1Query<FeedbackRow>(
    `SELECT semantic_key, verdict, representative_keyword, variants_json, note, updated_at
     FROM semantic_dedupe_feedback
     WHERE user_id = ?
     ORDER BY updated_at DESC`,
    [userId]
  );

  return rows.map((row) => ({
    semanticKey: row.semantic_key,
    verdict: row.verdict,
    representativeKeyword: row.representative_keyword,
    variants: parseVariants(row.variants_json),
    note: row.note,
    updatedAt: row.updated_at,
  }));
};

export const upsertSemanticDedupeFeedback = async (
  userId: string,
  input: {
    semanticKey: string;
    verdict: string;
    representativeKeyword: string;
    variants: string[];
    note?: string | null;
  }
) => {
  const semanticKey = input.semanticKey.trim().toLowerCase();
  if (!semanticKey) throw new Error("semanticKey is required");
  if (input.verdict !== "merge" && input.verdict !== "separate") {
    throw new Error("Invalid verdict");
  }

  const representativeKeyword = input.representativeKeyword.trim();
  if (!representativeKeyword) throw new Error("representativeKeyword is required");

  const variants = input.variants
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (variants.length === 0) throw new Error("variants are required");

  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;

  await d1Query(
    `INSERT INTO semantic_dedupe_feedback
       (user_id, semantic_key, verdict, representative_keyword, variants_json, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, semantic_key) DO UPDATE SET
       verdict = excluded.verdict,
       representative_keyword = excluded.representative_keyword,
       variants_json = excluded.variants_json,
       note = excluded.note,
       updated_at = datetime('now')`,
    [
      userId,
      semanticKey,
      input.verdict,
      representativeKeyword,
      JSON.stringify(variants),
      note,
    ]
  );
};
