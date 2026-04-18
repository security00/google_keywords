#!/usr/bin/env python3
"""
Game Trend Scanner — 从所有 sitemap 源发现新游戏，对比 GPTS 趋势，存入 D1。

两种发现模式并行：
1. CrazyGames /new 页面 — 通过 __NEXT_DATA__ JSON 获取最新上架游戏（~70个/页）
2. D1 sitemap_sources 表 — 从所有 enabled 源的 sitemap 提取游戏名，与 discovered_keywords 对比找新增

流程：
1. 从所有源收集新游戏名
2. 过滤：排除已在 game_keyword_pipeline 中处理过的
3. 分批调 /api/research/trends 对比 GPTS
4. 筛选 ratio > 0.3 且在涨的 → 标记为 worth_doing
5. 结果存入 game_keyword_pipeline

用法：
  python3 scripts/game_trend_scanner.py [--dry-run] [--max-keywords 50] [--max-sources 5] [--api-url URL]
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
import urllib.parse
from urllib.parse import urlparse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

# ─── Config ───────────────────────────────────────────────────────────
D1_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "")
D1_API_TOKEN = os.environ.get("CF_API_TOKEN", "")
D1_DATABASE_ID = os.environ.get("D1_DATABASE_ID", "b40de8a4-75e1-4df6-a84d-3ecd62b70538")
API_URL = os.environ.get("GK_API_URL", "https://discoverkeywords.co")
API_KEY = os.environ.get("GK_API_KEY", "")

# CrazyGames /new — 特殊源，有发布日期排序
CRAZYGAMES_NEW = "https://www.crazygames.com/new"

TREND_BENCHMARK = "gpts"
TREND_MONTHS = 3
MIN_RATIO = 0.3
MIN_SLOPE = 0.0
BATCH_SIZE = 5  # trends API: small batches to avoid Worker CPU timeout

GENERIC_KEYWORDS = {
    "beauty", "art", "io", "fun", "run", "car", "bus", "pop", "box", "tap",
    "fit", "pet", "hud", "map", "top", "red", "bot", "fly", "mix", "cut",
    "hit", "get", "set", "win", "vip", "pro", "max", "new", "org", "net",
    "play", "game", "games", "online", "free", "best", "cool", "hot", "all",
    "the", "and", "for", "you", "aboutus", "news", "payments", "platform",
    "privacy", "terms", "contact", "blog", "home", "search", "category",
}


# ─── D1 Helpers ───────────────────────────────────────────────────────

def d1_query(sql, params=None):
    """Execute D1 HTTP API query, return list of result dicts."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{D1_ACCOUNT_ID}/d1/database/{D1_DATABASE_ID}/query"
    payload = {"sql": sql, "params": params or []}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {D1_API_TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
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
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("success", False)
    except Exception as e:
        print(f"  ⚠️ D1 execute failed: {e}", file=sys.stderr)
        return False


# ─── Sitemap Discovery (reuse discovery_scan.py logic) ───────────────

def fetch_sitemap_urls(sitemap_url, depth=0):
    """Fetch sitemap and return list of URLs."""
    if depth > 2:
        return []
    try:
        req = urllib.request.Request(sitemap_url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; GameTrendScanner/1.0)"
        })
        resp = urllib.request.urlopen(req, timeout=30)
        text = resp.read().decode("utf-8", errors="replace")
        root = ET.fromstring(text)
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

        urls = []
        sitemap_locs = root.findall(".//sm:sitemap/sm:loc", ns)
        if sitemap_locs:
            # Sitemap index — recurse into first N sub-sitemaps
            for loc in sitemap_locs[:5]:
                sub_urls = fetch_sitemap_urls(loc.text, depth + 1)
                urls.extend(sub_urls)
                time.sleep(0.5)
        else:
            # URL sitemap — collect all URLs
            for loc in root.findall(".//sm:url/sm:loc", ns):
                if loc.text:
                    urls.append(loc.text)
        return urls
    except Exception as e:
        print(f"    Sitemap error ({sitemap_url}): {e}", file=sys.stderr)
        return []


