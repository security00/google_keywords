#!/usr/bin/env node
/**
 * Compare the remote D1 schema with migrations/baseline/0000_current_production_schema.sql.
 * This is a read-only drift check; it does not modify D1.
 */

import { readFileSync } from "fs";
import process from "process";

function loadDotEnv(path) {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!process.env[key]) process.env[key] = rest.join("=").replace(/^['\"]|['\"]$/g, "");
    }
  } catch {}
}

loadDotEnv("/root/.openclaw/workspace-potter-dev/.env");
loadDotEnv("/root/.config/google_keywords/precompute.env");

const accountId = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const databaseId = process.env.D1_DATABASE_ID || "b40de8a4-75e1-4df6-a84d-3ecd62b70538";

if (!accountId || !apiToken) {
  console.error("Missing Cloudflare account/token env");
  process.exit(2);
}

const sql = "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name";
const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ sql }),
});
if (!res.ok) {
  console.error(`Cloudflare D1 query failed: ${res.status} ${await res.text()}`);
  process.exit(2);
}
const payload = await res.json();
const rows = payload.result?.[0]?.results || [];
const current = rows
  .filter((row) => row.sql)
  .map((row) => `-- ${row.type}: ${row.name}\n${String(row.sql).trim().replace(/;$/, "")};`)
  .join("\n\n") + "\n";
const baselineText = readFileSync("migrations/baseline/0000_current_production_schema.sql", "utf8");
const baseline = baselineText
  .split(/\n/)
  .filter((line) => !line.startsWith("-- Production D1 baseline") && !line.startsWith("-- Generated from"))
  .join("\n")
  .trim() + "\n";
if (current.trim() !== baseline.trim()) {
  console.error("❌ Remote D1 schema differs from baseline snapshot");
  process.exit(1);
}
console.log(`✅ Remote D1 schema matches baseline (${rows.length} objects)`);
