#!/usr/bin/env python3
import os
import subprocess
import sys
import time
from pathlib import Path

PARTS_DIR = Path(os.getenv("D1_EXPORT_OUT_DIR", "d1_export_parts"))
RETRY_COUNT = int(os.getenv("D1_IMPORT_RETRIES", "3"))
RETRY_DELAY = int(os.getenv("D1_IMPORT_RETRY_DELAY", "3"))


def load_env():
    env_path = Path.cwd() / ".env.local"
    values = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            values[key.strip()] = val.strip().strip('"').strip("'")
    return values


def run_command(cmd, env):
    for attempt in range(1, RETRY_COUNT + 1):
        result = subprocess.run(cmd, env=env, text=True)
        if result.returncode == 0:
            return True
        if attempt < RETRY_COUNT:
            time.sleep(RETRY_DELAY * attempt)
    return False


def main():
    env = load_env()
    token = env.get("CLOUDFLARE_API_TOKEN")
    account_id = env.get("CLOUDFLARE_ACCOUNT_ID")
    db_name = env.get("D1_DATABASE_NAME")
    db_id = env.get("D1_DATABASE_ID")

    if not token or not account_id:
        raise SystemExit("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID in .env.local")
    if not db_name and not db_id:
        raise SystemExit("Missing D1_DATABASE_NAME or D1_DATABASE_ID in .env.local")

    db_target = db_name or db_id

    schema_file = PARTS_DIR / "schema.sql"
    index_file = PARTS_DIR / "indexes.sql"
    data_files = sorted(PARTS_DIR.glob("data_*.sql"))
    if not schema_file.exists():
        raise SystemExit(f"missing {schema_file}")
    if not data_files:
        raise SystemExit("no data files found in d1_export_parts/")

    cmd_base = ["npx", "--yes", "wrangler", "d1", "execute", db_target, "--remote"]
    env_run = os.environ.copy()
    env_run["CLOUDFLARE_API_TOKEN"] = token
    env_run["CLOUDFLARE_ACCOUNT_ID"] = account_id

    print("import: schema")
    if not run_command(cmd_base + ["--file", str(schema_file)], env_run):
        raise SystemExit("schema import failed")

    for data_file in data_files:
        print(f"import: {data_file.name}")
        if not run_command(cmd_base + ["--file", str(data_file)], env_run):
            raise SystemExit(f"data import failed: {data_file.name}")

    if index_file.exists():
        print("import: indexes")
        if not run_command(cmd_base + ["--file", str(index_file)], env_run):
            raise SystemExit("index import failed")

    print("import complete")


if __name__ == "__main__":
    main()