def extract_keyword_from_url(url, rules=None):
    """Extract game name from URL path."""
    path = urlparse(url).path.strip("/")
    if not path:
        return None

    if rules and rules.get("urlPattern"):
        match = re.search(rules["urlPattern"], path)
        if match and match.lastindex:
            keyword = match.group(1)
        else:
            return None
    else:
        segments = [s for s in path.split("/") if s]
        if not segments:
            return None
        keyword = segments[-1]

    keyword = keyword.replace("-", " ").replace("_", " ").replace(".html", "").replace(".htm", "").strip()

    if not keyword or keyword.isdigit() or len(keyword) < 4 or len(keyword) > 60:
        return None
    if keyword.lower() in GENERIC_KEYWORDS:
        return None
    return keyword


def discover_new_from_sitemaps(max_sources=5):
    """Fetch sitemap sources from D1, extract game names, compare with discovered_keywords."""
    print("\n🗺️ Phase 1: Sitemap Discovery", flush=True)

    # Load enabled sources, prioritized by oldest last_checked_at
    sources = d1_query(
        "SELECT * FROM sitemap_sources WHERE enabled = 1 ORDER BY last_checked_at ASC LIMIT ?",
        [max_sources]
    )
    if not sources:
        print("  No sitemap sources found", flush=True)
        return []

    print(f"  Checking {len(sources)} sources...", flush=True)

    all_new_keywords = []  # [{"name": ..., "source": ..., "url": ...}]

    for source in sources:
        name = source.get("name", "unknown")
        sitemap_url = source.get("sitemap_url", "")
        source_id = source.get("id", "")
        rules = None
        if source.get("rules_json"):
            try:
                rules = json.loads(source["rules_json"])
            except Exception:
                pass

        print(f"\n  📡 {name}...", end="", flush=True)
        urls = fetch_sitemap_urls(sitemap_url)
        if not urls:
            print(f" ❌ no URLs", flush=True)
            continue

        # Extract keywords
        keywords = {}
        for u in urls:
            kw = extract_keyword_from_url(u, rules)
            if kw:
                norm = kw.lower()
                if norm not in keywords:
                    keywords[norm] = kw

        if not keywords:
            print(f" ⬜ 0 keywords extracted from {len(urls)} URLs", flush=True)
            continue

        # Check which are NOT in discovered_keywords (i.e. genuinely new)
        norms = list(keywords.keys())
        existing = set()
        CHUNK = 50
        for i in range(0, len(norms), CHUNK):
            chunk = norms[i:i + CHUNK]
            placeholders = ",".join(["?"] * len(chunk))
            rows = d1_query(
                f"SELECT keyword_normalized FROM discovered_keywords WHERE keyword_normalized IN ({placeholders})",
                chunk
            )
            if rows:
                existing.update(r["keyword_normalized"] for r in rows)

        new_kws = [{"name": keywords[n], "source": name, "url": u} for n in norms if n not in existing]

        # Also check against game_keyword_pipeline to avoid re-checking
        if new_kws:
            pipeline_names = {r["keyword"].lower() for r in d1_query(
                "SELECT keyword FROM game_keyword_pipeline"
            )}
            new_kws = [k for k in new_kws if k["name"].lower() not in pipeline_names]

        # Insert new keywords into discovered_keywords so next run won't re-discover them
        if new_kws and not args.dry_run:
            BATCH = 10
            for i in range(0, len(new_kws), BATCH):
                batch = new_kws[i:i + BATCH]
                values_sql = ",".join(["(?,?,?,?,?,?,?)"] * len(batch))
                params = []
                for kw in batch:
                    kw_id = hashlib.md5(f"{source_id}:{kw['name'].lower()}".encode()).hexdigest()[:8]
                    params.extend([kw_id, "", source_id, kw["name"], kw["name"].lower(), kw.get("url", ""), "new"])
                d1_execute(
                    f"INSERT OR IGNORE INTO discovered_keywords (id, user_id, source_id, keyword, keyword_normalized, url, status) VALUES {values_sql}",
                    params
                )

            # Update source last_checked_at
            now = datetime.now(timezone.utc).isoformat()
            d1_execute(
                "UPDATE sitemap_sources SET last_checked_at = ?, updated_at = ? WHERE id = ?",
                [now, now, source_id]
            )

        print(f" ✅ {len(new_kws)} new / {len(keywords)} total from {len(urls)} URLs", flush=True)
        all_new_keywords.extend(new_kws)
        time.sleep(1)

    return all_new_keywords


