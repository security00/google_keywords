#!/usr/bin/env node

const baseUrl = new URL(
  process.env.SMOKE_BASE_URL || "https://www.discoverkeywords.co",
);
const maxAttempts = Number(process.env.SMOKE_MAX_ATTEMPTS || 5);
const retryDelayMs = Number(process.env.SMOKE_RETRY_DELAY_MS || 2_000);

const routes = [
  { path: "/", expected: [200], captureBody: true },
  { path: "/login", expected: [200] },
  { path: "/pricing", expected: [200] },
  { path: "/robots.txt", expected: [200] },
  { path: "/sitemap.xml", expected: [200] },
  { path: "/api/auth/session", expected: [200] },
  { path: "/api/me", expected: [401, 403] },
  { path: "/api/research/history", expected: [401, 403] },
  { path: "/api/admin/health", expected: [401, 403] },
];

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, expectedStatuses, captureBody = false) {
  const url = new URL(path, baseUrl);
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
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
        console.log(`✓ ${path} -> ${response.status}`);
        return body;
      }

      lastError = new Error(
        `${path} returned ${response.status}; expected ${expectedStatuses.join("/")}`,
      );
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts) await delay(retryDelayMs);
  }

  throw lastError;
}

let landingPage = "";
for (const route of routes) {
  const body = await request(route.path, route.expected, route.captureBody);
  if (route.captureBody) landingPage = body;
}

const assets = new Set(
  [...landingPage.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith("/_next/static/")),
);

if (assets.size === 0) {
  throw new Error("Landing page did not reference any Next.js static assets");
}

for (const asset of assets) {
  await request(asset, [200]);
}

console.log(
  `Production smoke passed: ${routes.length} routes and ${assets.size} static assets.`,
);
