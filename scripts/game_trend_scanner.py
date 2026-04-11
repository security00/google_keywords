#!/usr/bin/env python3
"""
Game Trend Scanner — 每天从大站抓新游戏，对比 GPTS 趋势，存入 D1。

流程：
1. 从 CrazyGames /new 页面抓最新游戏（~70个/页）
2. 过滤：排除已在 game_keyword_pipeline 中 status=done 的
3. 分批调 /api/research/trends 对比 GPTS
4. 筛选 ratio > 0.3 且在涨的 → 标记为 worth_doing
5. 结果存入 game_keyword_pipeline

用法：
  python3 scripts/game_trend_scanner.py [--dry-run] [--max-keywords 50] [--api-url https://discoverkeywords.co]
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

# ─── Config ───────────────────────────────────────────────────────────
D1_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "")
D1_API_TOKEN = os.environ.get("CF_API_TOKEN", "")
D1_DATABASE_ID = "b40de8a4-75e1-4df6-a84d-3ecd62b70538"
API_URL = os.environ.get("GK_API_URL", "https://discoverkeywords.co")
API_KEY = os.environ.get("GK_API_KEY", "")

GAME_SITES = [
    # CrazyGames new games page (JSON API, ~70 per page)
    {
        "name": "crazygames",
        "url": "https://www.crazygames.com/new",
        "type": "nextjs",
    },
]

TREND_BENCHMARK = "gpts"
TREND_MONTHS = 3  # 90 days
# Thresholds
MIN_RATIO = 0.3
MIN_SLOPE = 0.0  # slopeRatio > 0 means trending up
BATCH_SIZE = 5  # trends API: smaller batches to avoid Worker CPU timeout

# ─── Helpers ──────────────────────────────────────────────────────────

def fetch_json(url, headers=None):
    """Fetch URL using curl and parse JSON."""
    import subprocess
    cmd = ["curl", "-sL", url, "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"]
    if headers:
        for k, v in headers.items():
            cmd.extend(["-H", f"{k}: {v}"])
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        raw = result.stdout
        # If HTML, try to extract __NEXT_DATA__ JSON
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', raw, re.DOTALL)
        if m:
            return json.loads(m.group(1))
        # Otherwise try direct JSON parse
        return json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"  ⚠️ JSON parse failed for {url}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  ⚠️ Fetch failed for {url}: {e}", file=sys.stderr)
        return None


def extract_crazygames_new(data):
    """Extract game names from CrazyGames __NEXT_DATA__ JSON."""
    games = []
    try:
        items = data["props"]["pageProps"]["games"]["items"]
        for item in items:
            name = item.get("name", "").strip()
            slug = item.get("slug", "")
            if name and len(name) >= 3:
                games.append({"name": name, "slug": slug, "source": "crazygames"})
    except (KeyError, TypeError) as e:
        print(f"  ⚠️ Parse error: {e}", file=sys.stderr)
    return games


def d1_query(sql, params=None):
    """Execute D1 HTTP API query."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{D1_ACCOUNT_ID}/d1/database/{D1_DATABASE_ID}/query"
    payload = {"sql": sql, "params": params or []}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {D1_API_TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            if result.get("success"):
                return result["result"][0].get("results", [])
            else:
                print(f"  ⚠️ D1 error: {result.get('errors', [])}", file=sys.stderr)
                return []
    except Exception as e:
        print(f"  ⚠️ D1 query failed: {e}", file=sys.stderr)
        return []


def d1_execute(sql, params=None):
    """Execute D1 HTTP API statement (INSERT/UPDATE)."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{D1_ACCOUNT_ID}/d1/database/{D1_DATABASE_ID}/query"
    payload = {"sql": sql, "params": params or []}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {D1_API_TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("success", False)
    except Exception as e:
        print(f"  ⚠️ D1 execute failed: {e}", file=sys.stderr)
        return False


def get_already_processed():
    """Get set of keywords already processed (status=done or checking)."""
    rows = d1_query(
        "SELECT keyword FROM game_keyword_pipeline WHERE status IN ('done', 'checking', 'worth_doing')"
    )
    return {r["keyword"].lower() for r in rows}


def call_trends_api(keywords):
    """Call /api/research/trends with keywords, return results."""
    import subprocess
    url = f"{API_URL}/api/research/trends"
    payload = json.dumps({
        "keywords": keywords,
        "months": TREND_MONTHS,
        "benchmark": TREND_BENCHMARK,
    })
    cmd = [
        "curl", "-sL", "--max-time", "120", url,
        "-H", "Content-Type: application/json",
        "-H", f"Authorization: Bearer {API_KEY}",
        "-d", payload,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=130)
        if result.returncode != 0:
            print(f"  ⚠️ curl exit code {result.returncode}: {result.stderr[:200]}", file=sys.stderr)
            return None
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        print(f"  ⚠️ JSON parse failed: {e}", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print(f"  ⚠️ curl timed out after 120s", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  ⚠️ Trends API failed: {e}", file=sys.stderr)
        return None


def save_result(keyword, source_site, ratio, slope, verdict):
    """Save trend result to D1."""
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    return d1_execute(
        """INSERT OR REPLACE INTO game_keyword_pipeline 
           (keyword, source_site, trend_ratio, trend_slope, trend_verdict, trend_checked_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        [keyword, source_site, ratio, slope, verdict, now, "done"]
    )


def is_game_name_valid(name):
    """Filter out obviously bad game names."""
    name_lower = name.lower().strip()
    # Too short
    if len(name_lower) < 3:
        return False
    # Pure numbers
    if re.match(r"^[0-9\s]+$", name_lower):
        return False
    # Too generic (single common words that aren't game names)
    generic = {"game", "play", "free", "online", "new", "top", "best", "all"}
    if name_lower in generic:
        return False
    return True


# ─── Main ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Game Trend Scanner")
    parser.add_argument("--dry-run", action="store_true", help="Don't save to D1")
    parser.add_argument("--max-keywords", type=int, default=50, help="Max keywords to check")
    parser.add_argument("--api-url", default=None, help="Override API URL")
    args = parser.parse_args()

    global API_URL
    if args.api_url:
        API_URL = args.api_url

    if not D1_ACCOUNT_ID or not D1_API_TOKEN:
        print("❌ Missing CF_ACCOUNT_ID or CF_API_TOKEN env vars", file=sys.stderr)
        sys.exit(1)

    print(f"🎮 Game Trend Scanner — {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"   Max keywords: {args.max_keywords}, Dry run: {args.dry_run}")

    # Step 1: Fetch new games from all sources
    all_games = []
    for site in GAME_SITES:
        print(f"\n📡 Fetching from {site['name']}...")
        data = fetch_json(site["url"])
        if not data:
            print(f"  ❌ Failed to fetch")
            continue

        if site["type"] == "nextjs":
            games = extract_crazygames_new(data)
        else:
            games = []

        print(f"  Found {len(games)} games")
        all_games.extend(games)

    # Deduplicate by name
    seen = set()
    unique_games = []
    for g in all_games:
        key = g["name"].lower()
        if key not in seen and is_game_name_valid(g["name"]):
            seen.add(key)
            unique_games.append(g)

    print(f"\n📋 Total unique valid games: {len(unique_games)}")

    # Step 2: Filter out already processed
    processed = get_already_processed()
    new_games = [g for g in unique_games if g["name"].lower() not in processed]

    print(f"🆕 New (not yet processed): {len(new_games)}")

    if not new_games:
        print("✅ All caught up, nothing new to check.")
        return

    # Limit to max_keywords
    to_check = new_games[:args.max_keywords]
    print(f"🔍 Will check: {len(to_check)} keywords")

    # Step 3: Batch call trends API
    results = []
    for i in range(0, len(to_check), BATCH_SIZE):
        batch = to_check[i:i + BATCH_SIZE]
        keywords = [g["name"] for g in batch]
        print(f"\n📈 Batch {i // BATCH_SIZE + 1}: {keywords}")

        resp = call_trends_api(keywords)
        if not resp:
            print("  ❌ API call failed, skipping batch")
            continue

        from_cache = resp.get("fromCache", False)
        batch_results = resp.get("results", [])
        print(f"  Got {len(batch_results)} results (fromCache={from_cache})")

        for r in batch_results:
            kw = r.get("keyword", "")
            ratio = r.get("ratioMean", 0) or r.get("ratio", 0)
            slope = r.get("slopeRatio", 0) or 0
            verdict = r.get("verdict", "unknown")
            source = next((g["source"] for g in batch if g["name"].lower() == kw.lower()), "unknown")

            results.append({
                "keyword": kw,
                "source": source,
                "ratio": ratio,
                "slope": slope,
                "verdict": verdict,
            })

            # Determine if worth doing
            is_worth = ratio > MIN_RATIO and slope > MIN_SLOPE
            status = "worth_doing" if is_worth else "done"

            print(f"  {'✅' if is_worth else '⬜'} {kw}: ratio={ratio:.3f}, slope={slope:.3f}, verdict={verdict}")

            if not args.dry_run:
                save_result(kw, source, ratio, slope, status)

        # Rate limit between batches
        if i + BATCH_SIZE < len(to_check):
            time.sleep(1)

    # Step 4: Summary
    worth_doing = [r for r in results if r["ratio"] > MIN_RATIO and r["slope"] > MIN_SLOPE]
    not_worth = [r for r in results if not (r["ratio"] > MIN_RATIO and r["slope"] > MIN_SLOPE)]

    print(f"\n{'='*60}")
    print(f"📊 SUMMARY")
    print(f"   Total checked: {len(results)}")
    print(f"   Worth doing: {len(worth_doing)}")
    print(f"   Not worth: {len(not_worth)}")
    print(f"{'='*60}")

    if worth_doing:
        print(f"\n🎮 WORTH DOING (游戏词推荐):")
        for r in sorted(worth_doing, key=lambda x: x["ratio"], reverse=True):
            print(f"  {r['keyword']} | ratio={r['ratio']:.3f} | slope={r['slope']:.3f} | {r['verdict']}")

    if args.dry_run:
        print(f"\n⚠️ Dry run — nothing saved to D1")


if __name__ == "__main__":
    main()
