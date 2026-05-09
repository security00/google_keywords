import { NextResponse } from "next/server";

import { isAuthzError, requireAdminRequest } from "@/lib/authz";
import { analyzeGameRadarSource } from "@/lib/game-radar-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SitemapEntry = {
  url: string;
  lastmod: string | null;
};

const fetchSitemap = async (url: string) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; GamePageRadar/1.0)" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Fetch failed (${response.status})`);
  return response.text();
};

const tagText = (node: string, tag: string) => {
  const match = node.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim() || null;
};

const parseUrlEntries = (xml: string): SitemapEntry[] => {
  const nodes = xml.match(/<url[\s\S]*?<\/url>/gi) || [];
  return nodes.flatMap((node) => {
    const url = tagText(node, "loc");
    if (!url) return [];
    return [{ url, lastmod: tagText(node, "lastmod") }];
  });
};

const parseSitemapUrls = (xml: string) =>
  (xml.match(/<sitemap[\s\S]*?<\/sitemap>/gi) || [])
    .map((node) => tagText(node, "loc"))
    .filter((url): url is string => Boolean(url));

export async function POST(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  try {
    const body = await request.json().catch(() => ({}));
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : "";
    const sitemapUrl = typeof body.sitemapUrl === "string" ? body.sitemapUrl : "";
    if (!baseUrl.startsWith("https://") || !sitemapUrl.startsWith("https://")) {
      return NextResponse.json({ error: "Base URL and sitemap URL must start with https://" }, { status: 400 });
    }

    const rootXml = await fetchSitemap(sitemapUrl);
    let entries = parseUrlEntries(rootXml);
    if (!entries.length) {
      const childSitemaps = parseSitemapUrls(rootXml).slice(0, 5);
      const childXmls = await Promise.all(childSitemaps.map((url) => fetchSitemap(url).catch(() => "")));
      entries = childXmls.flatMap(parseUrlEntries);
    }

    const sorted = entries
      .sort((a, b) => (b.lastmod || "").localeCompare(a.lastmod || ""))
      .slice(0, 300);
    const analysis = analyzeGameRadarSource({
      baseUrl,
      sitemapUrl,
      urls: sorted.map((entry) => entry.url),
      lastmodCount: sorted.filter((entry) => entry.lastmod).length,
    });

    return NextResponse.json({
      ...analysis,
      samples: sorted.slice(0, 30),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analyze failed" },
      { status: 500 }
    );
  }
}
