#!/usr/bin/env node
/**
 * Verify config/business-rules.json is generated from config/business-rules.ts.
 * Used by CI to prevent TypeScript/Python business-rule drift.
 */

import { readFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { build } from "esbuild";

const jsonPath = new URL("../config/business-rules.json", import.meta.url);
const tempModule = new URL("../.tmp-business-rules-check.mjs", import.meta.url);
const entryPath = fileURLToPath(
  new URL("../config/business-rules.ts", import.meta.url),
);
const tempModulePath = fileURLToPath(tempModule);

await build({
  entryPoints: [entryPath],
  outfile: tempModulePath,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});

try {
  const mod = await import(pathToFileURL(tempModulePath).href + `?t=${Date.now()}`);
  const expected = JSON.stringify(mod.BUSINESS_RULES_JSON, null, 2) + "\n";
  const actual = JSON.stringify(
    JSON.parse(readFileSync(jsonPath, "utf8")),
    null,
    2,
  ) + "\n";
  if (actual !== expected) {
    console.error("❌ config/business-rules.json is out of sync with config/business-rules.ts");
    console.error("Run: node scripts/export-business-rules.mjs");
    process.exit(1);
  }
  console.log("✅ business-rules.json is in sync");
} finally {
  try {
    await import("fs").then(({ unlinkSync }) => unlinkSync(tempModulePath));
  } catch {
    // ignore cleanup errors
  }
}
