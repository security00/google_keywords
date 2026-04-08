import "server-only";

import { gunzipSync } from "zlib";
import { XMLParser } from "fast-xml-parser";

export type SitemapEntry = {
  loc: string;
  lastmod?: string;
};

export type SitemapParseResult = {
  sitemaps: string[];
  urls: SitemapEntry[];
};

export type FetchSitemapResult = {
  xml?: string;
  etag?: string | null;
  lastModified?: string | null;
  notModified?: boolean;
};

export type SitemapRule = {
  mode?: "last" | "secondLast" | "regex";
  regex?: string;
  prefix?: string;
  stripTokens?: string[];
  stopWords?: string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  trimValues: true,
});

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const defaultStopWords = new Set([
  "game",
  "games",
  "play",
  "online",
  "free",
  "new",
  "best",
  "top",
  "popular",
  "all",
  "latest",
  "trending",
  "featured",
  "unearned",
  "login",
  "log-in",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "register",
  "registration",
  "account",
  "accounts",
  "profile",
  "user",
  "users",
  "menu",
  "site",
  "sites",
  "search",
  "site-search",
  "sitesearch",
  "faq",
  "help",
  "support",
  "contact",
  "about",
  "terms",
  "privacy",
  "policy",
  "cookie",
  "news",
  "blog",
  "tag",
  "tags",
  "category",
  "categories",
  "archive",
  "html",
  "php",
  "aspx",
  "index",
]);

const defaultStripTokens = new Set([
  "game",
  "games",
  "play",
  "online",
  "free",
  "unblocked",
  "new",
  "best",
  "top",
]);

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const stripExtension = (value: string) =>
  value.replace(/\.(html?|php|aspx)$/i, "");

const toArray = <T,>(value: T | T[] | undefined): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

export const fetchSitemapXml = async (
  url: string,
  options: { etag?: string | null; lastModified?: string | null } = {}
): Promise<FetchSitemapResult> => {
  const headers: HeadersInit = {
    "User-Agent": DEFAULT_USER_AGENT,
    Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
  };
  if (options.etag) headers["If-None-Match"] = options.etag;
  if (options.lastModified) headers["If-Modified-Since"] = options.lastModified;

  const maxRetries = 2;
  const retryStatuses = new Set([429, 500, 502, 503, 504]);
  let attempt = 0;

  while (true) {
    try {
      const response = await fetch(url, { headers, redirect: "follow" });
      if (response.status === 304) {
        return { notModified: true };
      }
      if (!response.ok) {
        if (retryStatuses.has(response.status) && attempt < maxRetries) {
          attempt += 1;
          await sleep(500 * attempt);
          continue;
        }
        throw new Error(`Sitemap fetch failed (${response.status})`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const hasGzipMagic = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
      const xml = hasGzipMagic
        ? gunzipSync(buffer).toString("utf-8")
        : buffer.toString("utf-8");

      return {
        xml,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    } catch (error) {
      if (attempt < maxRetries) {
        attempt += 1;
        await sleep(500 * attempt);
        continue;
      }
      throw error;
    }
  }
};

export const parseSitemapXml = (xml: string): SitemapParseResult => {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const sitemaps: string[] = [];
  const urls: SitemapEntry[] = [];

  const sitemapIndex = parsed.sitemapindex as
    | { sitemap?: unknown }
    | undefined;
  if (sitemapIndex?.sitemap) {
    const items = toArray(sitemapIndex.sitemap);
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const loc = (item as { loc?: unknown }).loc;
      if (typeof loc === "string" && loc.trim()) {
        sitemaps.push(loc);
      }
    }
  }

  const urlSet = parsed.urlset as { url?: unknown } | undefined;
  if (urlSet?.url) {
    const items = toArray(urlSet.url);
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const loc = (item as { loc?: unknown }).loc;
      if (typeof loc !== "string" || !loc.trim()) continue;
      const lastmod = (item as { lastmod?: unknown }).lastmod;
      urls.push({
        loc,
        lastmod: typeof lastmod === "string" ? lastmod : undefined,
      });
    }
  }

  return { sitemaps, urls };
};

const pickSegment = (segments: string[], mode?: SitemapRule["mode"]) => {
  const cleaned = segments.filter(Boolean);
  if (cleaned.length === 0) return "";

  const last = cleaned[cleaned.length - 1] ?? "";
  const secondLast = cleaned.length > 1 ? cleaned[cleaned.length - 2] : last;

  if (mode === "secondLast") {
    return secondLast;
  }
  return last;
};

export const extractKeywordFromUrl = (
  url: string,
  rules?: SitemapRule
): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const prefix = rules?.prefix ?? "";
  let path = parsed.pathname || "";
  if (prefix && path.startsWith(prefix)) {
    path = path.slice(prefix.length);
  }

  if (rules?.mode === "regex" && rules.regex) {
    try {
      const regex = new RegExp(rules.regex);
      const match = regex.exec(path) ?? regex.exec(url);
      if (match?.[1]) {
        path = match[1];
      }
    } catch {
      // ignore invalid regex
    }
  }

  const segments = path.split("/").filter(Boolean);
  let slug = pickSegment(segments, rules?.mode);

  if (!slug && segments.length > 1) {
    slug = segments[segments.length - 2];
  }

  slug = stripExtension(slug);

  let decoded = "";
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    decoded = slug;
  }

  const separatorsNormalized = decoded.replace(/[-_+]+/g, " ");
  const tokens = separatorsNormalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const stopWords = new Set(
    (rules?.stopWords ?? []).map((word) => word.toLowerCase())
  );
  const stripTokens = new Set(
    (rules?.stripTokens ?? []).map((word) => word.toLowerCase())
  );

  const finalTokens = tokens.filter((token) => {
    const lowered = token.toLowerCase();
    if (defaultStopWords.has(lowered)) return false;
    if (stopWords.has(lowered)) return false;
    return true;
  });

  while (finalTokens.length > 0) {
    const tail = finalTokens[finalTokens.length - 1]?.toLowerCase();
    if (!tail) break;
    if (defaultStripTokens.has(tail) || stripTokens.has(tail)) {
      finalTokens.pop();
      continue;
    }
    break;
  }

  const keyword = normalizeWhitespace(finalTokens.join(" "));
  if (!keyword || keyword.length < 2) return null;

  // === Quality filters ===
  // Reject pure numbers (e.g. "18387", "1201")
  if (/^\d+$/.test(keyword)) return null;
  // Reject too short (< 4 chars) — usually not meaningful game names
  if (keyword.length < 4) return null;
  // Reject too long (> 60 chars) — usually descriptions, not game names
  if (keyword.length > 60) return null;
  // Reject single-token generic words
  const genericWords = new Set([
    "beauty", "art", "io", "fun", "run", "car", "bus", "pop",
    "box", "tap", "fit", "pet", "hud", "map", "top", "red",
    "bot", "fly", "mix", "cut", "hit", "get", "set", "win",
    "vip", "pro", "max", "new", "org", "net",
  ]);
  if (genericWords.has(keyword.toLowerCase())) return null;

  return keyword;
};

export const normalizeKeyword = (keyword: string) =>
  normalizeWhitespace(keyword.toLowerCase());
