#!/usr/bin/env python3
"""
Signal Bridge: feed signal discovery candidates into the main keyword pipeline.

Reads unprocessed candidates from signal_candidates table, submits them
to the Worker's expand endpoint (same path as regular seed keywords),
and marks them as processed.

Usage: python3 signal_bridge.py [--dry-run] [--limit N]

Revert: remove the cron job that runs this script.
"""
import os
import sys
import json
import time
import subprocess
import urllib.request
import ssl

# Config
GK_SITE_URL = os.environ.get("GK_SITE_URL", "https://discoverkeywords.co")
GK_API_KEY = os.environ.get("GK_API_KEY", "")

# CF/D1
CF_TOKEN = os.environ.get("CF_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN", "")
CF_ACCOUNT = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
D1_ID = os.environ.get("D1_DB_ID", "")


def d1_query(sql: str, params: list = None) -> list:
    """Execute SQL on D1 and return results."""
    if not (CF_TOKEN and CF_ACCOUNT and D1_ID):
        print("ERROR: CF credentials not configured", file=sys.stderr)
        sys.exit(1)

    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/d1/database/{D1_ID}/query"
    payload = {"sql": sql}
    if params:
        payload["params"] = params

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {CF_TOKEN}",
        "Content-Type": "application/json",
    })
    ctx = ssl.create_default_context()
    resp = json.loads(urllib.request.urlopen(req, context=ctx, timeout=30).read())

    if not resp.get("success"):
        raise Exception(f"D1 query failed: {resp}")
    return resp["result"][0]["results"]


def curl_post(path: str, body: dict, timeout: int = 120):
    """POST to Worker API via curl (same approach as precompute.py)."""
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
    parser = argparse.ArgumentParser(description="Feed signal candidates into the expand pipeline.")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be submitted, don't actually submit")
    parser.add_argument("--limit", type=int, default=20, help="Max candidates to process (default: 20)")
    args = parser.parse_args()

    ts = time.strftime("%Y-%m-%d %H:%M UTC")
    print(f"🚀 Signal Bridge — {ts}", file=sys.stderr)

    # Fetch unprocessed candidates
    try:
        rows = d1_query(
            "SELECT id, keyword, keyword_normalized, signal_score, signal_sources, avg_hotness "
            "FROM signal_candidates WHERE processed = 0 ORDER BY signal_score DESC LIMIT ?",
            [args.limit]
        )
    except Exception as e:
        print(f"ERROR: Failed to query signal_candidates: {e}", file=sys.stderr)
        sys.exit(1)

    if not rows:
        print("No unprocessed signal candidates found.", file=sys.stderr)
        return

    print(f"Found {len(rows)} unprocessed candidates", file=sys.stderr)

    if args.dry_run:
        print(f"\nWould submit {len(rows)} candidates (dry run):", file=sys.stderr)
        for r in rows:
            kw = r["keyword"]
            score = r["signal_score"]
            print(f"  • {kw:45s} (signal_score={score:.1f})", file=sys.stderr)
        return

    # Submit each candidate to the expand pipeline
    submitted = 0
    failed = 0
    for r in rows:
        kw = r["keyword"]
        cid = r["id"]

        body = {
            "keywords": [kw],
            "postbackUrl": f"{GK_SITE_URL}/api/research/webhook",
        }

        print(f"  → expand: {kw}...", end=" ", file=sys.stderr)
        resp, err = curl_post("/api/research/expand", body)
        if err:
            print(f"FAILED: {err}", file=sys.stderr)
            failed += 1
            continue

        # Mark as processed in D1
        try:
            d1_query("UPDATE signal_candidates SET processed = 1 WHERE id = ?", [cid])
        except Exception as e:
            print(f"WARNING: Failed to mark {kw} as processed: {e}", file=sys.stderr)

        print(f"OK (job_id={resp.get('jobId', '?')})", file=sys.stderr)
        submitted += 1

        # Brief pause between submissions
        time.sleep(0.5)

    print(f"\n✅ Bridge complete: {submitted} submitted, {failed} failed", file=sys.stderr)


if __name__ == "__main__":
    main()
