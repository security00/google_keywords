#!/usr/bin/env node
/**
 * Minimal Cloudflare D1 migration runner.
 *
 * Default mode is dry-run. Use --apply to execute migrations against production D1.
 * Records applied migrations in schema_migrations.
 */

import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
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

const apply = process.argv.includes("--apply");
const accountId = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const databaseId = process.env.D1_DATABASE_ID || "b40de8a4-75e1-4df6-a84d-3ecd62b70538";
const migrationsDir = "migrations/d1";

if (!accountId || !apiToken) {
  console.error("Missing Cloudflare account/token env");
  process.exit(2);
}

async function d1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`D1 HTTP ${res.status}: ${text}`);
  const payload = JSON.parse(text);
  if (!payload.success) throw new Error(`D1 query failed: ${text}`);
  return payload.result?.[0]?.results || [];
}

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

const files = readdirSync(migrationsDir)
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort();

if (!files.length) {
  console.log("No migrations found");
  process.exit(0);
}

let applied = new Map();
try {
  const rows = await d1("SELECT version, checksum FROM schema_migrations ORDER BY version");
  applied = new Map(rows.map((row) => [row.version, row.checksum]));
} catch (error) {
  if (!String(error.message).includes("no such table: schema_migrations")) throw error;
}

for (const file of files) {
  const content = readFileSync(join(migrationsDir, file), "utf8");
  const version = file.split("_")[0];
  const name = file.replace(/^\d+_/, "").replace(/\.sql$/, "");
  const hash = checksum(content);
  const existing = applied.get(version);

  if (existing) {
    if (existing !== hash) {
      console.error(`❌ Migration checksum mismatch for ${file}`);
      process.exit(1);
    }
    console.log(`✓ already applied ${file}`);
    continue;
  }

  if (!apply) {
    console.log(`DRY RUN would apply ${file} (${hash.slice(0, 12)})`);
    continue;
  }

  console.log(`Applying ${file}...`);
  await d1(content);
  await d1(
    "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, datetime('now'))",
    [version, name, hash],
  );
  console.log(`✅ applied ${file}`);
}
