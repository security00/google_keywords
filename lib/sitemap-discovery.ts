import { randomUUID } from "crypto";

import { d1InsertMany, d1Query } from "@/lib/d1";
import {
  extractKeywordFromUrl,
  fetchSitemapXml,
  normalizeKeyword,
  parseSitemapXml,
  type SitemapEntry,
  type SitemapRule,
} from "@/lib/sitemap-utils";

export const DEFAULT_CHECK_INTERVAL_MINUTES = 60;
export const SOURCE_SCAN_CONCURRENCY = 3;
const IN_QUERY_CHUNK_SIZE = 80;

export type DiscoverySourceRow = {
  id: string;
  user_id: string;
  name: string | null;
  sitemap_url: string;
  enabled: number | null;
  rules_json: string | null;
  etag: string | null;
  last_modified: string | null;
  last_checked_at: string | null;
  check_interval_minutes: number | null;
  next_check_at: string | null;
};

export type DiscoveryScanResult = {
  sourceId: string;
  sourceName: string | null;
  sitemapUrl: string;
  totalUrls: number;
  newUrls: number;
  newKeywords: number;
  skipped: boolean;
  tookMs: number;
  nextCheckAt?: string;
  error?: string;
};

type ScanContext = {
  ignoreFirstScan: boolean;
  runAt?: string;
  defaultCheckIntervalMinutes?: number;
  checkIntervalMinutes?: number | null;
};

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export const ensureSitemapSourcesColumns = async () => {
  const { rows } = await d1Query<{ name: string }>("PRAGMA table_info(sitemap_sources)");
  if (rows.length === 0) {
    return;
  }

  const hasColumn = new Set(rows.map((item) => item.name));
  const missingCheckInterval = !hasColumn.has("check_interval_minutes");
  const missingNextCheckAt = !hasColumn.has("next_check_at");

  if (missingCheckInterval) {
    await d1Query(
      "ALTER TABLE sitemap_sources ADD COLUMN check_interval_minutes INTEGER NOT NULL DEFAULT 60;"
    );
  }

  if (missingNextCheckAt) {
    await d1Query("ALTER TABLE sitemap_sources ADD COLUMN next_check_at TEXT;");
  }

  if (missingCheckInterval || missingNextCheckAt) {
    await d1Query(
      "CREATE INDEX IF NOT EXISTS idx_sitemap_sources_next_check ON sitemap_sources (user_id, enabled, next_check_at)"
    );
  }
};

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
) => {
  if (items.length === 0) return [] as R[];
  const results: R[] = new Array(items.length);
  let index = 0;
  const concurrency = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const current = index;
        index += 1;
        if (current >= items.length) break;
        results[current] = await worker(items[current]);
      }
    })
  );

  return results;
};

const parseRules = (raw: string | null): SitemapRule | undefined => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as SitemapRule;
  } catch {
    return undefined;
  }
};

export const normalizeCheckIntervalMinutes = (value: unknown, fallbackMinutes: number) => {
  if (typeof value !== "number") {
    return Math.max(1, Math.floor(fallbackMinutes));
  }
  const normalized = Math.floor(value);
  if (Number.isNaN(normalized)) return Math.max(1, Math.floor(fallbackMinutes));
  return Math.max(1, normalized);
};

const collectEntries = async (
  rootUrl: string,
  options: { etag?: string | null; lastModified?: string | null }
) => {
  const entries: SitemapEntry[] = [];
  const queue: Array<{ url: string; isRoot: boolean }> = [
    { url: rootUrl, isRoot: true },
  ];
  const visited = new Set<string>();
  let rootMeta: { etag?: string | null; lastModified?: string | null } = {};
  let rootSkipped = false;

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    if (visited.has(next.url)) continue;
    visited.add(next.url);

    const result = await fetchSitemapXml(next.url, next.isRoot ? options : {});
    if (result.notModified && next.isRoot) {
      rootSkipped = true;
      break;
    }
    if (!result.xml) continue;

    if (next.isRoot) {
      rootMeta = { etag: result.etag, lastModified: result.lastModified };
    }

    const parsed = parseSitemapXml(result.xml);
    for (const sitemapUrl of parsed.sitemaps) {
      if (!visited.has(sitemapUrl)) {
        queue.push({ url: sitemapUrl, isRoot: false });
      }
    }
    entries.push(...parsed.urls);
  }

  return { entries, rootMeta, rootSkipped };
};

