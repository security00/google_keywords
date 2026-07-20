#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = "migrations/d1";
const baselinePath = "migrations/baseline/0000_current_production_schema.sql";
const runnerPath = "scripts/schema/apply-d1-migrations.mjs";
const errors = [];

if (!existsSync(migrationsDir)) {
  errors.push(`Missing migration directory: ${migrationsDir}`);
}

const files = existsSync(migrationsDir)
  ? readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
  : [];

const versions = new Set();

for (const file of files) {
  const match = file.match(/^(\d{4})_[a-z0-9_]+\.sql$/);
  if (!match) {
    errors.push(`Invalid migration filename: ${file}`);
    continue;
  }

  const version = Number(match[1]);
  if (versions.has(version)) {
    errors.push(`Duplicate migration version: ${match[1]}`);
  }
  versions.add(version);

  const content = readFileSync(join(migrationsDir, file), "utf8").trim();
  if (!content) {
    errors.push(`Empty migration: ${file}`);
  }
}

const orderedVersions = [...versions].sort((a, b) => a - b);
if (orderedVersions.length > 0) {
  for (
    let expected = orderedVersions[0];
    expected <= orderedVersions.at(-1);
    expected += 1
  ) {
    if (!versions.has(expected)) {
      errors.push(`Missing migration version: ${String(expected).padStart(4, "0")}`);
    }
  }
}

if (!existsSync(baselinePath)) {
  errors.push(`Missing production schema baseline: ${baselinePath}`);
} else {
  const baseline = readFileSync(baselinePath, "utf8");
  if (!/CREATE TABLE schema_migrations\s*\(/i.test(baseline)) {
    errors.push("Production baseline does not contain schema_migrations");
  }
}

if (!existsSync(runnerPath)) {
  errors.push(`Missing migration runner: ${runnerPath}`);
} else {
  const runner = readFileSync(runnerPath, "utf8");
  if (!runner.includes('const migrationsDir = "migrations/d1"')) {
    errors.push("Migration runner does not use migrations/d1");
  }
  if (!runner.includes("checksum")) {
    errors.push("Migration runner does not verify checksums");
  }
  if (!runner.includes('process.argv.includes("--apply")')) {
    errors.push("Migration runner must default to dry-run");
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`migration check: ${error}`);
  }
  process.exit(1);
}

console.log(
  `D1 migration structure OK: ${files.length} migrations, ${baselinePath}`,
);
