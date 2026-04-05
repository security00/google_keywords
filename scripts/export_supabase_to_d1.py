#!/usr/bin/env python3
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_PAGE_SIZE = int(os.getenv("EXPORT_PAGE_SIZE", "200"))
REQUEST_TIMEOUT = int(os.getenv("EXPORT_FETCH_TIMEOUT_MS", "30000")) / 1000
OUTPUT_SQL = Path.cwd() / "d1_export.sql"

TABLES = [
    "research_sessions",
    "candidates",
    "comparisons",
    "comparison_results",
]

SCHEMA = {
    "research_sessions": {
        "columns": [
            ("id", "TEXT"),
            ("user_id", "TEXT"),
            ("title", "TEXT"),
            ("keywords", "TEXT"),  # JSON
            ("date_from", "TEXT"),
            ("date_to", "TEXT"),
            ("benchmark", "TEXT"),
            ("include_top", "INTEGER"),
            ("use_filter", "INTEGER"),
            ("filter_terms", "TEXT"),  # JSON
            ("filter_prompt", "TEXT"),
            ("filter_summary", "TEXT"),  # JSON
            ("created_at", "TEXT"),
        ],
        "indexes": [
            "create index if not exists idx_sessions_user_created on research_sessions (user_id, created_at desc);",
        ],
    },
    "candidates": {
        "columns": [
            ("id", "TEXT"),
            ("session_id", "TEXT"),
            ("user_id", "TEXT"),
            ("keyword", "TEXT"),
            ("value", "INTEGER"),
            ("type", "TEXT"),
            ("source", "TEXT"),
            ("filtered", "INTEGER"),
            ("created_at", "TEXT"),
        ],
        "indexes": [
            "create index if not exists idx_candidates_session on candidates (session_id);",
        ],
    },
    "comparisons": {
        "columns": [
            ("id", "TEXT"),
            ("session_id", "TEXT"),
            ("user_id", "TEXT"),
            ("benchmark", "TEXT"),
            ("date_from", "TEXT"),
            ("date_to", "TEXT"),
            ("summary", "TEXT"),  # JSON
            ("recent_points", "INTEGER"),
            ("metrics_version", "TEXT"),
            ("created_at", "TEXT"),
        ],
        "indexes": [
            "create index if not exists idx_comparisons_session on comparisons (session_id);",
        ],
    },
    "comparison_results": {
        "columns": [
            ("id", "TEXT"),
            ("comparison_id", "TEXT"),
            ("user_id", "TEXT"),
            ("keyword", "TEXT"),
            ("avg_value", "REAL"),
            ("benchmark_value", "REAL"),
            ("ratio", "REAL"),
            ("ratio_mean", "REAL"),
            ("ratio_recent", "REAL"),
            ("ratio_coverage", "REAL"),
            ("ratio_peak", "REAL"),
            ("slope_diff", "REAL"),
            ("volatility", "REAL"),
            ("crossings", "INTEGER"),
            ("verdict", "TEXT"),
            ("trend_series", "TEXT"),  # JSON
            ("explanation", "TEXT"),  # JSON
            ("intent", "TEXT"),  # JSON
            ("created_at", "TEXT"),
        ],
        "indexes": [
            "create index if not exists idx_results_comparison on comparison_results (comparison_id);",
        ],
    },
}


def load_env():
    env_path = Path.cwd() / ".env.local"
    if not env_path.exists():
        return {}
    raw = env_path.read_text(encoding="utf-8")
    values = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        values[key] = val
    return values


def escape_sql(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def serialize_json(value):
    if value is None:
        return None
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


def format_value(column, value):
    if value is None:
        return None
    if column in {"keywords", "filter_terms"}:
        return serialize_json(value)
    if column in {"filter_summary", "summary", "trend_series", "explanation", "intent"}:
        return serialize_json(value)
    if column in {"include_top", "use_filter", "filtered"}:
        return 1 if value else 0
    return value


def fetch_table(base_url, api_key, table):
    offset = 0
    rows = []
    while True:
        params = {
            "select": "*",
            "limit": str(DEFAULT_PAGE_SIZE),
            "offset": str(offset),
        }
        url = f"{base_url}/rest/v1/{table}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": api_key,
                "Authorization": f"Bearer {api_key}",
            },
        )
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if not data:
            break
        rows.extend(data)
        if len(data) < DEFAULT_PAGE_SIZE:
            break
        offset += DEFAULT_PAGE_SIZE
        time.sleep(0.2)
    return rows


def build_create_sql(table_name):
    defn = SCHEMA[table_name]
    cols = ",\n".join([f"  {name} {dtype}" for name, dtype in defn["columns"]])
    return f"create table if not exists {table_name} (\n{cols}\n);"


def build_inserts(table_name, rows):
    if not rows:
        return []
    defn = SCHEMA[table_name]
    columns = [name for name, _ in defn["columns"]]
    statements = []
    for row in rows:
        values = [escape_sql(format_value(col, row.get(col))) for col in columns]
        statements.append(
            f"insert into {table_name} ({', '.join(columns)}) values ({', '.join(values)});"
        )
    return statements


def main():
    env = load_env()
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        raise SystemExit("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")

    sql_lines = ["pragma foreign_keys = off;", "begin transaction;"]

    for table in TABLES:
        print(f"exporting {table}...")
        rows = fetch_table(supabase_url, service_key, table)
        sql_lines.append(build_create_sql(table))
        sql_lines.extend(build_inserts(table, rows))
        print(f"  -> {len(rows)} rows")

    for table in TABLES:
        for idx in SCHEMA[table].get("indexes", []):
            sql_lines.append(idx)

    sql_lines.extend(["commit;", "pragma foreign_keys = on;"])
    OUTPUT_SQL.write_text("\n".join(sql_lines) + "\n", encoding="utf-8")
    print(f"done. sql written to {OUTPUT_SQL}")


if __name__ == "__main__":
    main()