const getExistingUrls = async (
  userId: string,
  sourceId: string,
  urls: string[]
) => {
  const existing = new Set<string>();
  for (const chunk of chunkArray(urls, IN_QUERY_CHUNK_SIZE)) {
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const { rows } = await d1Query<{ url: string }>(
      `SELECT url FROM sitemap_entries WHERE user_id = ? AND source_id = ? AND url IN (${placeholders})`,
      [userId, sourceId, ...chunk]
    );
    for (const row of rows) {
      existing.add(row.url);
    }
  }
  return existing;
};

const getExistingKeywords = async (userId: string, normalized: string[]) => {
  const existing = new Set<string>();
  for (const chunk of chunkArray(normalized, IN_QUERY_CHUNK_SIZE)) {
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const { rows } = await d1Query<{ keyword_normalized: string }>(
      `SELECT keyword_normalized FROM discovered_keywords WHERE user_id = ? AND keyword_normalized IN (${placeholders})`,
      [userId, ...chunk]
    );
    for (const row of rows) {
      existing.add(row.keyword_normalized);
    }
  }
  return existing;
};

const computeNextCheckAt = (runAt: Date, checkIntervalMinutes: number) => {
  return new Date(runAt.getTime() + checkIntervalMinutes * 60_000);
};

const scheduleNextScan = async (
  source: DiscoverySourceRow,
  runAt: Date,
  options: ScanContext,
  rootMeta?: { etag?: string | null; lastModified?: string | null }
) => {
  const checkIntervalMinutes = normalizeCheckIntervalMinutes(
    options.checkIntervalMinutes ?? source.check_interval_minutes,
    options.defaultCheckIntervalMinutes ?? DEFAULT_CHECK_INTERVAL_MINUTES
  );
  const nextCheckAt = computeNextCheckAt(runAt, checkIntervalMinutes).toISOString();

  await d1Query(
    `UPDATE sitemap_sources
     SET etag = COALESCE(?, etag),
         last_modified = COALESCE(?, last_modified),
         last_checked_at = ?,
         next_check_at = ?,
         check_interval_minutes = ?,
         updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      rootMeta?.etag,
      rootMeta?.lastModified,
      runAt.toISOString(),
      nextCheckAt,
      checkIntervalMinutes,
      runAt.toISOString(),
      source.id,
      source.user_id,
    ]
  );

  return nextCheckAt;
};

const scanSource = async (
  source: DiscoverySourceRow,
  options: ScanContext
): Promise<DiscoveryScanResult> => {
  const startedAt = Date.now();
  const runAt = options.runAt ? new Date(options.runAt) : new Date();
  if (Number.isNaN(runAt.getTime())) throw new Error("Invalid runAt");

  const rules = parseRules(source.rules_json);
  let totalUrls = 0;
  let newUrls = 0;
  let newKeywords = 0;
  let skipped = false;
  let nextCheckAt = "";

  try {
    const isFirstScan = !source.last_checked_at;
    const { entries, rootMeta, rootSkipped } = await collectEntries(
      source.sitemap_url,
      { etag: source.etag, lastModified: source.last_modified }
    );

    nextCheckAt = await scheduleNextScan(
      source,
      runAt,
      {
        ignoreFirstScan: options.ignoreFirstScan,
        checkIntervalMinutes: options.checkIntervalMinutes,
      },
      rootMeta
    );

    if (rootSkipped) {
      skipped = true;
      return {
        sourceId: source.id,
        sourceName: source.name,
        sitemapUrl: source.sitemap_url,
        totalUrls,
        newUrls,
        newKeywords,
        skipped,
        tookMs: Date.now() - startedAt,
        nextCheckAt,
      };
    }

    const uniqueUrls = new Map<string, SitemapEntry>();
    for (const entry of entries) {
      if (!entry.loc) continue;
      if (!uniqueUrls.has(entry.loc)) {
        uniqueUrls.set(entry.loc, entry);
      }
    }

    const urlEntries = Array.from(uniqueUrls.values());
    const urls = urlEntries.map((entry) => entry.loc);
    totalUrls = urlEntries.length;
    const existingUrls = await getExistingUrls(source.user_id, source.id, urls);
    const newEntries = urlEntries.filter((entry) => !existingUrls.has(entry.loc));
    newUrls = newEntries.length;

    if (newEntries.length > 0) {
      const now = runAt.toISOString();
      const entryRows = newEntries.map((entry) => [
        randomUUID(),
        source.user_id,
        source.id,
        entry.loc,
        entry.lastmod ?? null,
        now,
        now,
      ]);
      await d1InsertMany(
        "sitemap_entries",
        ["id", "user_id", "source_id", "url", "lastmod", "first_seen_at", "last_seen_at"],
        entryRows,
        200
      );
    }

    const keywordMap = new Map<string, { keyword: string; url: string }>();
    for (const entry of newEntries) {
      const keyword = extractKeywordFromUrl(entry.loc, rules);
      if (!keyword) continue;
      const normalized = normalizeKeyword(keyword);
      if (!keywordMap.has(normalized)) {
        keywordMap.set(normalized, { keyword, url: entry.loc });
      }
    }

    const normalizedList = Array.from(keywordMap.keys());
    const existingKeywords = await getExistingKeywords(source.user_id, normalizedList);

    const keywordStatus = options.ignoreFirstScan && isFirstScan ? "ignored" : "new";
    const keywordRows = Array.from(keywordMap.entries())
      .filter(([normalized]) => !existingKeywords.has(normalized))
      .map(([normalized, payload]) => [
        randomUUID(),
        source.user_id,
        source.id,
        payload.url,
        payload.keyword,
        normalized,
        keywordStatus,
        runAt.toISOString(),
        runAt.toISOString(),
      ]);

    newKeywords = keywordRows.length;
    if (keywordRows.length > 0) {
      await d1InsertMany(
        "discovered_keywords",
        [
          "id",
          "user_id",
          "source_id",
          "url",
          "keyword",
          "keyword_normalized",
          "status",
          "extracted_at",
          "updated_at",
        ],
        keywordRows,
        200,
        { insertMode: "INSERT OR IGNORE" }
      );
    }
  } catch (error) {
    if (!nextCheckAt) {
      nextCheckAt = await scheduleNextScan(
        source,
        runAt,
        {
          ignoreFirstScan: options.ignoreFirstScan,
          checkIntervalMinutes: options.checkIntervalMinutes,
        }
      );
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    return {
      sourceId: source.id,
      sourceName: source.name,
      sitemapUrl: source.sitemap_url,
      totalUrls,
      newUrls,
      newKeywords,
      skipped,
      tookMs: Date.now() - startedAt,
      nextCheckAt,
      error: message,
    };
  }

  return {
    sourceId: source.id,
    sourceName: source.name,
    sitemapUrl: source.sitemap_url,
    totalUrls,
    newUrls,
    skipped,
    newKeywords,
    tookMs: Date.now() - startedAt,
    nextCheckAt,
  };
};

export const runDiscoveryScan = async (
  sources: DiscoverySourceRow[],
  options?: {
    ignoreFirstScan?: boolean;
    runAt?: string;
    defaultCheckIntervalMinutes?: number;
    checkIntervalMinutes?: number | null;
  }
): Promise<DiscoveryScanResult[]> => {
  const checkIntervalMinutes = options?.defaultCheckIntervalMinutes;
  return runWithConcurrency(sources, SOURCE_SCAN_CONCURRENCY, async (source) =>
    scanSource(source, {
      ignoreFirstScan: options?.ignoreFirstScan ?? true,
      runAt: options?.runAt,
      defaultCheckIntervalMinutes: checkIntervalMinutes,
      checkIntervalMinutes: options?.checkIntervalMinutes,
    })
  );
};
