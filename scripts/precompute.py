#!/usr/bin/env python3
"""
Precompute script: submit all seed keywords to DataForSEO with postback.
DataForSEO will POST results to our webhook when ready → cache auto-populated.
Script exits immediately after submission. No polling needed.

Usage: python3 precompute.py [--type expand|serp|trends|all] [--dry-run]
"""
import os
import sys
import json
import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
SEED_FILE = os.path.join(PROJECT_DIR, "config", "seed-keywords.txt")
ENV_FILE = os.path.join(PROJECT_DIR, ".env.local")  # or wherever credentials are

# DataForSEO endpoints
DFS_EXPAND_POST = "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/task_post"
DFS_SERP_POST = "https://api.dataforseo.com/v3/serp/google/organic/task_post"

# Our webhook
WEBHOOK_BASE = os.environ.get("WEBHOOK_BASE", "https://discoverkeywords.co")
WEBHOOK_URL = f"{WEBHOOK_BASE}/api/research/webhook"

# Batch sizes
EXPAND_BATCH = 5      # keywords per expand batch
SERP_BATCH = 5        # keywords per serp batch
TRENDS_BATCH = 4      # keywords per trends batch (max 5 keywords including benchmark)

BENCHMARK = "google"   # benchmark keyword for trends comparison

def load_env():
    """Load DataForSEO credentials from .env files."""
    for env_path in [ENV_FILE, os.path.expanduser("~/.openclaw/workspace-potter-dev/.env"), "/root/clawd/.env"]:
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        key, _, val = line.partition("=")
                        key = key.strip()
                        val = val.strip().strip("\"'")
                        if key not in os.environ:
                            os.environ[key] = val

def get_auth():
    login = os.environ.get("DATAFORSEO_LOGIN", "")
    password = os.environ.get("DATAFORSEO_PASSWORD", "")
    if not login or not password:
        print("ERROR: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD required", file=sys.stderr)
        sys.exit(1)
    import base64
    creds = base64.b64encode(f"{login}:{password}".encode()).decode()
    return {"Authorization": f"Basic {creds}", "Content-Type": "application/json"}

def load_seeds():
    with open(SEED_FILE) as f:
        return [line.strip() for line in f if line.strip()]

def today_range():
    from datetime import date, timedelta
    today = date.today()
    return today.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")

def make_cache_key(api_type, keywords, extra=""):
    from datetime import date
    sorted_kw = ",".join(sorted(keywords))
    today = date.today().isoformat()
    return f"{today}:{api_type}:{sorted_kw}{extra}"

