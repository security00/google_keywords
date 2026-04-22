#!/usr/bin/env python3
"""
Fetch community signals (Hacker News + GitHub) for keywords.

Usage:
  export GITHUB_TOKEN=xxx
  python3 scripts/fetch_community_signals.py "keyword1" "keyword2"
  echo "synthesia\ncopyleaks\nrunway" | python3 scripts/fetch_community_signals.py
"""
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Cloudflare D1
CF_API_TOKEN = os.environ.get("CF_API_TOKEN", os.environ.get("CLOUDFLARE_API_TOKEN"))
CF_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", os.environ.get("CLOUDFLARE_ACCOUNT_ID"))
D1_DB_ID = os.environ.get("D1_DB_ID", "b40de8a4-75e1-4df6-a84d-3ecd62b70538")

# GitHub
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
if not GITHUB_TOKEN:
    print("ERROR: GITHUB_TOKEN env var required", file=sys.stderr)
    sys.exit(1)

CACHE_HOURS = 24


def normalize_keyword(keyword: str) -> str:
    """Lowercase and strip whitespace."""
    return keyword.strip().lower()


def fetch_hn_signal(keyword: str) -> dict:
    """Fetch top HN story for keyword."""
    try:
        url = f"https://hn.algolia.com/api/v1/search?query={urllib.parse.quote(keyword)}&tags=story&hitsPerPage=1"
        resp = json.loads(urllib.request.urlopen(url, timeout=10).read())
        if resp.get("hits"):
            hit = resp["hits"][0]
            return {
                "hn_points": hit.get("points", 0) or 0,
                "hn_comments": hit.get("num_comments", 0) or 0,
                "hn_title": hit.get("title", "") or "",
                "hn_url": hit.get("url", "") or "",
                "hn_created_at": hit.get("created_at", "") or "",
                "hn_object_id": hit.get("objectID", "") or "",
            }
    except Exception as exc:
        print(f"  HN fetch failed: {exc}", file=sys.stderr)
    return {
        "hn_points": 0,
        "hn_comments": 0,
        "hn_title": "",
        "hn_url": "",
        "hn_created_at": "",
        "hn_object_id": "",
    }


def fetch_github_signal(keyword: str) -> dict:
    """Fetch top GitHub repo for keyword."""
    try:
        url = f"https://api.github.com/search/repositories?q={urllib.parse.quote(keyword)}&sort=stars&order=desc&per_page=1"
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {GITHUB_TOKEN}",
            "Accept": "application/vnd.github.v3+json"
        })
        resp = json.loads(urllib.request.urlopen(req, timeout=10).read())
        if resp.get("items"):
            item = resp["items"][0]
            return {
                "github_stars": item.get("stargazers_count", 0) or 0,
                "github_repo_name": item.get("full_name", "") or "",
                "github_url": item.get("html_url", "") or "",
                "github_language": item.get("language", "") or "",
                "github_created_at": item.get("created_at", "") or "",
            }
    except Exception as exc:
        print(f"  GitHub fetch failed: {exc}", file=sys.stderr)
    return {
        "github_stars": 0,
        "github_repo_name": "",
        "github_url": "",
        "github_language": "",
        "github_created_at": "",
    }


def get_existing_signal(keyword_norm: str) -> dict | None:
    """Check if we have cached signal for keyword."""
    if not CF_API_TOKEN or not CF_ACCOUNT_ID:
        return None
    try:
        ctx = ssl.create_default_context()
        url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{D1_DB_ID}/query"
        sql = "SELECT * FROM community_signals WHERE keyword_normalized = ?"
        data = json.dumps({"sql": sql, "params": [keyword_norm]}).encode()
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"},
        )
        resp = json.loads(urllib.request.urlopen(req, context=ctx, timeout=10).read())
        if resp["result"][0]["results"]:
            return resp["result"][0]["results"][0]
    except Exception as exc:
        print(f"  D1 check failed: {exc}", file=sys.stderr)
    return None


