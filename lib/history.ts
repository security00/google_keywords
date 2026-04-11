/**
 * Keyword history tracking and AI filter caching.
 */
import { d1Query } from "./d1";
import { randomUUID } from "crypto";

// --- Keyword History ---

export async function saveKeywordHistory(
  candidates: Array<{ keyword: string; value: number; type: string; source: string }>
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = candidates.map((c) => [
    randomUUID(),
    c.keyword,
    c.keyword.toLowerCase().trim(),
    c.value ?? 0,
    c.type,
    c.source,
    today,
    new Date().toISOString(),
  ]);
  
  if (rows.length === 0) return;
  
  // Batch insert (50 at a time)
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const placeholders = batch.map(() => "(?,?,?,?,?,?,?,?)").join(",");
    const values = batch.flat();
    await d1Query(
      `INSERT OR IGNORE INTO keyword_history (id, keyword, keyword_normalized, value, type, source, date, created_at) VALUES ${placeholders}`,
      values
    );
  }
}

export type KeywordHistoryEntry = {
  date: string;
  value: number;
  type: string;
};

export async function getKeywordHistory(
  keyword: string,
  days = 30
): Promise<KeywordHistoryEntry[]> {
  const { rows } = await d1Query<KeywordHistoryEntry>(
    `SELECT date, value, type FROM keyword_history 
     WHERE keyword_normalized = ? AND date >= date('now', '-' || ? || ' days')
     ORDER BY date ASC`,
    [keyword.toLowerCase().trim(), String(days)]
  );
  return rows;
}

export async function getKeywordFirstSeen(
  keyword: string
): Promise<string | null> {
  const { rows } = await d1Query<{ date: string }>(
    `SELECT MIN(date) as date FROM keyword_history WHERE keyword_normalized = ?`,
    [keyword.toLowerCase().trim()]
  );
  return rows[0]?.date ?? null;
}

export async function getTrendingNewKeywords(
  days = 3,
  limit = 50
): Promise<Array<{ keyword: string; current_value: number; first_seen: string; days_active: number }>> {
  const { rows } = await d1Query<{
    keyword: string;
    current_value: number;
    first_seen: string;
    days_active: number;
  }>(
    `SELECT 
       h.keyword,
       h.value as current_value,
       MIN(h2.date) as first_seen,
       CAST(julianday('now') - julianday(MIN(h2.date)) AS INTEGER) as days_active
     FROM keyword_history h
     JOIN keyword_history h2 ON h.keyword_normalized = h2.keyword_normalized
     WHERE h.date = date('now')
       AND h2.date >= date('now', '-' || ? || ' days')
     GROUP BY h.keyword_normalized
     HAVING first_seen >= date('now', '-' || ? || ' days')
     ORDER BY h.value DESC
     LIMIT ?`,
    [String(days), String(days), String(limit)]
  );
  return rows;
}

// --- AI Filter Cache ---

export type FilterCacheEntry = {
  cacheKey: string;
  blockedKeywords: string[];
  keptKeywords: string[];
  summary: Record<string, unknown> | null;
  model: string;
};

export async function getFilterCache(
  cacheKey: string
): Promise<FilterCacheEntry | null> {
  const { rows } = await d1Query<{
    cache_key: string;
    blocked_keywords: string;
    kept_keywords: string;
    summary: string | null;
    model: string;
  }>(
    `SELECT cache_key, blocked_keywords, kept_keywords, summary, model FROM filter_cache WHERE cache_key = ?`,
    [cacheKey]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    cacheKey: r.cache_key,
    blockedKeywords: JSON.parse(r.blocked_keywords),
    keptKeywords: JSON.parse(r.kept_keywords),
    summary: r.summary ? JSON.parse(r.summary) : null,
    model: r.model,
  };
}

export async function setFilterCache(entry: {
  cacheKey: string;
  blockedKeywords: string[];
  keptKeywords: string[];
  summary?: Record<string, unknown>;
  model: string;
}): Promise<void> {
  await d1Query(
    `INSERT OR REPLACE INTO filter_cache (id, cache_key, blocked_keywords, kept_keywords, summary, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      randomUUID(),
      entry.cacheKey,
      JSON.stringify(entry.blockedKeywords),
      JSON.stringify(entry.keptKeywords),
      entry.summary ? JSON.stringify(entry.summary) : null,
      entry.model,
    ]
  );
}
