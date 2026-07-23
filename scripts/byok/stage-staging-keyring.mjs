#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const config = JSON.parse(readFileSync("wrangler.staging.jsonc", "utf8"));
const database = config.d1_databases?.find((binding) => binding.binding === "DB");

if (
  config.name !== "google-keywords-staging"
  || database?.database_name !== "ai-trends-staging"
  || database.database_id !== "530bee1f-a79b-4511-be98-d339c160df94"
  || config.vars?.BYOK_PROVIDER_CONNECTIONS_ENABLED !== "false"
  || config.vars?.BYOK_LIVE_MODE_ENABLED !== "false"
) {
  console.error("Refusing to stage keys outside the feature-off isolated staging boundary.");
  process.exit(2);
}

const tempDir = mkdtempSync(join(tmpdir(), "google-keywords-byok-keyring-"));
const secretFile = join(tempDir, "secrets.json");

try {
  writeFileSync(
    secretFile,
    JSON.stringify({
      BYOK_KEK_V1: randomBytes(32).toString("base64url"),
      BYOK_FINGERPRINT_KEY_V1: randomBytes(32).toString("base64url"),
    }),
    { encoding: "utf8", mode: 0o600 },
  );

  const result = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "versions",
      "secret",
      "bulk",
      secretFile,
      "--name",
      config.name,
      "--message",
      "stage BYOK v1 keyring with feature flags off",
    ],
    { env: process.env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