def save_signal(keyword_norm: str, hn: dict, gh: dict) -> bool:
    """Save community signal to D1."""
    if not CF_API_TOKEN or not CF_ACCOUNT_ID:
        print("  Skipping save (no CF creds)", file=sys.stderr)
        return False
    try:
        import uuid
        import ssl

        ctx = ssl.create_default_context()
        url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{D1_DB_ID}/query"

        # Check if exists
        existing = get_existing_signal(keyword_norm)
        now = datetime.now(timezone.utc).isoformat()

        if existing:
            # Update
            sql = """UPDATE community_signals
                     SET hn_points = ?, hn_comments = ?, hn_title = ?, hn_url = ?,
                         hn_created_at = ?, hn_object_id = ?, github_stars = ?,
                         github_repo_name = ?, github_url = ?, github_language = ?,
                         github_created_at = ?, updated_at = ?
                     WHERE keyword_normalized = ?"""
            params = [
                hn["hn_points"], hn["hn_comments"], hn["hn_title"], hn["hn_url"],
                hn["hn_created_at"], hn["hn_object_id"], gh["github_stars"],
                gh["github_repo_name"], gh["github_url"], gh["github_language"],
                gh["github_created_at"], now, keyword_norm
            ]
        else:
            # Insert
            sql = """INSERT INTO community_signals
                     (id, keyword_normalized, hn_points, hn_comments, hn_title, hn_url,
                      hn_created_at, hn_object_id, github_stars, github_repo_name,
                      github_url, github_language, github_created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""
            record_id = str(uuid.uuid4())
            params = [
                record_id, keyword_norm, hn["hn_points"], hn["hn_comments"], hn["hn_title"], hn["hn_url"],
                hn["hn_created_at"], hn["hn_object_id"], gh["github_stars"], gh["github_repo_name"],
                gh["github_url"], gh["github_language"], gh["github_created_at"], now
            ]

        data = json.dumps({"sql": sql, "params": params}).encode()
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"},
        )
        resp = json.loads(urllib.request.urlopen(req, context=ctx, timeout=10).read())
        return resp["success"]
    except Exception as exc:
        print(f"  D1 save failed: {exc}", file=sys.stderr)
    return False


def should_refresh(updated_at: str | None) -> bool:
    """Check if cache is older than CACHE_HOURS."""
    if not updated_at:
        return True
    try:
        updated = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        age = datetime.now(timezone.utc) - updated
        return age.total_seconds() > CACHE_HOURS * 3600
    except:
        return True


def process_keyword(keyword: str) -> dict:
    """Process a single keyword."""
    norm = normalize_keyword(keyword)
    print(f"\n📊 {keyword}", file=sys.stderr)

    # Check cache
    existing = get_existing_signal(norm)
    if existing and not should_refresh(existing.get("updated_at")):
        age_hours = (datetime.now(timezone.utc) - datetime.fromisoformat(existing["updated_at"].replace("Z", "+00:00"))).total_seconds() / 3600
        print(f"  🔄 Cached ({age_hours:.0f}h ago)", file=sys.stderr)
        return {
            "keyword": keyword,
            "hn_points": existing.get("hn_points", 0),
            "hn_comments": existing.get("hn_comments", 0),
            "github_stars": existing.get("github_stars", 0),
            "cached": True,
        }

    # Fetch fresh data
    print(f"  🔍 Fetching HN...", file=sys.stderr)
    hn = fetch_hn_signal(keyword)
    print(f"  🔍 Fetching GitHub...", file=sys.stderr)
    gh = fetch_github_signal(keyword)

    # Save
    print(f"  💾 Saving...", file=sys.stderr)
    save_signal(norm, hn, gh)

    print(f"  ✅ HN: {hn['hn_points']} pts, {hn['hn_comments']} comments | GitHub: {gh['github_stars']} stars", file=sys.stderr)
    return {
        "keyword": keyword,
        "hn_points": hn["hn_points"],
        "hn_comments": hn["hn_comments"],
        "github_stars": gh["github_stars"],
        "cached": False,
    }


def main():
    # Read keywords from args or stdin
    if len(sys.argv) > 1:
        # If first arg is a file, read keywords from it (one per line)
        if len(sys.argv) == 2 and Path(sys.argv[1]).is_file():
            keywords = Path(sys.argv[1]).read_text().strip().splitlines()
        else:
            keywords = sys.argv[1:]
    else:
        keywords = [line.strip() for line in sys.stdin if line.strip()]

    if not keywords:
        print("Usage: python3 fetch_community_signals.py <keyword1> <keyword2> ...", file=sys.stderr)
        print("   or: echo 'kw1\\nkw2' | python3 fetch_community_signals.py", file=sys.stderr)
        sys.exit(1)

    print(f"🚀 Fetching community signals for {len(keywords)} keywords...", file=sys.stderr)

    results = []
    for i, kw in enumerate(keywords, 1):
        print(f"[{i}/{len(keywords)}]", file=sys.stderr)
        results.append(process_keyword(kw))
        time.sleep(0.5)  # Rate limit

    print(f"\n✅ Done! Processed {len(results)} keywords", file=sys.stderr)


if __name__ == "__main__":
    main()
