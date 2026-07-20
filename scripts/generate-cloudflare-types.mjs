#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const checkOnly = process.argv.includes("--check");
const workspace = process.cwd();
const canonicalConfigPath = resolve(workspace, "wrangler.jsonc");
const tempDirectory = resolve(workspace, ".wrangler");
const tempConfigPath = join(tempDirectory, "typegen-config.jsonc");
const outputPath = resolve(workspace, "cloudflare-env.d.ts");
const wranglerBin = resolve(
  workspace,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

if (!existsSync(canonicalConfigPath)) {
  console.error("Missing canonical wrangler.jsonc");
  process.exit(2);
}

if (!existsSync(wranglerBin)) {
  console.error("Missing local Wrangler CLI. Run npm ci first.");
  process.exit(2);
}

const config = JSON.parse(readFileSync(canonicalConfigPath, "utf8"));

// The canonical main points at the generated OpenNext worker. Wrangler changes
// the self-service binding type depending on whether that build artifact exists.
// A missing typegen-only main keeps the output stable before and after builds.
config.main = "typegen-placeholder.js";

mkdirSync(tempDirectory, { recursive: true });
writeFileSync(tempConfigPath, JSON.stringify(config, null, 2) + "\n", "utf8");

try {
  const args = [
    wranglerBin,
    "types",
    outputPath,
    "--config",
    tempConfigPath,
    "--env-interface",
    "CloudflareEnv",
    "--include-runtime=false",
  ];
  if (checkOnly) {
    args.push("--check");
  }

  const result = spawnSync(process.execPath, args, {
    cwd: workspace,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`Failed to run Wrangler: ${result.error.message}`);
    process.exit(1);
  }

  process.exitCode = result.status ?? 1;
} finally {
  rmSync(tempConfigPath, { force: true });
}
