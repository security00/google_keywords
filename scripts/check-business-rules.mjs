#!/usr/bin/env node
/**
 * Verify config/business-rules.json is generated from config/business-rules.ts.
 * Used by CI to prevent TypeScript/Python business-rule drift.
 */

import { readFileSync } from "fs";
import { pathToFileURL } from "url";
import { build } from "esbuild";

const jsonPath = new URL("../config/business-rules.json", import.meta.url);
const tempModule = new URL("../.tmp-business-rules-check.mjs", import.meta.url);

await build({
  entryPoints: [new URL("../config/business-rules.ts", import.meta.url).pathname],
  outfile: tempModule.pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "silent",
});

try {
  const mod = await import(pathToFileURL(tempModule.pathname).href + `?t=${Date.now()}`);
  const expected = JSON.stringify(mod.BUSINESS_RULES_JSON, null, 2) + "\n";
  const actual = readFileSync(jsonPath, "utf8");
  if (actual !== expected) {
    console.error("❌ config/business-rules.json is out of sync with config/business-rules.ts");
    console.error("Run: node scripts/export-business-rules.mjs");
    process.exit(1);
  }
  console.log("✅ business-rules.json is in sync");
} finally {
  try {
    await import("fs").then(({ unlinkSync }) => unlinkSync(tempModule.pathname));
  } catch {
    // ignore cleanup errors
  }
}
