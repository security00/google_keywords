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
import subprocess
import time

# Worker API config
GK_SITE_URL = os.environ.get("GK_SITE_URL", "https://discoverkeywords.co")
GK_API_KEY = os.environ.get("GK_API_KEY", "")

# Batch sizes (conservative to avoid Worker CPU timeout)
EXPAND_BATCH = 5
SERP_BATCH = 10
TRENDS_BATCH = 5

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SEED_FILE = os.path.join(os.path.dirname(SCRIPT_DIR), "config", "seed-keywords.txt")


def load_seeds():
    with open(SEED_FILE) as f:
        return [line.strip() for line in f if line.strip()]


def curl_post(path, body, timeout=120):
    """Use curl subprocess to avoid CF challenge blocking Python requests."""
    url = f"{GK_SITE_URL}{path}"
    payload = json.dumps(body)
    cmd = [
        "curl", "-sL", "--max-time", str(timeout), url,
        "-H", "Content-Type: application/json",
        "-H", f"Authorization: Bearer {GK_API_KEY}",
        "-d", payload,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 10)
        if result.returncode != 0:
            return None, f"curl exit {result.returncode}: {result.stderr[:200]}"
        return json.loads(result.stdout), None
    except json.JSONDecodeError as e:
        return None, f"JSON parse error: {e}"
    except subprocess.TimeoutExpired:
        return None, "curl timed out"
    except Exception as e:
        return None, str(e)


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

    ts = time.strftime("%Y-%m-%d %H:%M UTC")
    print(f"🚀 Precompute — {ts}", file=sys.stderr)
    print(f"   Seeds: {len(seeds)} keywords", file=sys.stderr)
    print(f"   Site: {GK_SITE_URL}", file=sys.stderr)
    print(f"   Types: {types}", file=sys.stderr)
    if args.dry_run:
        print("   ⚠ DRY RUN", file=sys.stderr)

    total = 0
    failed = 0
    cached = 0

    if "expand" in types:
        batches = [seeds[i:i+EXPAND_BATCH] for i in range(0, len(seeds), EXPAND_BATCH)]
        print(f"\n📋 Expand: {len(batches)} batches (batch_size={EXPAND_BATCH})", file=sys.stderr)
        for idx, batch in enumerate(batches):
            if args.dry_run:
                print(f"  Batch {idx+1}/{len(batches)}: {batch[:3]}...", file=sys.stderr)
                total += len(batch)
                continue
            result, err = curl_post("/api/research/expand", {
                "keywords": batch,
                "useCache": False,
            })
            if err:
                print(f"  ❌ Batch {idx+1}/{len(batches)}: {err}", file=sys.stderr)
                failed += len(batch)
            else:
                job_id = result.get("jobId")
                is_cached = result.get("fromCache", False)
                total += len(batch)
                if is_cached:
                    cached += len(batch)
                    print(f"  ✅ Batch {idx+1}/{len(batches)}: cache hit ({len(batch)} kw)", file=sys.stderr)
                elif job_id:
                    print(f"  ✅ Batch {idx+1}/{len(batches)}: submitted job={job_id[:12]}... ({len(batch)} kw)", file=sys.stderr)
                else:
                    print(f"  ⚠ Batch {idx+1}/{len(batches)}: unexpected response {list(result.keys())}", file=sys.stderr)
                    failed += len(batch)

    if "serp" in types:
        batches = [seeds[i:i+SERP_BATCH] for i in range(0, len(seeds), SERP_BATCH)]
        print(f"\n📋 SERP: {len(batches)} batches (batch_size={SERP_BATCH})", file=sys.stderr)
        for idx, batch in enumerate(batches):
            if args.dry_run:
                print(f"  Batch {idx+1}/{len(batches)}: {batch[:3]}...", file=sys.stderr)
                total += len(batch)
                continue
            result, err = curl_post("/api/research/serp", {"keywords": batch})
            if err:
                print(f"  ❌ Batch {idx+1}/{len(batches)}: {err}", file=sys.stderr)
                failed += len(batch)
            else:
                is_cached = result.get("fromCache", False)
                total += len(batch)
                n = len(result.get("results", {})) if not is_cached else len(batch)
                if is_cached:
                    cached += len(batch)
                print(f"  ✅ Batch {idx+1}/{len(batches)}: {n} results (cache={is_cached})", file=sys.stderr)

    if "trends" in types:
        batches = [seeds[i:i+TRENDS_BATCH] for i in range(0, len(seeds), TRENDS_BATCH)]
        print(f"\n📋 Trends: {len(batches)} batches (batch_size={TRENDS_BATCH})", file=sys.stderr)
        for idx, batch in enumerate(batches):
            if args.dry_run:
                print(f"  Batch {idx+1}/{len(batches)}: {batch[:3]}...", file=sys.stderr)
                total += len(batch)
                continue
            result, err = curl_post("/api/research/trends", {"keywords": batch})
            if err:
                print(f"  ❌ Batch {idx+1}/{len(batches)}: {err}", file=sys.stderr)
                failed += len(batch)
            else:
                is_cached = result.get("fromCache", False)
                total += len(batch)
                n = len(result.get("results", [])) if not is_cached else len(batch)
                if is_cached:
                    cached += len(batch)
                print(f"  ✅ Batch {idx+1}/{len(batches)}: {n} results (cache={is_cached})", file=sys.stderr)

    print(f"\n{'='*60}", file=sys.stderr)
    print(f"📊 SUMMARY — {ts}", file=sys.stderr)
    print(f"   Total: {total} keyword tasks", file=sys.stderr)
    print(f"   Cached: {cached} (already pre-computed)", file=sys.stderr)
    print(f"   New: {total - cached - failed} (submitted)", file=sys.stderr)
    print(f"   Failed: {failed}", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)
    print("   Expand jobs: DataForSEO will postback to webhook automatically.", file=sys.stderr)
    print("   SERP/Trends: cached immediately in D1.", file=sys.stderr)


if __name__ == "__main__":
    main()
