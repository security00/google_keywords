import { d1Query } from "@/lib/d1";

const GAME_PATH_HINTS = ["/g/", "/game/", "/games/", "/play/"];
const DEFAULT_EXCLUDES = ["/category/", "/categories/", "/tag/", "/tags/", "/privacy", "/terms", "/about", "/blog", "/search"];

export type GameRadarSourceUpdate = {
  id: string;
  enabled?: boolean;
  qualityTier?: number;
  statusNote?: string | null;
};

export type GameRadarSourceInput = {
  id: string;
  name: string;
  baseUrl: string;
  sitemapUrl: string;
  enabled: boolean;
  qualityTier: number;
  urlIncludePatterns: string;
  urlExcludePatterns: string;
  keywordExtractRule: string;
  statusNote?: string | null;
};

export type GameRadarSourceAnalysisInput = {
  baseUrl: string;
  sitemapUrl: string;
  urls: string[];
  lastmodCount: number;
};

export type GameRadarSourceAnalysis = {
  urlIncludePatterns: string;
  urlExcludePatterns: string;
  keywordExtractRule: string;
  statusNote: string;
  sampleCount: number;
  gameLikeCount: number;
};

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

const commonGamePrefix = (paths: string[]) => {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const matched = GAME_PATH_HINTS.find((hint) => path.includes(hint));
    if (!matched) continue;
    const index = path.indexOf(matched);
    const prefix = path.slice(0, index + matched.length);
    counts.set(prefix, (counts.get(prefix) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
};

export const analyzeGameRadarSource = (input: GameRadarSourceAnalysisInput): GameRadarSourceAnalysis => {
  const paths = input.urls.map(pathOf).filter(Boolean);
  const prefix = commonGamePrefix(paths);
  const include = prefix ? [prefix] : GAME_PATH_HINTS.filter((hint) => paths.some((path) => path.includes(hint))).slice(0, 1);
  const excludes = DEFAULT_EXCLUDES.filter((pattern) => paths.some((path) => path.includes(pattern)) || pattern.includes("privacy") || pattern.includes("terms"));
  const gameLikeCount = prefix ? paths.filter((path) => path.includes(prefix)).length : 0;
  const hasLastmod = input.lastmodCount > 0;
  const noteParts = [
    hasLastmod ? "sitemap has lastmod; suitable for newest-page radar." : "sitemap has no lastmod; verify freshness before enabling.",
    prefix ? `Suggested game URL prefix: ${prefix}` : "No obvious game URL prefix found; keep disabled until manually reviewed.",
  ];

  return {
    urlIncludePatterns: JSON.stringify(include),
    urlExcludePatterns: JSON.stringify(excludes),
    keywordExtractRule: JSON.stringify(prefix ? { type: "slug", stripPrefix: prefix } : { type: "slug" }),
    statusNote: noteParts.join(" "),
    sampleCount: paths.length,
    gameLikeCount,
  };
};

const assertJsonArray = (value: string, label: string) => {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error();
    }
  } catch {
    throw new Error(`${label} must be a JSON string array`);
  }
};

const assertJsonObject = (value: string, label: string) => {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
  } catch {
    throw new Error(`${label} must be a JSON object`);
  }
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

const validateInput = (input: GameRadarSourceInput) => {
  if (!input.id.trim()) throw new Error("Source id is required");
  if (!/^[a-z0-9_-]+$/.test(input.id)) throw new Error("Invalid source id");
  if (!input.name.trim()) throw new Error("Source name is required");
  if (!input.baseUrl.startsWith("https://")) throw new Error("Base URL must start with https://");
  if (!input.sitemapUrl.startsWith("https://")) throw new Error("Sitemap URL must start with https://");
  if (!Number.isInteger(input.qualityTier) || input.qualityTier < 1 || input.qualityTier > 99) {
    throw new Error("Invalid quality tier");
  }
  assertJsonArray(input.urlIncludePatterns, "Include patterns");
  assertJsonArray(input.urlExcludePatterns, "Exclude patterns");
  assertJsonObject(input.keywordExtractRule, "Keyword extract rule");
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

export const upsertGameRadarSource = async (input: GameRadarSourceInput) => {
  validateInput(input);
  await d1Query(
    `INSERT INTO game_radar_sources
       (id, name, base_url, sitemap_url, enabled, quality_tier, url_include_patterns, url_exclude_patterns, keyword_extract_rule, status_note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       base_url = excluded.base_url,
       sitemap_url = excluded.sitemap_url,
       enabled = excluded.enabled,
       quality_tier = excluded.quality_tier,
       url_include_patterns = excluded.url_include_patterns,
       url_exclude_patterns = excluded.url_exclude_patterns,
       keyword_extract_rule = excluded.keyword_extract_rule,
       status_note = excluded.status_note,
       updated_at = datetime('now')`,
    [
      input.id.trim(),
      input.name.trim(),
      input.baseUrl.trim(),
      input.sitemapUrl.trim(),
      input.enabled ? 1 : 0,
      input.qualityTier,
      input.urlIncludePatterns.trim() || "[]",
      input.urlExcludePatterns.trim() || "[]",
      input.keywordExtractRule.trim() || "{}",
      input.statusNote?.trim() || null,
    ]
  );
};
