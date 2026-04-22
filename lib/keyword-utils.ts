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
