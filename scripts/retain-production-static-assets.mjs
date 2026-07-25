#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const STATIC_PREFIX = "/_next/static/";
const DEFAULT_MAX_ASSETS = 500;
const DEFAULT_MAX_ASSET_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export function extractStaticAssetPaths(html, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const assets = new Set();

  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    let url;
    try {
      url = new URL(match[1], baseUrl);
    } catch {
      continue;
    }

    if (url.origin !== origin || !url.pathname.startsWith(STATIC_PREFIX)) {
      continue;
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      continue;
    }

    const segments = decodedPath.split("/");
    if (
      decodedPath.includes("\\")
      || decodedPath.includes("\0")
      || segments.some((segment) => segment === "." || segment === "..")
    ) {
      continue;
    }

    assets.add(decodedPath);
  }

  return [...assets].sort();
}

export function getPrerenderHtmlRoutes(manifest) {
  return Object.entries(manifest.routes ?? {})
    .filter(([route, metadata]) =>
      typeof route === "string"
      && route.startsWith("/")
      && !route.startsWith("/_")
      && typeof metadata?.dataRoute === "string"
    )
    .map(([route]) => route)
    .sort();
}

function localAssetPath(assetDirectory, assetPath) {
  const root = resolve(assetDirectory);
  const target = resolve(root, `.${assetPath}`);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Static asset escaped the build directory: ${assetPath}`);
  }
  return target;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length || 1) },
      () => worker(),
    ),
  );
  return results;
}

async function fetchRequired(fetchImpl, url, accept) {
  const response = await fetchImpl(url, {
    redirect: "follow",
    headers: {
      accept,
      "cache-control": "no-cache",
      "user-agent": "discover-keywords-production-asset-retention",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  const requestedUrl = new URL(url);
  const finalUrl = new URL(response.url || requestedUrl, requestedUrl);
  if (finalUrl.origin !== requestedUrl.origin) {
    throw new Error(`${requestedUrl.pathname} redirected outside production origin`);
  }
  return response;
}

export async function retainProductionStaticAssets({
  baseUrl,
  assetDirectory,
  manifestPath,
  fetchImpl = fetch,
  concurrency = 6,
  maxAssets = DEFAULT_MAX_ASSETS,
  maxAssetBytes = DEFAULT_MAX_ASSET_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  logger = console,
}) {
  const normalizedBaseUrl = new URL(baseUrl);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const routes = getPrerenderHtmlRoutes(manifest);
  if (routes.length === 0) {
    throw new Error("No prerendered HTML routes found for asset retention");
  }

  const routeAssets = await mapWithConcurrency(
    routes,
    concurrency,
    async (route, index) => {
      const url = new URL(route, normalizedBaseUrl);
      url.searchParams.set("__asset_retention", `${Date.now()}-${index}`);
      const response = await fetchImpl(url, {
        redirect: "follow",
        headers: {
          accept: "text/html",
          "cache-control": "no-cache",
          "user-agent": "discover-keywords-production-asset-retention",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404) {
        return { route, assets: [], missing: true };
      }
      if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
      }
      const finalUrl = new URL(response.url || url, normalizedBaseUrl);
      if (finalUrl.origin !== normalizedBaseUrl.origin) {
        throw new Error(`Route ${route} redirected outside production origin`);
      }
      return {
        route,
        assets: extractStaticAssetPaths(
          await response.text(),
          normalizedBaseUrl,
        ),
        missing: false,
      };
    },
  );

  const missingRoutes = routeAssets.filter((entry) => entry.missing).length;
  const assets = [
    ...new Set(routeAssets.flatMap((entry) => entry.assets)),
  ].sort();
  if (assets.length === 0) {
    throw new Error("Production pages did not reference any Next.js static assets");
  }
  if (assets.length > maxAssets) {
    throw new Error(
      `Production referenced ${assets.length} assets; limit is ${maxAssets}`,
    );
  }

  let retainedAssets = 0;
  let retainedBytes = 0;
  let existingAssets = 0;

  await mapWithConcurrency(assets, concurrency, async (assetPath) => {
    const targetPath = localAssetPath(assetDirectory, assetPath);
    if (existsSync(targetPath)) {
      existingAssets += 1;
      return;
    }

    const url = new URL(assetPath, normalizedBaseUrl);
    const response = await fetchRequired(
      fetchImpl,
      url,
      "text/css,application/javascript,font/*,image/*,*/*;q=0.1",
    );
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maxAssetBytes) {
      throw new Error(`${assetPath} exceeds the per-asset size limit`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxAssetBytes) {
      throw new Error(`${assetPath} exceeds the per-asset size limit`);
    }

    retainedBytes += bytes.byteLength;
    if (retainedBytes > maxTotalBytes) {
      throw new Error("Retained production assets exceed the total size limit");
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, bytes, { flag: "wx" });
    retainedAssets += 1;
  });

  logger.log(
    `Production asset retention passed: ${routes.length} routes `
      + `(${missingRoutes} new routes absent from production), `
      + `${assets.length} referenced assets, ${existingAssets} already current, `
      + `${retainedAssets} retained (${retainedBytes} bytes).`,
  );

  return {
    routes: routes.length,
    missingRoutes,
    assets: assets.length,
    existingAssets,
    retainedAssets,
    retainedBytes,
  };
}

async function main() {
  const workspace = process.cwd();
  await retainProductionStaticAssets({
    baseUrl:
      process.env.PRODUCTION_ASSET_BASE_URL
      || "https://www.discoverkeywords.co",
    assetDirectory:
      process.env.PRODUCTION_ASSET_DIRECTORY
      || resolve(workspace, ".open-next", "assets"),
    manifestPath:
      process.env.PRODUCTION_PRERENDER_MANIFEST
      || resolve(workspace, ".next", "prerender-manifest.json"),
    concurrency: Number(process.env.PRODUCTION_ASSET_CONCURRENCY || 6),
  });
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
