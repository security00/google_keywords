#!/usr/bin/env node

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalMigrationChecksum } from "./migration-checksum-policy.mjs";

const apply = process.argv.includes("--apply");
const configPath = "wrangler.staging.jsonc";
const baselinePath = "migrations/baseline/0000_current_production_schema.sql";
const migrationsDir = "migrations/d1";
const staging = JSON.parse(readFileSync(configPath, "utf8"));
const database = staging.d1_databases?.find((binding) => binding.binding === "DB");

if (!apply) {
  console.error("Dry run only. Re-run with --apply to bootstrap the isolated staging D1.");
  process.exit(2);
}
if (
  staging.name !== "google-keywords-staging" ||
  database?.database_name !== "ai-trends-staging" ||
  database.database_id !== "530bee1f-a79b-4511-be98-d339c160df94"
) {
  console.error("Refusing to run: staging Worker or D1 identity does not match the safety boundary.");
  process.exit(2);
}

const wrangler = process.execPath;
const wranglerCli = "node_modules/wrangler/bin/wrangler.js";
const tempDir = mkdtempSync(join(tmpdir(), "google-keywords-staging-"));

const executeFile = (path) => {
  const result = spawnSync(
    wrangler,
    [
      wranglerCli,
      "d1",
      "execute",
      database.database_name,
      "--remote",
      "--config",
      configPath,
      "--file",
      path,
    ],
    { stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

try {
  const baseline = readFileSync(baselinePath, "utf8").replace(/\r\n/g, "\n");
  const firstIndex = baseline.indexOf("-- index:");
  const firstTable = baseline.indexOf("-- table:");
  if (firstIndex < 0 || firstTable < 0 || firstIndex >= firstTable) {
    throw new Error("Unexpected baseline layout; expected indexes before tables");
  }

  const header = baseline.slice(0, firstIndex);
  const indexes = baseline.slice(firstIndex, firstTable);
  const tables = baseline
    .slice(firstTable)
    .replace(/-- table: _cf_KV[\s\S]*?(?=-- table:)/, "");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  // The checked-in schema snapshot already includes migrations 0001-0006.
  // Later migrations must be applied on top of it in order.
  const baselineMigrations = migrationFiles.filter((file) => Number(file.slice(0, 4)) <= 6);
  const pendingMigrations = migrationFiles.filter((file) => Number(file.slice(0, 4)) >= 7);

  const historySql = baselineMigrations
    .map((file) => {
      const version = file.slice(0, 4);
      const name = file.replace(/^\d{4}_/, "").replace(/\.sql$/, "");
      const checksum = canonicalMigrationChecksum(
        readFileSync(join(migrationsDir, file), "utf8"),
      );
      return `INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES ('${version}', '${name}', '${checksum}', datetime('now'));`;
    })
    .join("\n");

  const bootstrapPath = join(tempDir, "0000_staging_baseline.sql");
  writeFileSync(
    bootstrapPath,
    `${header}${tables}\n${indexes}\n${historySql}\n`,
    "utf8",
  );
  executeFile(bootstrapPath);

  for (const file of pendingMigrations) {
    const version = file.slice(0, 4);
    const name = file.replace(/^\d{4}_/, "").replace(/\.sql$/, "");
    const content = readFileSync(join(migrationsDir, file), "utf8");
    const checksum = canonicalMigrationChecksum(content);
    const migrationPath = join(tempDir, file);
    writeFileSync(
      migrationPath,
      `${content}\nINSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES ('${version}', '${name}', '${checksum}', datetime('now'));\n`,
      "utf8",
    );
    executeFile(migrationPath);
  }

  console.log(
    `Staging D1 bootstrapped: ${database.database_name} (${database.database_id}), migrations through ${pendingMigrations.at(-1)?.slice(0, 4) ?? "0006"}`,
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