# ─── CrazyGames /new Page (special source) ───────────────────────────

def fetch_crazygames_new():
    """Fetch latest games from CrazyGames /new page."""
    print("\n🎮 Phase 2: CrazyGames /new", flush=True)
    import subprocess

    cmd = [
        "curl", "-sL", "--max-time", "15", CRAZYGAMES_NEW,
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        raw = result.stdout
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', raw, re.DOTALL)
        if not m:
            print("  ❌ No __NEXT_DATA__ found", flush=True)
            return []

        data = json.loads(m.group(1))
        items = data["props"]["pageProps"]["games"]["items"]
        games = []
        for item in items:
            name = item.get("name", "").strip()
            if name and is_game_name_valid(name):
                games.append({"name": name, "source": "crazygames"})
        print(f"  Found {len(games)} games", flush=True)
        return games
    except Exception as e:
        print(f"  ❌ Failed: {e}", flush=True)
        return []


# ─── Trends API ───────────────────────────────────────────────────────

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
            print(f"    ⚠️ curl exit {result.returncode}: {result.stderr[:200]}", file=sys.stderr)
            return None
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        print(f"    ⚠️ JSON parse failed: {e}", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print(f"    ⚠️ curl timed out", file=sys.stderr)
        return None
    except Exception as e:
        print(f"    ⚠️ Trends API failed: {e}", file=sys.stderr)
        return None


def save_result(keyword, source_site, ratio, slope, verdict, status="done"):
    """Save trend result to D1."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    return d1_execute(
        """INSERT OR REPLACE INTO game_keyword_pipeline 
           (keyword, source_site, trend_ratio, trend_slope, trend_verdict, trend_checked_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        [keyword, source_site, ratio, slope, verdict, now, status]
    )


def call_serp_api(keywords):
    """Call /api/research/serp with keywords, return results."""
    import subprocess
    url = f"{API_URL}/api/research/serp"
    payload = json.dumps({"keywords": keywords})
    cmd = [
        "curl", "-sL", "--max-time", "120", url,
        "-H", "Content-Type: application/json",
        "-H", f"Authorization: Bearer {API_KEY}",
        "-d", payload,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=130)
        if result.returncode != 0:
            print(f"    ⚠️ SERP curl exit {result.returncode}: {result.stderr[:200]}", file=sys.stderr)
            return None
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        print(f"    ⚠️ SERP JSON parse failed: {e}", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print(f"    ⚠️ SERP curl timed out", file=sys.stderr)
        return None
    except Exception as e:
        print(f"    ⚠️ SERP API failed: {e}", file=sys.stderr)
        return None


def check_serp_competition(serp_data):
    """Analyze SERP result and return competition level.
    
    Returns: (is_low_competition, organic_count, auth_domain_count, has_featured_snippet)
    
    Low competition = can rank for this keyword:
    - No authority domains in top 3 (chess.com, wikipedia, etc.)
    - organic count < 8 (not saturated)
    """
    organic_count = serp_data.get("organicCount", 0)
    auth_domains = serp_data.get("authDomains", 0)
    has_featured = serp_data.get("hasFeaturedSnippet", False)
    niche_domains = serp_data.get("nicheDomains", 0)
    has_ai_overview = serp_data.get("hasAiOverview", False)
    
    # Authority domains in top results = hard to compete
    # We consider it low competition if auth_domains == 0
    # OR auth_domains <= 1 AND niche_domains >= 1 (small players exist)
    is_low = auth_domains == 0 or (auth_domains <= 1 and niche_domains >= 2)
    
    return is_low, organic_count, auth_domains, has_featured


# ─── Validation ───────────────────────────────────────────────────────

SEO_JUNK_PATTERNS = re.compile(
    r"(?:"
    r"for\s+(?:your|my|google)\s+(?:website|site)"
    r"|embed(?:dable)?\s+(?:online\s+)?games?"
    r"|unblocked\s+games?"
    r"|free\s+(?:download|online)"
    r"|\bplay\s+(?:free|online|now)\b"
    r"|\ball\s+games\b"
    r"|games?\s+to\s+(?:embed|play|download)"
    r"|primary\s+games"
    r"|\b\d+\s*(?:player|players)\b"
    r")"
)

def is_game_name_valid(name):
    """Filter out obviously bad game names and SEO junk."""
    name_lower = name.lower().strip()
    if len(name_lower) < 3 or len(name_lower) > 60:
        return False
    if re.match(r"^[0-9\s]+$", name_lower):
        return False
    if name_lower in GENERIC_KEYWORDS:
        return False
    # Multi-word generic combos (category pages, not game names)
    if all(w in GENERIC_KEYWORDS for w in name_lower.split()):
        return False
    # SEO junk patterns (embed, website, unblocked, etc.)
    if SEO_JUNK_PATTERNS.search(name_lower):
        return False
    # Too many words = likely a category page, not a game
    if len(name_lower.split()) > 5:
        return False
    return True


# ─── Main ─────────────────────────────────────────────────────────────

def main():
    global args
    parser = argparse.ArgumentParser(description="Game Trend Scanner")
    parser.add_argument("--dry-run", action="store_true", help="Don't save to D1")
    parser.add_argument("--max-keywords", type=int, default=50, help="Max keywords to check trends")
    parser.add_argument("--max-sources", type=int, default=5, help="Max sitemap sources to scan")
    parser.add_argument("--api-url", default=None, help="Override API URL")
    args = parser.parse_args()

    global API_URL
    if args.api_url:
        API_URL = args.api_url

    if not D1_ACCOUNT_ID or not D1_API_TOKEN:
        print("❌ Missing CF_ACCOUNT_ID or CF_API_TOKEN env vars", file=sys.stderr)
        sys.exit(1)
    if not API_KEY:
        print("❌ Missing GK_API_KEY env var", file=sys.stderr)
        sys.exit(1)

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"🎮 Game Trend Scanner — {ts}")
    print(f"   Max keywords: {args.max_keywords}, Max sources: {args.max_sources}, Dry run: {args.dry_run}")

    # ── Phase 1: Sitemap discovery (find new games from all sources) ──
    sitemap_new = discover_new_from_sitemaps(args.max_sources)

    # ── Phase 2: CrazyGames /new (latest games by publish date) ──
    crazygames_new = fetch_crazygames_new()

    # ── Combine and deduplicate ──
    seen = set()
    all_games = []
    for g in sitemap_new + crazygames_new:
        key = g["name"].lower()
        if key not in seen and is_game_name_valid(g["name"]):
            seen.add(key)
            all_games.append(g)

    print(f"\n📋 Combined: {len(all_games)} unique new games", flush=True)

    # ── Filter out already trend-checked ──
    pipeline_names = {r["keyword"].lower() for r in d1_query(
        "SELECT keyword FROM game_keyword_pipeline WHERE status IN ('done', 'checking', 'worth_doing')"
    )}
    to_check = [g for g in all_games if g["name"].lower() not in pipeline_names]

    print(f"🆕 Not yet trend-checked: {len(to_check)}", flush=True)

    if not to_check:
        print("✅ All caught up, nothing new to check.", flush=True)
        return

    to_check = to_check[:args.max_keywords]
    print(f"🔍 Will check: {len(to_check)} keywords", flush=True)

    # ── Phase 3: Batch trends check ──
    results = []
    worth_count = 0

    for i in range(0, len(to_check), BATCH_SIZE):
        batch = to_check[i:i + BATCH_SIZE]
        keywords = [g["name"] for g in batch]
        batch_num = i // BATCH_SIZE + 1
        total_batches = (len(to_check) + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"\n📈 Batch {batch_num}/{total_batches}: {keywords}", flush=True)

        resp = call_trends_api(keywords)
        if not resp:
            print("  ❌ API call failed, skipping batch", flush=True)
            continue

        from_cache = resp.get("fromCache", False)
        batch_results = resp.get("results", [])
        print(f"  Got {len(batch_results)} results (cache={from_cache})", flush=True)

        for r in batch_results:
            kw = r.get("keyword", "")
            ratio = r.get("ratioMean", 0) or r.get("ratio", 0)
            slope = r.get("slopeRatio", 0) or 0
            verdict = r.get("verdict", "unknown")
            source = next((g["source"] for g in batch if g["name"].lower() == kw.lower()), "unknown")

            results.append({
                "keyword": kw, "source": source,
                "ratio": ratio, "slope": slope, "verdict": verdict,
            })

            is_worth = ratio > MIN_RATIO and slope > MIN_SLOPE
            status = "worth_doing" if is_worth else "done"
            if is_worth:
                worth_count += 1

            print(f"  {'✅' if is_worth else '⬜'} {kw}: ratio={ratio:.3f}, slope={slope:.3f}, verdict={verdict}", flush=True)

            if not args.dry_run:
                save_result(kw, source, ratio, slope, status)

        if i + BATCH_SIZE < len(to_check):
            time.sleep(1)

    # ── Phase 4: SERP competition check for worth_doing keywords ──
    worth_doing = [r for r in results if r["ratio"] > MIN_RATIO and r["slope"] > MIN_SLOPE]

    if worth_doing:
        print(f"\n🔎 Phase 4: SERP competition check for {len(worth_doing)} trending keywords", flush=True)
        serp_kws = [r["keyword"] for r in worth_doing]
        
        # Batch SERP check (max 10 per batch to avoid timeout)
        SERP_BATCH = 10
        for i in range(0, len(serp_kws), SERP_BATCH):
            batch = serp_kws[i:i + SERP_BATCH]
            print(f"  SERP batch: {batch}", flush=True)
            
            serp_resp = call_serp_api(batch)
            if not serp_resp:
                print("  ❌ SERP API failed", flush=True)
                continue
            
            serp_results = serp_resp.get("results", {})
            for r in worth_doing:
                kw = r["keyword"].lower()
                kw_data = serp_results.get(kw) or serp_results.get(r["keyword"])
                if not kw_data:
                    r["serp_status"] = "no_data"
                    continue
                
                is_low, organic, auth, featured = check_serp_competition(kw_data)
                r["serp_low_competition"] = is_low
                r["serp_organic"] = organic
                r["serp_auth"] = auth
                r["serp_featured"] = featured
                r["serp_status"] = "low" if is_low else "high"
                
                status_str = "🟢" if is_low else "🔴"
                print(f"  {status_str} {r['keyword']}: organic={organic}, auth={auth}, featured={featured} → {'LOW comp' if is_low else 'HIGH comp'}", flush=True)
                
                # Update D1 status: only keep worth_doing if low competition
                if not args.dry_run:
                    new_status = "worth_doing" if is_low else "done"
                    save_result(r["keyword"], r["source"], r["ratio"], r["slope"], r["verdict"], new_status)
            
            time.sleep(1)
        
        # Filter to only truly worth doing (low competition)
        worth_doing = [r for r in worth_doing if r.get("serp_status") == "low"]

    print(f"\n{'='*60}")
    print(f"📊 SUMMARY — {ts}")
    print(f"   Sitemap sources scanned: {args.max_sources}")
    print(f"   Total new games found: {len(all_games)}")
    print(f"   Trend-checked: {len(results)}")
    print(f"   Worth doing: {len(worth_doing)}")
    print(f"{'='*60}")

    if worth_doing:
        print(f"\n🎮 WORTH DOING (low competition, trending game keywords):")
        for r in sorted(worth_doing, key=lambda x: x["ratio"], reverse=True):
            print(f"  {r['keyword']} | ratio={r['ratio']:.3f} | slope={r['slope']:.3f} | organic={r.get('serp_organic', '?')} | auth={r.get('serp_auth', '?')} | {r['verdict']} | src={r['source']}")

    if args.dry_run:
        print(f"\n⚠️ Dry run — nothing saved to D1")

    # Output worth_doing as JSON for cron to parse
    if worth_doing:
        print(f"\n__WORTH_DOING_JSON__")
        print(json.dumps(worth_doing, ensure_ascii=False))


if __name__ == "__main__":
    main()
