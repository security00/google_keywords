#!/usr/bin/env node
/**
 * Export config/business-rules.ts to JSON for Python scripts.
 *
 * This script intentionally imports BUSINESS_RULES_JSON from the TypeScript
 * source instead of duplicating values here. That keeps TypeScript and Python
 * on one business-rule source of truth.
 */

import { writeFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { build } from "esbuild";

const outPath = new URL("../config/business-rules.json", import.meta.url);
const tempModule = new URL("../.tmp-business-rules-export.mjs", import.meta.url);
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
  if (!mod.BUSINESS_RULES_JSON || typeof mod.BUSINESS_RULES_JSON !== "object") {
    throw new Error("BUSINESS_RULES_JSON export not found");
  }
  writeFileSync(outPath, JSON.stringify(mod.BUSINESS_RULES_JSON, null, 2) + "\n");
  console.log(`✅ Exported business rules to ${fileURLToPath(outPath)}`);
} finally {
  try {
    await import("fs").then(({ unlinkSync }) => unlinkSync(tempModulePath));
  } catch {
    // ignore cleanup errors
  }
}
