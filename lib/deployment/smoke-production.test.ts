import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { runProductionSmoke } from "../../scripts/smoke-production.mjs";

const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

function expectedStatus(pathname: string) {
  if (
    pathname === "/api/me"
    || pathname === "/api/research/history"
    || pathname === "/api/admin/health"
  ) {
    return 401;
  }
  return 200;
}

describe("production smoke", () => {
  it("recaptures the landing page when the first asset graph is stale", async () => {
    let graphRequests = 0;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.searchParams.has("__production_smoke")) {
        graphRequests += 1;
        response.statusCode = 200;
        response.end(
          graphRequests === 1
            ? '<link href="/_next/static/chunks/old.css">'
            : '<link href="/_next/static/chunks/new.css">',
        );
        return;
      }
      if (url.pathname === "/_next/static/chunks/old.css") {
        response.statusCode = 404;
        response.end("old asset unavailable");
        return;
      }
      if (url.pathname === "/_next/static/chunks/new.css") {
        response.statusCode = 200;
        response.end("new asset");
        return;
      }

      response.statusCode = expectedStatus(url.pathname);
      response.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const { port } = server.address() as AddressInfo;

    const result = await runProductionSmoke({
      baseUrl: `http://127.0.0.1:${port}`,
      maxAttempts: 3,
      retryDelayMs: 0,
      delayImpl: async () => {},
      logger: { log() {}, warn() {} } as Console,
    });

    expect(result).toEqual({ routes: 9, assets: 1 });
    expect(graphRequests).toBe(2);
  });

  it("fails when no coherent asset graph appears", async () => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.searchParams.has("__production_smoke")) {
        response.statusCode = 200;
        response.end('<link href="/_next/static/chunks/missing.css">');
        return;
      }
      if (url.pathname === "/_next/static/chunks/missing.css") {
        response.statusCode = 404;
        response.end("missing");
        return;
      }

      response.statusCode = expectedStatus(url.pathname);
      response.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const { port } = server.address() as AddressInfo;

    await expect(
      runProductionSmoke({
        baseUrl: `http://127.0.0.1:${port}`,
        maxAttempts: 2,
        retryDelayMs: 0,
        delayImpl: async () => {},
        logger: { log() {}, warn() {} } as Console,
      }),
    ).rejects.toThrow("returned 404");
  });
});
