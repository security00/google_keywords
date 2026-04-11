#!/usr/bin/env python3
"""
Precompute script: submit seed keywords via Worker API with postback.
Worker submits to DataForSEO with postback_url, DataForSEO notifies webhook when done.
Script exits immediately after all submissions. No polling.

Usage: python3 precompute.py [--type expand|serp|trends|all] [--dry-run]
"""
import os
import sys
import json
import requests

# Worker API config
GK_SITE_URL = os.environ.get("GK_SITE_URL", "https://discoverkeywords.co")
GK_API_KEY = os.environ.get("GK_API_KEY", "")

# Batch sizes
EXPAND_BATCH = 5
SERP_BATCH = 5
TRENDS_BATCH = 4

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SEED_FILE = os.path.join(os.path.dirname(SCRIPT_DIR), "config", "seed-keywords.txt")

def load_seeds():
    with open(SEED_FILE) as f:
        return [line.strip() for line in f if line.strip()]

def headers():
    return {"Content-Type": "application/json", "Authorization": f"Bearer {GK_API_KEY}"}

def api_post(path, body, timeout=30):
    url = f"{GK_SITE_URL}{path}"
    r = requests.post(url, headers=headers(), json=body, timeout=timeout)
    r.raise_for_status()
    return r.json()

def main():
    if not GK_API_KEY:
        print("ERROR: GK_API_KEY env var required", file=sys.stderr)
        sys.exit(1)

    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--type", default="expand", choices=["expand", "serp", "trends", "all"])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    seeds = load_seeds()
    types = ["expand", "serp", "trends"] if args.type == "all" else [args.type]

    print(f"🚀 Precompute: {len(seeds)} seed keywords", file=sys.stderr)
    print(f"   Site: {GK_SITE_URL}", file=sys.stderr)
    print(f"   Types: {types}", file=sys.stderr)
    if args.dry_run:
        print("   ⚠ DRY RUN", file=sys.stderr)

    total = 0

    if "expand" in types:
        batches = [seeds[i:i+EXPAND_BATCH] for i in range(0, len(seeds), EXPAND_BATCH)]
        print(f"\n📋 Expand: {len(batches)} batches", file=sys.stderr)
        for idx, batch in enumerate(batches):
            if args.dry_run:
                print(f"  Batch {idx+1}: {batch[:3]}...", file=sys.stderr)
                total += len(batch)
                continue
            try:
                result = api_post("/api/research/expand", {
                    "keywords": batch,
                    "useCache": False,
                })
                job_id = result.get("jobId")
                cached = result.get("fromCache", False)
                total += len(batch)
                if cached:
                    print(f"  ✅ Batch {idx+1}/{len(batches)}: cache hit", file=sys.stderr)
                elif job_id:
                    print(f"  ✅ Batch {idx+1}/{len(batches)}: job={job_id[:12]}...", file=sys.stderr)
                else:
                    print(f"  ⚠ Batch {idx+1}/{len(batches)}: {list(result.keys())}", file=sys.stderr)
            except Exception as e:
                print(f"  ❌ Batch {idx+1} failed: {e}", file=sys.stderr)

    if "serp" in types:
        batches = [seeds[i:i+SERP_BATCH] for i in range(0, len(seeds), SERP_BATCH)]
        print(f"\n📋 SERP: {len(batches)} batches", file=sys.stderr)
        for idx, batch in enumerate(batches):
            if args.dry_run:
                print(f"  Batch {idx+1}: {batch[:3]}...", file=sys.stderr)
                total += len(batch)
                continue
            try:
                result = api_post("/api/research/serp", {"keywords": batch})
                cached = result.get("fromCache", False)
                total += len(batch)
                status = "cache hit" if cached else f"{len(result.get('results', {}))} results"
                print(f"  ✅ Batch {idx+1}/{len(batches)}: {status}", file=sys.stderr)
            except Exception as e:
                print(f"  ❌ Batch {idx+1} failed: {e}", file=sys.stderr)

    if "trends" in types:
        batches = [seeds[i:i+TRENDS_BATCH] for i in range(0, len(seeds), TRENDS_BATCH)]
        print(f"\n📋 Trends: {len(batches)} batches", file=sys.stderr)
        for idx, batch in enumerate(batches):
            if args.dry_run:
                print(f"  Batch {idx+1}: {batch[:3]}...", file=sys.stderr)
                total += len(batch)
                continue
            try:
                result = api_post("/api/research/trends", {"keywords": batch})
                cached = result.get("fromCache", False)
                total += len(batch)
                status = "cache hit" if cached else f"{len(result.get('results', []))} results"
                print(f"  ✅ Batch {idx+1}/{len(batches)}: {status}", file=sys.stderr)
            except Exception as e:
                print(f"  ❌ Batch {idx+1} failed: {e}", file=sys.stderr)

    print(f"\n🎉 Done! {total} keyword tasks submitted", file=sys.stderr)
    print("   DataForSEO will postback results to webhook automatically.", file=sys.stderr)
    print("   Students will get cached responses on next request.", file=sys.stderr)

if __name__ == "__main__":
    main()
