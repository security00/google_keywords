export const normalizeKeywords = (keywords: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of keywords) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }

  return result;
};

export const createBatches = <T,>(items: T[], batchSize: number) => {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
};

export const normalizeFilterTerms = (terms: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const cleaned = term.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }
  return result;
};

const SAFE_TRAILING_GAME_MODIFIERS = new Set([
  "game",
  "online",
  "play",
  "free",
]);

const PROTECTED_INTENT_MODIFIERS = new Set([
  "answer",
  "answers",
  "apk",
  "build",
  "codes",
  "code",
  "download",
  "guide",
  "hack",
  "mod",
  "mods",
  "skin",
  "skins",
  "tier",
  "wiki",
]);

export type SemanticKeywordKey = {
  key: string;
  confidence: "high" | "medium";
  reason: string;
};

export type SemanticKeywordCandidate = {
  id: string;
  keyword: string;
  score?: number;
  extractedAt?: string;
};

export type SemanticKeywordGroup = {
  semanticKey: string;
  representative: SemanticKeywordCandidate;
  variants: SemanticKeywordCandidate[];
  confidence: "high" | "medium";
  reason: string;
};

export const buildSemanticKeywordKey = (keyword: string): SemanticKeywordKey => {
  const normalized = keyword
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return { key: "", confidence: "medium", reason: "empty keyword" };
  }

  const words = normalized.split(" ");
  while (words.length > 1 && SAFE_TRAILING_GAME_MODIFIERS.has(words[words.length - 1])) {
    words.pop();
  }

  const protectedIntent = words.some((word) => PROTECTED_INTENT_MODIFIERS.has(word));
  let key = words.join(" ");
  let reason = key === normalized ? "punctuation/case normalized" : "safe trailing game modifier removed";
  let confidence: SemanticKeywordKey["confidence"] = key === normalized ? "medium" : "high";

  if (!protectedIntent && words.length >= 3 && /^\d+$/.test(words[words.length - 1])) {
    key = words.slice(0, -1).join(" ");
    reason = "numeric sequel/version suffix removed";
    confidence = "medium";
  }

  return {
    key,
    confidence,
    reason,
  };
};

const compareSemanticCandidates = (
  a: SemanticKeywordCandidate,
  b: SemanticKeywordCandidate
) => {
  const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
  if (scoreDiff !== 0) return scoreDiff;

  const aTs = Date.parse(a.extractedAt ?? "") || 0;
  const bTs = Date.parse(b.extractedAt ?? "") || 0;
  if (bTs !== aTs) return bTs - aTs;

  return a.keyword.localeCompare(b.keyword);
};

export const groupSemanticKeywordCandidates = (
  candidates: SemanticKeywordCandidate[]
): SemanticKeywordGroup[] => {
  const grouped = new Map<
    string,
    { keyInfo: SemanticKeywordKey; items: SemanticKeywordCandidate[] }
  >();

  for (const candidate of candidates) {
    const keyInfo = buildSemanticKeywordKey(candidate.keyword);
    if (!keyInfo.key) continue;
    const existing = grouped.get(keyInfo.key);
    if (existing) {
      existing.items.push(candidate);
      if (keyInfo.confidence === "high") existing.keyInfo = keyInfo;
    } else {
      grouped.set(keyInfo.key, { keyInfo, items: [candidate] });
    }
  }

  return Array.from(grouped.entries())
    .filter(([, group]) => group.items.length > 1)
    .map(([semanticKey, group]) => {
      const variants = [...group.items].sort(compareSemanticCandidates);
      return {
        semanticKey,
        representative: variants[0],
        variants,
        confidence: group.keyInfo.confidence,
        reason: group.keyInfo.reason,
      };
    })
    .sort((a, b) => b.variants.length - a.variants.length || a.semanticKey.localeCompare(b.semanticKey));
};
