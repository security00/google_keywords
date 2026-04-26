#!/usr/bin/env python3
"""
Game Trend Scanner — 从所有 sitemap 源发现新游戏，对比 GPTS 趋势，存入 D1。

三种发现模式并行：
1. CrazyGames /new 页面 — 通过 __NEXT_DATA__ JSON 获取最新上架游戏（~70个/页）
2. Poki /new 页面 — 获取最新上架游戏
3. Addicting Games /new-games — 获取最新上架游戏
4. itch.io /games/newest — 独立游戏新品
5. itch.io /games/free — 免费独立游戏

流程：
1. 从 CrazyGames /new + Steam new_releases 收集新游戏名
2. 过滤：排除已在 game_keyword_pipeline 中处理过的
3. 分批调 /api/research/trends 对比 GPTS (14天窗口)
4. 对 ratio >= 0.3 的词做 90 天历史基线检查（排除老游戏）
5. SERP 竞争检查
6. 最终分类：🔥 Hot / 📈 Rising / 🎯 Niche / ⏭️ Skip

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
import subprocess
import urllib.request
import urllib.parse
from urllib.parse import urlparse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

try:
    from scripts.pipeline_runtime import pipeline_run, record_cost_event, update_pipeline_run
except ModuleNotFoundError:
    from pipeline_runtime import pipeline_run, record_cost_event, update_pipeline_run

# ─── Config ───────────────────────────────────────────────────────────
D1_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "")
D1_API_TOKEN = os.environ.get("CF_API_TOKEN", "")
D1_DATABASE_ID = os.environ.get("D1_DATABASE_ID", "b40de8a4-75e1-4df6-a84d-3ecd62b70538")
API_URL = os.environ.get("GK_API_URL", "https://discoverkeywords.co")
API_KEY = os.environ.get("GK_API_KEY", "")

# CrazyGames /new — 特殊源，有发布日期排序
CRAZYGAMES_NEW = "https://www.crazygames.com/new"

# ── Load shared business rules from config ──
_RULES_PATH = os.path.join(os.path.dirname(__file__), '..', 'config', 'business-rules.json')
try:
    with open(_RULES_PATH) as _f:
        _RULES = json.load(_f)
except (FileNotFoundError, json.JSONDecodeError):
    _RULES = {}

# Game pipeline rules (from config, with fallbacks)
GAME = _RULES.get('game', {})
GAME_HOT_RATIO = GAME.get('GAME_HOT_RATIO', 2.0)
GAME_RISING_RATIO = GAME.get('GAME_RISING_RATIO', 0.5)
GAME_NICHE_RATIO = GAME.get('GAME_NICHE_RATIO', 0.5)
GAME_HIST_ESTABLISHED_BENCH_RATIO = GAME.get('GAME_HIST_ESTABLISHED_BENCH_RATIO', 5.0)
GAME_HIST_ESTABLISHED_ABSOLUTE = GAME.get('GAME_HIST_ESTABLISHED_ABSOLUTE', 30)
GAME_RESURGE_SURGE = GAME.get('GAME_RESURGE_SURGE', 2.0)
GAME_14D_ESTABLISHED_AVG = GAME.get('GAME_14D_ESTABLISHED_AVG', 50)
GAME_14D_DECLINING_AVG = GAME.get('GAME_14D_DECLINING_AVG', 40)
GAME_14D_STABLE_RATIO = GAME.get('GAME_14D_STABLE_RATIO', 5.0)
GAME_14D_LOW_CV = GAME.get('GAME_14D_LOW_CV', 0.15)
GAME_HIST_DECLINING_SURGE = GAME.get('GAME_HIST_DECLINING_SURGE', 0.8)
GAME_MIN_RATIO = GAME.get('GAME_MIN_RATIO', 1.0)

TREND_BENCHMARK = "gpts"
TREND_MONTHS = 0  # Use TREND_DAYS instead
TREND_DAYS = 14  # 14-day window for NEW game discovery
HISTORY_DAYS = 90  # Historical baseline check window
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

# Explicitly block highly ambiguous/common titles that keep producing false positives in Trends.
TOO_GENERIC_GAME_NAMES = {
    "ant", "memories", "number", "delivery", "where", "pin", "rush hour",
    "time traveler", "the lighthouse", "cold city", "passenger 6",
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


# ─── Poki /new Page ─────────────────────────────────────────────

def fetch_poki_new():
    """Fetch new games from Poki /new page."""
    print("\n🎮 Phase 1b: Poki /new", flush=True)
    try:
        req = urllib.request.Request(
            "https://poki.com/en/new",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        # Extract game titles from the new games section (skip popular section)
        # The new games are in <ul class="Wz4fsOmhQR4bEYpqHqhc"> after the popular section
        # We use JSON-LD which has the first 20 new games
        import re as _re
        ld_match = _re.search(r'"mainEntity".*?"itemListElement":\[(.*?)\]', html)
        if not ld_match:
            # Fallback: extract from summaryTile__title after the first <ul>
            titles = _re.findall(r'class="summaryTile__title[^"]*">([^<]+)</span>', html)
            # Skip first ~12 which are "Popular this week"
            titles = titles[12:] if len(titles) > 12 else titles
            games = [{"name": t.strip(), "source": "poki"} for t in titles if is_game_name_valid(t.strip())]
        else:
            import json as _json
            items_str = "[" + ld_match.group(1) + "]"
            items = _json.loads(items_str)
            games = [{"name": item["name"], "source": "poki"} for item in items if is_game_name_valid(item["name"])]

        # Deduplicate
        seen = set()
        unique = []
        for g in games:
            key = g["name"].lower()
            if key not in seen:
                seen.add(key)
                unique.append(g)

        print(f"  Found {len(unique)} new Poki games", flush=True)
        return unique
    except Exception as e:
        print(f"  ❌ Poki fetch failed: {e}", flush=True)
        return []


# ─── Addicting Games /new-games ──────────────────────────────────────

def fetch_addicting_games_new():
    """Fetch new games from Addicting Games /new-games page."""
    print("\n🎮 Phase 1c: Addicting Games /new-games", flush=True)
    try:
        req = urllib.request.Request(
            "https://www.addictinggames.com/new-games",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        import re as _re
        match = _re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html)
        if not match:
            print("  ❌ No __NEXT_DATA__ found on Addicting Games", flush=True)
            return []

        data = json.loads(match.group(1))
        raw_games = data["props"]["pageProps"]["games"]

        games = []
        for g in raw_games:
            title = g.get("title", "").strip()
            published = g.get("published", "")
            # Only include games from the last 14 days
            if published:
                try:
                    from datetime import datetime, timezone
                    pub_date = datetime.fromisoformat(published.replace("+00:00", "+00:00"))
                    days_ago = (datetime.now(timezone.utc) - pub_date).days
                    if days_ago > 14:
                        continue
                except:
                    pass
            if is_game_name_valid(title):
                games.append({"name": title, "source": "addictinggames"})

        print(f"  Found {len(games)} new Addicting Games (last 14 days)", flush=True)
        return games
    except Exception as e:
        print(f"  ❌ Addicting Games fetch failed: {e}", flush=True)
        return []


# ─── itch.io New Games ────────────────────────────────────────────

def fetch_itchio_new():
    """Fetch new games from itch.io /games/newest."""
    print("\n🎮 Phase 1d: itch.io /games/newest", flush=True)
    try:
        req = urllib.request.Request(
            "https://itch.io/games/newest",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        links = re.findall(r'href="(https://[a-z0-9-]+\.itch\.io/[a-z0-9-]+)"', html)
        seen = set()
        games = []
        for link in dict.fromkeys(links):  # preserve order, deduplicate
            slug = link.split(".itch.io/")[1] if ".itch.io/" in link else ""
            name = slug.replace("-", " ").strip().title()
            key = name.lower()
            if name and key not in seen and is_game_name_valid(name):
                seen.add(key)
                games.append({"name": name, "source": "itchio"})

        print(f"  Found {len(games)} new itch.io games", flush=True)
        return games
    except Exception as e:
        print(f"  ❌ itch.io fetch failed: {e}", flush=True)
        return []


def fetch_itchio_free():
    """Fetch free games from itch.io /games/free."""
    print("\n🎮 Phase 1e: itch.io /games/free", flush=True)
    try:
        req = urllib.request.Request(
            "https://itch.io/games/free",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        links = re.findall(r'href="(https://[a-z0-9-]+\.itch\.io/[a-z0-9-]+)"', html)
        seen = set()
        games = []
        for link in dict.fromkeys(links):
            slug = link.split(".itch.io/")[1] if ".itch.io/" in link else ""
            name = slug.replace("-", " ").strip().title()
            key = name.lower()
            if name and key not in seen and is_game_name_valid(name):
                seen.add(key)
                games.append({"name": name, "source": "itchio-free"})

        print(f"  Found {len(games)} free itch.io games", flush=True)
        return games
    except Exception as e:
        print(f"  ❌ itch.io free fetch failed: {e}", flush=True)
        return []


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

def call_trends_api(keywords, max_wait=180, *, endpoint_label="trends_14d"):
    """Call /api/research/trends with keywords (async with polling).
    
    1. POST /api/research/trends → get jobId (or cached results)
    2. Poll /api/research/trends/status?jobId=X until complete
    """
    import subprocess
    url = f"{API_URL}/api/research/trends"
    payload = json.dumps({
        "keywords": keywords,
        "days": TREND_DAYS,
        "benchmark": TREND_BENCHMARK,
    })
    
    # Step 1: Submit
    cmd = [
        "curl", "-sL", "--max-time", "15", url,
        "-H", "Content-Type: application/json",
        "-H", f"Authorization: Bearer {API_KEY}",
        "-d", payload,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if result.returncode != 0:
            print(f"    ⚠️ trends submit failed: curl exit {result.returncode}", file=sys.stderr)
            return None
        resp = json.loads(result.stdout)
        actual_cost = None
        if isinstance(resp.get("cost"), dict):
            actual_cost = resp["cost"].get("actualCostUsd")
        task_count = int(resp.get("total") or len(resp.get("taskIds") or []) or ((len(keywords) + 3) // 4))
        
        # Cache hit — return immediately
        if resp.get("results") is not None:
            print(f"    📦 trends cache hit", flush=True)
            return resp
        
        # Async — need to poll
        job_id = resp.get("jobId")
        if not job_id:
            print(f"    ⚠️ no jobId in response: {result.stdout[:200]}", file=sys.stderr)
            return None
        
        print(f"    ⏳ trends async jobId={job_id[:8]}...", flush=True)
        
    except Exception as e:
        print(f"    ⚠️ trends submit failed: {e}", file=sys.stderr)
        return None
    
    # Step 2: Poll for results
    poll_interval = 10  # start at 10s
    max_intervals = max_wait // poll_interval
    for attempt in range(max_intervals):
        time.sleep(poll_interval)
        
        status_url = f"{API_URL}/api/research/trends/status?jobId={job_id}"
        poll_cmd = [
            "curl", "-sL", "--max-time", "15", status_url,
            "-H", f"Authorization: Bearer {API_KEY}",
        ]
        try:
            poll_result = subprocess.run(poll_cmd, capture_output=True, text=True, timeout=20)
            if poll_result.returncode != 0:
                continue
            poll_resp = json.loads(poll_result.stdout)
            
            if poll_resp.get("status") == "complete":
                record_cost_event(
                    provider="dataforseo",
                    endpoint=endpoint_label,
                    unit_type="task",
                    unit_count=task_count,
                    unit_price_usd=0.00225,
                    actual_cost_usd=actual_cost,
                    metadata={"keywords": keywords, "days": TREND_DAYS if endpoint_label == "trends_14d" else HISTORY_DAYS, "cost": resp.get("cost")},
                )
                return poll_resp
            elif poll_resp.get("status") == "processing":
                progress = poll_resp.get("progress", "")
                if attempt % 3 == 0:  # print every ~30s
                    print(f"    ⏳ trends polling... {progress}", flush=True)
                continue
            elif poll_resp.get("status") == "failed":
                print(f"    ❌ trends job failed: {poll_resp.get('error', 'unknown')}", file=sys.stderr)
                return None
            else:
                # Might be cached result returned directly
                if poll_resp.get("results") is not None:
                    return poll_resp
                continue
        except Exception:
            continue
    
    print(f"    ⚠️ trends polling timed out after {max_wait}s", file=sys.stderr)
    return None


def save_result(keyword, source_site, ratio, slope, verdict, status="done",
               serp_organic=0, serp_auth=0, serp_featured=0,
               recommendation=None, reason=None, trend_series=None):
    """Save trend result to D1 with SERP and recommendation data."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    series_json = json.dumps(trend_series) if trend_series else None
    return d1_execute(
        """INSERT OR REPLACE INTO game_keyword_pipeline 
           (keyword, source_site, trend_ratio, trend_slope, trend_verdict,
            trend_checked_at, status, serp_organic, serp_auth, serp_featured,
            recommendation, reason, trend_series)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [keyword, source_site, ratio, slope, verdict, now, status,
         serp_organic, serp_auth, serp_featured, recommendation, reason, series_json]
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
        response = json.loads(result.stdout)
        if not response.get("fromCache"):
            cost = response.get("cost") if isinstance(response.get("cost"), dict) else {}
            record_cost_event(
                provider="dataforseo",
                endpoint="serp_organic",
                unit_type="task",
                unit_count=int(response.get("total") or len(keywords)),
                unit_price_usd=0.0006,
                actual_cost_usd=cost.get("actualCostUsd"),
                metadata={"keywords": keywords, "cost": response.get("cost")},
            )
        return response
    except json.JSONDecodeError as e:
        print(f"    ⚠️ SERP JSON parse failed: {e}", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print(f"    ⚠️ SERP curl timed out", file=sys.stderr)
        return None
    except Exception as e:
        print(f"    ⚠️ SERP API failed: {e}", file=sys.stderr)
        return None


def classify_keyword(ratio, slope, verdict, serp_organic=0, serp_auth=0, serp_featured=False,
                        hist_vs_bench=None, surge=None, hist_avg=None, series_14d=None):
    """Classify a game keyword into a recommendation category.
    
    Uses 14-day trend data + 90-day historical baseline check.
    
    Parameters:
      ratio: 14-day ratio (keyword volume / benchmark)
      slope: 14-day trend slope
      hist_vs_bench: 75-day average value / 75-day benchmark average (from 90-day query)
      surge: recent 15-day avg / historical 75-day avg (from 90-day query)
      hist_avg: 75-day average normalized value (0-100)
    
    Returns: (recommendation, reason)
    """
    
    # Build human-readable reason
    if ratio >= 2.0:
        traffic_desc = f"搜索热度是GPTs的{ratio:.1f}倍，属于高流量词"
    elif ratio >= 0.5:
        traffic_desc = f"搜索热度达到GPTs的{ratio:.0%}，有相当流量"
    elif ratio >= 0.3:
        traffic_desc = f"搜索热度是GPTs的{ratio:.0%}，流量中等"
    else:
        traffic_desc = f"搜索热度仅为GPTs的{ratio:.0%}，流量偏低"
    
    if slope > 5:
        trend_desc = "近14天搜索量急速上升"
    elif slope > 2:
        trend_desc = "近14天搜索量持续上升"
    elif slope > 0:
        trend_desc = "近14天搜索量小幅上升"
    elif slope > -2:
        trend_desc = "近14天搜索量平稳"
    else:
        trend_desc = "近14天搜索量在下降"
    
    if serp_auth == 0:
        serp_desc = f"谷歌前10页没有权威站(如Wikipedia/IGN)，竞争低"
    elif serp_auth <= 1:
        serp_desc = f"谷歌前10页有{serp_auth}个权威站，竞争中等"
    else:
        serp_desc = f"谷歌前10页有{serp_auth}个权威站，竞争较大"
    
    reason = f"{traffic_desc}；{trend_desc}；{serp_desc}"
    
    # ── Historical baseline check (90-day data) ──
    # If we have 90-day data, check if the game was already established
    is_established = False
    if hist_vs_bench is not None and surge is not None:
        
        # Criterion 1: historical value vs benchmark was already high
        # hist_vs_bench >= 5.0 means keyword was already 5x+ benchmark for 75 days
        if hist_vs_bench >= GAME_HIST_ESTABLISHED_BENCH_RATIO:
            is_established = True
            reason += f"；⚠️ 前75天搜索量已是benchmark的{hist_vs_bench:.1f}倍，非近期起势"
        # Criterion 2: absolute historical level was high (normalized >= 30)
        elif hist_avg is not None and hist_avg >= GAME_HIST_ESTABLISHED_ABSOLUTE:
            is_established = True
            reason += f"；⚠️ 前75天搜索量均值{hist_avg:.0f}/100，已建立稳定搜索量"
        # Criterion 3: not surging (recent not significantly higher than history)
        elif hist_vs_bench >= 2.0 and surge < 1.2:
            is_established = True
            reason += f"；⚠️ 前期vs_bench={hist_vs_bench:.1f}x且近期未明显起势(surge={surge:.1f}x)"
        # Criterion 4: declining or flat — even moderate keywords declining are not new opportunities
        elif surge < GAME_HIST_DECLINING_SURGE:
            is_established = True
            reason += f"；⚠️ 近15天搜索量低于前75天(surge={surge:.1f}x)，非起势词"
    
    # ── Fallback: 14-day series pattern check (when no 90-day data available) ──
    # If 14-day values are consistently high and flat, it's likely an old game
    if not is_established and series_14d:
        vals = series_14d.get("values", [])
        bench = series_14d.get("benchmarkValues", [])
        if len(vals) >= 10:
            avg_val = sum(vals) / len(vals)
            avg_bench = sum(bench) / len(bench) if bench else 0.01
            # Std dev of values — if very low, the keyword is stable (old)
            mean_val = avg_val
            if avg_val > 0:
                std_val = (sum((x - mean_val) ** 2 for x in vals) / len(vals)) ** 0.5
                cv = std_val / mean_val  # coefficient of variation
            else:
                cv = 0
            
            avg_bench_ratio = avg_val / avg_bench if avg_bench > 0 else 999
            # Check 1: consistently high absolute value → established
            if avg_val >= GAME_14D_ESTABLISHED_AVG:
                is_established = True
                reason += f"；⚠️ 14天均值{avg_val:.0f}/100，搜索量一直很高"
            # Check 1b: high value + declining within 14 days
            elif avg_val >= GAME_14D_DECLINING_AVG:
                first_half = vals[:len(vals)//2]
                second_half = vals[len(vals)//2:]
                avg_first = sum(first_half) / len(first_half) if first_half else 0
                avg_second = sum(second_half) / len(second_half) if second_half else 0
                if avg_second < avg_first and slope <= 0:
                    is_established = True
                    reason += f"；⚠️ 14天均值{avg_val:.0f}/100且在下降，非新起势"
            # Check 2: high ratio to benchmark + low variation → old stable keyword
            elif avg_bench_ratio >= GAME_14D_STABLE_RATIO and cv < GAME_14D_LOW_CV:
                is_established = True
                reason += f"；⚠️ 14天vs_bench={avg_bench_ratio:.1f}x且波动极小(cv={cv:.2f})，非新起势"
            # Check 3: high ratio + declining trend (slope <= 0) → old game fading
            elif avg_bench_ratio >= GAME_14D_STABLE_RATIO and slope <= 0:
                is_established = True
                reason += f"；⚠️ 14天vs_bench={avg_bench_ratio:.1f}x且在下降，非新起势"
    
    if is_established:
            # Exception: if surge is very strong (>2x), it's a re-surge of an old game
            # We might still want to flag it, but with lower priority
            if surge is not None and surge >= GAME_RESURGE_SURGE:
                reason += f"（但近期有{GAME_RESURGE_SURGE}x+回春趋势，可观察）"
                if ratio >= 2.0 and slope > 5:
                    return "📈 rising", reason
                return "⏭️ skip", reason
            return "⏭️ skip", reason
    
    # ── Decision logic (only for keywords without history data or passing history check) ──
    if ratio >= 2.0 and slope > 2:
        return "🔥 hot", reason
    elif ratio >= 2.0 and slope > 0:
        if serp_auth == 0:
            return "📈 rising", reason
        else:
            return "⏭️ skip", reason
    elif ratio >= 2.0 and slope <= 0:
        return "⏭️ skip", reason
    elif ratio >= 1.0 and slope > 0:
        if serp_auth <= 1:
            return "🎯 niche", reason
        else:
            return "📈 rising", reason
    elif ratio >= 0.5 and slope > 0:
        if serp_auth == 0:
            return "🎯 niche", reason
        else:
            return "⏭️ skip", reason
    else:
        return "⏭️ skip", reason


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
    if name_lower in GENERIC_KEYWORDS or name_lower in TOO_GENERIC_GAME_NAMES:
        return False
    words = [w for w in re.split(r"[^a-z0-9]+", name_lower) if w]
    # Multi-word generic combos (category pages, not game names)
    if words and all(w in GENERIC_KEYWORDS for w in words):
        return False
    # Single common word titles are usually false positives, unless clearly stylized.
    if len(words) == 1 and words[0].isalpha() and len(words[0]) <= 8 and words[0] not in {"votv", "obby"}:
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

    # ── Phase 1: CrazyGames /new (latest games by publish date) ──
    crazygames_new = fetch_crazygames_new()

    # ── Phase 1b: Poki new games ──
    poki_new = fetch_poki_new()

    # ── Phase 1c: Addicting Games new releases ──
    ag_new = fetch_addicting_games_new()

    # ── Phase 1d: itch.io new games ──
    itchio_new = fetch_itchio_new()

    # ── Phase 1e: itch.io free games ──
    itchio_free = fetch_itchio_free()

    # ── Combine and deduplicate ──
    seen = set()
    all_games = []
    for g in crazygames_new + poki_new + ag_new + itchio_new + itchio_free:
        key = g["name"].lower()
        if key not in seen and is_game_name_valid(g["name"]):
            seen.add(key)
            all_games.append(g)

    print(f"\n📋 Combined: {len(all_games)} unique new games (CrazyGames + Poki + Addicting Games + itch.io)", flush=True)

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
                "series": r.get("series"),
            })

            print(f"  📊 {kw}: ratio={ratio:.3f}, slope={slope:.3f}, verdict={verdict}", flush=True)

            # Extract trend series for charting
            series = r.get("series")  # {timestamps, values, benchmarkValues}

            # Save initial trends data (SERP pending)
            if not args.dry_run:
                rec, reason = classify_keyword(ratio, slope, verdict)
                save_result(kw, source, ratio, slope, verdict,
                           status="serp_pending", recommendation=rec, reason=reason,
                           trend_series=series)

        if i + BATCH_SIZE < len(to_check):
            time.sleep(1)

    # ── Phase 3.5: Historical baseline check (90-day) ──
    # For keywords with ratio >= 0.3, check if they were already established before the 14-day window
    hist_candidates = [r for r in results if r.get("ratio", 0) >= 0.3]
    hist_baseline = {}
    
    if hist_candidates:
        hist_kws = [r["keyword"] for r in hist_candidates]
        print(f"\n📜 Phase 3.5: Historical baseline check for {len(hist_kws)} keywords (90-day window)...", flush=True)
        
        # Call trends API with 90-day window
        hist_payload = json.dumps({"keywords": hist_kws, "days": HISTORY_DAYS, "benchmark": TREND_BENCHMARK})
        hist_cmd = ["curl", "-sL", "--max-time", "20", f"{API_URL}/api/research/trends",
                     "-H", "Content-Type: application/json",
                     "-H", f"Authorization: Bearer {API_KEY}",
                     "-d", hist_payload]
        try:
            hist_result = subprocess.run(hist_cmd, capture_output=True, text=True, timeout=25)
            hist_data = json.loads(hist_result.stdout)
            hist_job_id = hist_data.get("jobId")
            hist_cost = hist_data.get("cost") if isinstance(hist_data.get("cost"), dict) else {}
            hist_task_count = int(hist_data.get("total") or len(hist_data.get("taskIds") or []) or ((len(hist_kws) + 3) // 4))
            
            hist_results = None
            timed_out = False
            if not hist_job_id and hist_data.get("status") == "complete":
                hist_results = hist_data.get("results", [])
            elif hist_job_id:
                for attempt in range(80):
                    time.sleep(3)
                    poll_cmd = ["curl", "-sL", "--max-time", "15",
                                f"{API_URL}/api/research/trends/status?jobId={hist_job_id}",
                                "-H", f"Authorization: Bearer {API_KEY}"]
                    poll_r = subprocess.run(poll_cmd, capture_output=True, text=True, timeout=20)
                    if not poll_r.stdout.strip():
                        continue
                    poll_d = json.loads(poll_r.stdout)
                    if poll_d.get("status") == "complete":
                        hist_results = poll_d.get("results", [])
                        record_cost_event(
                            provider="dataforseo",
                            endpoint="trends_history_90d",
                            unit_type="task",
                            unit_count=hist_task_count,
                            unit_price_usd=0.00225,
                            actual_cost_usd=hist_cost.get("actualCostUsd"),
                            metadata={"keywords": hist_kws, "days": HISTORY_DAYS, "cost": hist_data.get("cost")}, 
                        )
                        break
                    elif poll_d.get("status") == "failed":
                        break
                else:
                    timed_out = True
                for item in hist_results:
                    kw = item.get("keyword", "").lower()
                    series = item.get("series", {})
                    vals = series.get("values", [])
                    bench = series.get("benchmarkValues", [])
                    
                    if len(vals) >= 75:
                        first75 = vals[:75]
                        last15 = vals[75:]
                        bench75 = bench[:75] if len(bench) >= 75 else bench
                        
                        avg75 = sum(first75) / len(first75)
                        avg15 = sum(last15) / len(last15) if last15 else 0
                        avg_bench75 = sum(bench75) / len(bench75) if bench75 else 0.01
                        
                        hist_vs_bench = avg75 / avg_bench75 if avg_bench75 > 0 else 999
                        surge = avg15 / avg75 if avg75 > 0 else 999
                        
                        hist_baseline[kw] = {
                            "hist_vs_bench": hist_vs_bench,
                            "surge": surge,
                            "hist_avg": avg75,
                        }
                        
                        status = "🔴 OLD" if hist_vs_bench >= 5.0 or avg75 >= 30 or (hist_vs_bench >= 2.0 and surge < 1.2) else "🟢 NEW"
                        print(f"  {status} {kw}: hist75d={avg75:.1f} vs_bench={hist_vs_bench:.1f}x surge={surge:.1f}x", flush=True)
                    else:
                        print(f"  ⚠️ {kw}: only {len(vals)} data points (need 75)", flush=True)
            else:
                reason = "timed out after 240s" if timed_out else "API returned no data"
                print(f"  ❌ Historical baseline {reason} (jobId={hist_job_id})", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"  ❌ Historical baseline error: {e}", file=sys.stderr, flush=True)
    
    # Attach historical data to results
    for r in results:
        hb = hist_baseline.get(r["keyword"].lower())
        if hb:
            r["hist_vs_bench"] = hb["hist_vs_bench"]
            r["surge"] = hb["surge"]
            r["hist_avg"] = hb["hist_avg"]

    # ── Phase 4: SERP competition check for ALL keywords with ratio >= 0.1 ──
    serp_candidates = [r for r in results if r.get("ratio", 0) >= 0.1]

    if serp_candidates:
        print(f"\n🔎 Phase 4: SERP competition check for {len(serp_candidates)} keywords", flush=True)
        serp_kws = [r["keyword"] for r in serp_candidates]
        
        SERP_BATCH = 10
        for i in range(0, len(serp_kws), SERP_BATCH):
            batch = serp_kws[i:i + SERP_BATCH]
            print(f"  SERP batch: {batch}", flush=True)

            serp_resp = call_serp_api(batch)
            if not serp_resp:
                print("  ❌ SERP API failed", flush=True)
                continue
            
            serp_results = serp_resp.get("results", {})
            for r in serp_candidates:
                kw = r["keyword"].lower()
                kw_data = serp_results.get(kw) or serp_results.get(r["keyword"])
                if not kw_data:
                    r["serp_organic"] = 0
                    r["serp_auth"] = 0
                    r["serp_featured"] = False
                    continue
                
                is_low, organic, auth, featured = check_serp_competition(kw_data)
                r["serp_organic"] = organic
                r["serp_auth"] = auth
                r["serp_featured"] = featured
                
                status_str = "🟢" if is_low else "🔴"
                print(f"  {status_str} {r['keyword']}: organic={organic}, auth={auth}, featured={featured}", flush=True)
            
            time.sleep(1)
    
    # ── Phase 5: Final classification with SERP data ──
    print(f"\n🏷️ Phase 5: Final classification", flush=True)
    categorized = {"🔥 hot": [], "📈 rising": [], "🎯 niche": [], "⏭️ skip": []}
    
    for r in results:
        ratio = r.get("ratio", 0)
        slope = r.get("slope", 0)
        verdict = r.get("verdict", "unknown")
        organic = r.get("serp_organic", 0)
        auth = r.get("serp_auth", 0)
        featured = r.get("serp_featured", False)
        
        rec, reason = classify_keyword(ratio, slope, verdict, organic, auth, featured,
                                       hist_vs_bench=r.get("hist_vs_bench"),
                                       surge=r.get("surge"),
                                       hist_avg=r.get("hist_avg"),
                                       series_14d=r.get("series"))
        r["recommendation"] = rec
        r["reason"] = reason
        categorized[rec].append(r)
        
        print(f"  {rec} {r['keyword']}: {reason}", flush=True)
        
        # Update D1 with final classification
        if not args.dry_run:
            status = "done" if rec == "⏭️ skip" else "recommended"
            save_result(
                r["keyword"], r["source"], ratio, slope, verdict,
                status=status, serp_organic=organic, serp_auth=auth,
                serp_featured=1 if featured else 0,
                recommendation=rec, reason=reason,
                trend_series=r.get("series")
            )

    recommended = [r for r in results if r.get("recommendation") != "⏭️ skip"]
    
    print(f"\n{'='*60}")
    print(f"📊 SUMMARY — {ts}")
    print(f"   Data source: CrazyGames /new + Poki /new + Addicting Games")
    print(f"   Total new games found: {len(all_games)}")
    print(f"   Trend-checked: {len(results)}")
    print(f"   🔥 Hot:     {len(categorized['🔥 hot'])}")
    print(f"   📈 Rising:  {len(categorized['📈 rising'])}")
    print(f"   🎯 Niche:   {len(categorized['🎯 niche'])}")
    print(f"   ⏭️ Skip:    {len(categorized['⏭️ skip'])}")
    print(f"{'='*60}")

    if recommended:
        print(f"\n🎮 RECOMMENDED GAME KEYWORDS:")
        for r in sorted(recommended, key=lambda x: x.get("ratio", 0), reverse=True):
            print(f"  {r.get('recommendation', '?')} {r['keyword']} | ratio={r.get('ratio', 0):.3f} | slope={r.get('slope', 0):.3f} | organic={r.get('serp_organic', '?')} | auth={r.get('serp_auth', '?')} | src={r.get('source', '?')}")
            print(f"     Reason: {r.get('reason', 'N/A')}")

    if args.dry_run:
        print(f"\n⚠️ Dry run — nothing saved to D1")

    # Output recommended as JSON for cron to parse
    if recommended:
        print(f"\n__RECOMMENDED_JSON__")
        print(json.dumps(recommended, ensure_ascii=False))

    update_pipeline_run(
        checked_count=len(to_check),
        saved_count=0 if args.dry_run else len(results),
        metadata={
            "total_candidates": len(all_games),
            "trend_checked": len(results),
            "recommended": len(recommended),
            "hot": len(categorized["🔥 hot"]),
            "rising": len(categorized["📈 rising"]),
            "niche": len(categorized["🎯 niche"]),
            "skip": len(categorized["⏭️ skip"]),
            "dry_run": args.dry_run,
        },
    )


if __name__ == "__main__":
    with pipeline_run("game-trend-scanner") as run_id:
        print(f"run_id={run_id}", flush=True)
        main()
