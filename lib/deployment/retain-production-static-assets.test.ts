import { createServer } from "node:http";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractStaticAssetPaths,
  getPrerenderHtmlRoutes,
  retainProductionStaticAssets,
} from "../../scripts/retain-production-static-assets.mjs";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

describe("production static asset retention", () => {
  it("extracts only same-origin safe Next.js asset paths", () => {
    const html = `
      <link href="/_next/static/chunks/app.css?x=1">
      <script src="https://example.test/_next/static/chunks/app.js"></script>
      <script src="https://other.test/_next/static/chunks/external.js"></script>
      <script src="/_next/static/%2e%2e/private.js"></script>
    `;

    expect(extractStaticAssetPaths(html, "https://example.test")).toEqual([
      "/_next/static/chunks/app.css",
      "/_next/static/chunks/app.js",
    ]);
  });

  it("derives deployable HTML routes from the prerender manifest", () => {
    expect(
      getPrerenderHtmlRoutes({
        routes: {
          "/": { dataRoute: "/index.rsc" },
          "/login": { dataRoute: "/login.rsc" },
          "/robots.txt": { dataRoute: null },
          "/_not-found": { dataRoute: "/_not-found.rsc" },
        },
      }),
    ).toEqual(["/", "/login"]);
  });

  it("copies missing production assets without overwriting current assets", async () => {
    const directory = mkdtempSync(join(tmpdir(), "asset-retention-test-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const assetDirectory = join(directory, "assets");
    const manifestPath = join(directory, "prerender-manifest.json");
    mkdirSync(join(assetDirectory, "_next", "static", "chunks"), {
      recursive: true,
    });
    writeFileSync(
      join(assetDirectory, "_next", "static", "chunks", "current.js"),
      "current",
    );
    writeFileSync(
      manifestPath,
      JSON.stringify({
        routes: {
          "/": { dataRoute: "/index.rsc" },
          "/login": { dataRoute: "/login.rsc" },
          "/new": { dataRoute: "/new.rsc" },
        },
      }),
    );

    const requests: string[] = [];
    const server = createServer((request, response) => {
      const requestUrl = request.url ?? "";
      requests.push(requestUrl);
      if (requestUrl.startsWith("/?")) {
        response.end(`
          <script src="/_next/static/chunks/current.js"></script>
          <link href="/_next/static/chunks/old.css">
        `);
        return;
      }
      if (requestUrl.startsWith("/login?")) {
        response.end('<script src="/_next/static/chunks/old.js"></script>');
        return;
      }
      if (requestUrl.startsWith("/new?")) {
        response.statusCode = 404;
        response.end("not deployed yet");
        return;
      }
      if (requestUrl === "/_next/static/chunks/old.css") {
        response.end("old-css");
        return;
      }
      if (requestUrl === "/_next/static/chunks/old.js") {
        response.end("old-js");
        return;
      }
      response.statusCode = 404;
      response.end("missing");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const { port } = server.address() as AddressInfo;

    const result = await retainProductionStaticAssets({
      baseUrl: `http://127.0.0.1:${port}`,
      assetDirectory,
      manifestPath,
      logger: { log() {} } as Console,
    });

    expect(result).toMatchObject({
      routes: 3,
      missingRoutes: 1,
      assets: 3,
      existingAssets: 1,
      retainedAssets: 2,
    });
    expect(
      readFileSync(
        join(assetDirectory, "_next", "static", "chunks", "current.js"),
        "utf8",
      ),
    ).toBe("current");
    expect(
      readFileSync(
        join(assetDirectory, "_next", "static", "chunks", "old.css"),
        "utf8",
      ),
    ).toBe("old-css");
    expect(
      readFileSync(
        join(assetDirectory, "_next", "static", "chunks", "old.js"),
        "utf8",
      ),
    ).toBe("old-js");
    expect(requests).not.toContain("/_next/static/chunks/current.js");
  });
});
