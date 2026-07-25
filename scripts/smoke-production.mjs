#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { extractStaticAssetPaths } from "./retain-production-static-assets.mjs";

const routes = [
  { path: "/", expected: [200] },
  { path: "/login", expected: [200] },
  { path: "/pricing", expected: [200] },
  { path: "/robots.txt", expected: [200] },
  { path: "/sitemap.xml", expected: [200] },
  { path: "/api/auth/session", expected: [200] },
  { path: "/api/me", expected: [401, 403] },
  { path: "/api/research/history", expected: [401, 403] },
  { path: "/api/admin/health", expected: [401, 403] },
];

const defaultDelay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

export async function runProductionSmoke({
  baseUrl,
  maxAttempts = 5,
  retryDelayMs = 2_000,
  fetchImpl = fetch,
  delayImpl = defaultDelay,
  logger = console,
}) {
  const normalizedBaseUrl = new URL(baseUrl);

  async function request(
    path,
    expectedStatuses,
    { captureBody = false, attempts = maxAttempts } = {},
  ) {
    const url = path instanceof URL ? path : new URL(path, normalizedBaseUrl);
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          redirect: "follow",
          headers: {
            "cache-control": "no-cache",
            "user-agent": "discover-keywords-production-smoke",
          },
          signal: AbortSignal.timeout(15_000),
        });
        const body = captureBody ? await response.text() : null;
        if (!captureBody) await response.arrayBuffer();

        if (expectedStatuses.includes(response.status)) {
          logger.log(`✓ ${url.pathname} -> ${response.status}`);
          return body;
        }

        lastError = new Error(
          `${url.pathname} returned ${response.status}; `
            + `expected ${expectedStatuses.join("/")}`,
        );
      } catch (error) {
        lastError = error;
      }

      if (attempt < attempts) await delayImpl(retryDelayMs);
    }

    throw lastError;
  }

  for (const route of routes) {
    await request(route.path, route.expected);
  }

  let acceptedAssets;
  let lastGraphError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const landingUrl = new URL("/", normalizedBaseUrl);
      landingUrl.searchParams.set(
        "__production_smoke",
        `${Date.now()}-${attempt}`,
      );
      const landingPage = await request(landingUrl, [200], {
        captureBody: true,
        attempts: 1,
      });
      const assets = extractStaticAssetPaths(
        landingPage,
        normalizedBaseUrl,
      );

      if (assets.length === 0) {
        throw new Error("Landing page did not reference any Next.js assets");
      }

      for (const asset of assets) {
        await request(asset, [200], { attempts: 1 });
      }

      acceptedAssets = assets;
      break;
    } catch (error) {
      lastGraphError = error;
      if (attempt < maxAttempts) {
        logger.warn(
          `Static asset graph was not coherent on attempt ${attempt}; `
            + "recapturing the landing page.",
        );
        await delayImpl(retryDelayMs);
      }
    }
  }

  if (!acceptedAssets) {
    throw lastGraphError;
  }

  logger.log(
    `Production smoke passed: ${routes.length} routes and `
      + `${acceptedAssets.length} static assets.`,
  );

  return {
    routes: routes.length,
    assets: acceptedAssets.length,
  };
}

async function main() {
  await runProductionSmoke({
    baseUrl:
      process.env.SMOKE_BASE_URL || "https://www.discoverkeywords.co",
    maxAttempts: Number(process.env.SMOKE_MAX_ATTEMPTS || 5),
    retryDelayMs: Number(process.env.SMOKE_RETRY_DELAY_MS || 2_000),
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
