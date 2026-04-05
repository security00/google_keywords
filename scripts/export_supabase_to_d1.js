#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_PAGE_SIZE = Number(process.env.EXPORT_PAGE_SIZE || 200);
const FETCH_TIMEOUT_MS = Number(process.env.EXPORT_FETCH_TIMEOUT_MS || 30000);
const FETCH_RETRIES = 3;
const OUTPUT_SQL = path.join(process.cwd(), "d1_export.sql");

const TABLES = [
  "research_sessions",
  "candidates",
  "comparisons",
  "comparison_results",
];

const SCHEMA = {
  research_sessions: {
    columns: [
      ["id", "TEXT"],
      ["user_id", "TEXT"],
      ["title", "TEXT"],
      ["keywords", "TEXT"], // JSON
      ["date_from", "TEXT"],
      ["date_to", "TEXT"],
      ["benchmark", "TEXT"],
      ["include_top", "INTEGER"],
      ["use_filter", "INTEGER"],
      ["filter_terms", "TEXT"], // JSON
      ["filter_prompt", "TEXT"],
      ["filter_summary", "TEXT"], // JSON
      ["created_at", "TEXT"],
    ],
    indexes: [
      "create index if not exists idx_sessions_user_created on research_sessions (user_id, created_at desc);",
    ],
  },
  candidates: {
    columns: [
      ["id", "TEXT"],
      ["session_id", "TEXT"],
      ["user_id", "TEXT"],
      ["keyword", "TEXT"],
      ["value", "INTEGER"],
      ["type", "TEXT"],
      ["source", "TEXT"],
      ["filtered", "INTEGER"],
      ["created_at", "TEXT"],
    ],
    indexes: [
      "create index if not exists idx_candidates_session on candidates (session_id);",
    ],
  },
  comparisons: {
    columns: [
      ["id", "TEXT"],
      ["session_id", "TEXT"],
      ["user_id", "TEXT"],
      ["benchmark", "TEXT"],
      ["date_from", "TEXT"],
      ["date_to", "TEXT"],
      ["summary", "TEXT"], // JSON
      ["recent_points", "INTEGER"],
      ["metrics_version", "TEXT"],
      ["created_at", "TEXT"],
    ],
    indexes: [
      "create index if not exists idx_comparisons_session on comparisons (session_id);",
    ],
  },
  comparison_results: {
    columns: [
      ["id", "TEXT"],
      ["comparison_id", "TEXT"],
      ["user_id", "TEXT"],
      ["keyword", "TEXT"],
      ["avg_value", "REAL"],
      ["benchmark_value", "REAL"],
      ["ratio", "REAL"],
      ["ratio_mean", "REAL"],
      ["ratio_recent", "REAL"],
      ["ratio_coverage", "REAL"],
      ["ratio_peak", "REAL"],
      ["slope_diff", "REAL"],
      ["volatility", "REAL"],
      ["crossings", "INTEGER"],
      ["verdict", "TEXT"],
      ["trend_series", "TEXT"], // JSON
      ["explanation", "TEXT"], // JSON
      ["intent", "TEXT"], // JSON
      ["created_at", "TEXT"],
    ],
    indexes: [
      "create index if not exists idx_results_comparison on comparison_results (comparison_id);",
    ],
  },
};

const loadEnv = () => {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, "utf8");
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (
      (val.startsWith("\"") && val.endsWith("\"")) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    values[key] = val;
  }
  return values;
};

const escapeSql = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
};

const serializeJson = (value) => {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatValue = (column, value) => {
  if (value === null || value === undefined) return null;

  if (column === "keywords" || column === "filter_terms") {
    return serializeJson(value);
  }

  if (
    column === "filter_summary" ||
    column === "summary" ||
    column === "trend_series" ||
    column === "explanation" ||
    column === "intent"
  ) {
    return serializeJson(value);
  }

  if (column === "include_top" || column === "use_filter" || column === "filtered") {
    return value ? 1 : 0;
  }

  return value;
};

const fetchWithTimeout = async (url, options) => {
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (attempt >= FETCH_RETRIES - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("fetch failed");
};

const fetchTable = async (baseUrl, apiKey, table) => {
  let offset = 0;
  const rows = [];

  while (true) {
    const url = new URL(`${baseUrl}/rest/v1/${table}`);
    url.searchParams.set("select", "*");
    url.searchParams.set("limit", String(DEFAULT_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    const res = await fetchWithTimeout(url.toString(), {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${table} fetch failed: ${res.status} ${text}`);
    }

    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < DEFAULT_PAGE_SIZE) break;
    offset += DEFAULT_PAGE_SIZE;
  }

  return rows;
};

const buildCreateTableSql = (tableName) => {
  const def = SCHEMA[tableName];
  if (!def) throw new Error(`Missing schema for ${tableName}`);
  const columns = def.columns
    .map(([name, type]) => `  ${name} ${type}`)
    .join(",\n");
  return `create table if not exists ${tableName} (\n${columns}\n);`;
};

const buildInsertSql = (tableName, rows) => {
  if (rows.length === 0) return [];
  const def = SCHEMA[tableName];
  const columns = def.columns.map(([name]) => name);
  const inserts = [];

  for (const row of rows) {
    const values = columns.map((col) => {
      const formatted = formatValue(col, row[col]);
      return escapeSql(formatted);
    });
    inserts.push(
      `insert into ${tableName} (${columns.join(", ")}) values (${values.join(", ")});`
    );
  }
  return inserts;
};

const main = async () => {
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const sqlLines = [
    "pragma foreign_keys = off;",
    "begin transaction;",
  ];

  for (const table of TABLES) {
    console.log(`exporting ${table}...`);
    const rows = await fetchTable(supabaseUrl, serviceKey, table);
    sqlLines.push(buildCreateTableSql(table));
    sqlLines.push(...buildInsertSql(table, rows));
    console.log(`  -> ${rows.length} rows`);
  }

  for (const table of TABLES) {
    const def = SCHEMA[table];
    for (const idx of def.indexes ?? []) {
      sqlLines.push(idx);
    }
  }

  sqlLines.push("commit;");
  sqlLines.push("pragma foreign_keys = on;");

  fs.writeFileSync(OUTPUT_SQL, `${sqlLines.join("\n")}\n`, "utf8");
  console.log(`done. sql written to ${OUTPUT_SQL}`);
};

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