def submit_expand(keywords, headers):
    """Submit expand (keyword research) tasks with postback."""
    date_from, date_to = today_range()
    cache_key = make_cache_key("expand", keywords, f":dateFrom={date_from},dateTo={date_to}")
    postback = f"{WEBHOOK_URL}?type=expand&tag={requests.utils.quote(cache_key)}&task_id=$id"

    payload = [{
        "keywords": [kw],
        "date_from": date_from,
        "date_to": date_to,
        "type": "web",
        "item_types": ["google_trends_queries_list"],
        "postback_url": postback,
    } for kw in keywords]

    r = requests.post(DFS_EXPAND_POST, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()
    
    if data.get("status_code") != 20000:
        raise Exception(data.get("status_message", "Expand submit failed"))
    
    task_ids = [t["id"] for t in data.get("tasks", []) if t.get("status_code") == 20100]
    return task_ids

def submit_serp(keywords, headers):
    """Submit SERP analysis tasks with postback."""
    cache_key = make_cache_key("serp", keywords)
    postback = f"{WEBHOOK_URL}?type=serp&tag={requests.utils.quote(cache_key)}&task_id=$id"

    payload = [{
        "keyword": kw,
        "location_name": "United States",
        "language_code": "en",
        "device": "desktop",
        "os": "windows",
        "depth": 10,
        "postback_url": postback,
    } for kw in keywords]

    r = requests.post(DFS_SERP_POST, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()
    
    if data.get("status_code") != 20000:
        raise Exception(data.get("status_message", "SERP submit failed"))
    
    task_ids = [t["id"] for t in data.get("tasks", []) if t.get("status_code") == 20100]
    return task_ids

def submit_trends(keywords, headers):
    """Submit trends comparison tasks with postback."""
    date_from, date_to = today_range()
    cache_key = make_cache_key("trends", keywords, f":benchmark={BENCHMARK}")
    postback = f"{WEBHOOK_URL}?type=trends&tag={requests.utils.quote(cache_key)}&task_id=$id"

    # Batch keywords (max 5 per request including benchmark)
    batches = [keywords[i:i+TRENDS_BATCH] for i in range(0, len(keywords), TRENDS_BATCH)]
    all_task_ids = []

    for batch in batches:
        payload = [{
            "keywords": batch + [BENCHMARK],
            "date_from": date_from,
            "date_to": date_to,
            "type": "web",
            "postback_url": postback,
        }]

        r = requests.post(DFS_EXPAND_POST, headers=headers, json=payload, timeout=30)
        r.raise_for_status()
        data = r.json()

        if data.get("status_code") != 20000:
            raise Exception(data.get("status_message", "Trends submit failed"))

        task_ids = [t["id"] for t in data.get("tasks", []) if t.get("status_code") == 20100]
        all_task_ids.extend(task_ids)

    return all_task_ids

def main():
    load_env()
    headers = get_auth()
    seeds = load_seeds()

    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--type", default="all", choices=["expand", "serp", "trends", "all"])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    types = ["expand", "serp", "trends"] if args.type == "all" else [args.type]
    
    print(f"🚀 Precompute: {len(seeds)} seed keywords", file=sys.stderr)
    print(f"   Webhook: {WEBHOOK_URL}", file=sys.stderr)
    print(f"   Types: {types}", file=sys.stderr)
    if args.dry_run:
        print("   ⚠ DRY RUN - no tasks submitted", file=sys.stderr)

    total_tasks = 0

    if "expand" in types:
        batches = [seeds[i:i+EXPAND_BATCH] for i in range(0, len(seeds), EXPAND_BATCH)]
        print(f"\n📋 Expand: {len(batches)} batches of {EXPAND_BATCH}", file=sys.stderr)
        for idx, batch in enumerate(batches):
            if args.dry_run:
                print(f"  Batch {idx+1}: {batch[:3]}...", file=sys.stderr)
                continue
            try:
                tids = submit_expand(batch, headers)
                total_tasks += len(tids)
                print(f"  ✅ Batch {idx+1}/{len(batches)}: {len(tids)} tasks", file=sys.stderr)
            except Exception as e:
                print(f"  ❌ Batch {idx+1} failed: {e}", file=sys.stderr)

    if "serp" in types:
        batches = [seeds[i:i+SERP_BATCH] for i in range(0, len(seeds), SERP_BATCH)]
        print(f"\n📋 SERP: {len(batches)} batches of {SERP_BATCH}", file=sys.stderr)
        for idx, batch in enumerate(batches):
            if args.dry_run:
                print(f"  Batch {idx+1}: {batch[:3]}...", file=sys.stderr)
                continue
            try:
                tids = submit_serp(batch, headers)
                total_tasks += len(tids)
                print(f"  ✅ Batch {idx+1}/{len(batches)}: {len(tids)} tasks", file=sys.stderr)
            except Exception as e:
                print(f"  ❌ Batch {idx+1} failed: {e}", file=sys.stderr)

    if "trends" in types:
        batches = [seeds[i:i+TRENDS_BATCH] for i in range(0, len(seeds), TRENDS_BATCH)]
        print(f"\n📋 Trends: {len(batches)} batches of {TRENDS_BATCH}", file=sys.stderr)
        for idx, batch in enumerate(batches):
            if args.dry_run:
                print(f"  Batch {idx+1}: {batch[:3]}...", file=sys.stderr)
                continue
            try:
                tids = submit_trends(batch, headers)
                total_tasks += len(tids)
                print(f"  ✅ Batch {idx+1}/{len(batches)}: {len(tids)} tasks", file=sys.stderr)
            except Exception as e:
                print(f"  ❌ Batch {idx+1} failed: {e}", file=sys.stderr)

    print(f"\n🎉 Submitted {total_tasks} tasks total", file=sys.stderr)
    print("   Results will arrive via webhook and be cached automatically.", file=sys.stderr)

if __name__ == "__main__":
    main()
