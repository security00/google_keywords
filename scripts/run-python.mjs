#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/run-python.mjs <python arguments>");
  process.exit(2);
}

const candidates =
  process.platform === "win32"
    ? [
        { command: "py", prefix: ["-3"] },
        { command: "python", prefix: [] },
        { command: "python3", prefix: [] },
      ]
    : [
        { command: "python3", prefix: [] },
        { command: "python", prefix: [] },
      ];

for (const candidate of candidates) {
  const result = spawnSync(candidate.command, [...candidate.prefix, ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
      PYTHONUTF8: process.env.PYTHONUTF8 || "1",
    },
  });

  if (result.error?.code === "ENOENT") {
    continue;
  }

  if (result.error) {
    console.error(`Failed to start ${candidate.command}: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

console.error("Python 3 was not found. Install Python 3 or add it to PATH.");
process.exit(127);
