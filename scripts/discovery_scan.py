#!/usr/bin/env python3
"""
Sitemap discovery scanner - runs externally (via OpenClaw cron or CLI).
Bypasses Worker CPU limits by running locally and calling D1 API directly.
"""

import os
import sys
import json
import re
import hashlib
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import urlparse
import time
import urllib.request
import urllib.error

# --- Config ---
def _load_env():
    env_path = os.environ.get("ENV_FILE", "/root/.openclaw/workspace-potter-dev/.env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

_load_env()

CF_API_TOKEN = os.environ.get("CF_API_TOKEN")
CF_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID")
D1_DATABASE_ID = os.environ.get("D1_DATABASE_ID", "b40de8a4-75e1-4df6-a84d-3ecd62b70538")
MAX_SOURCES_PER_RUN = int(os.environ.get("MAX_SOURCES_PER_RUN", "5"))

GENERIC_KEYWORDS = {
    "beauty", "art", "io", "fun", "run", "car", "bus", "pop", "box", "tap",
    "fit", "pet", "hud", "map", "top", "red", "bot", "fly", "mix", "cut",
    "hit", "get", "set", "win", "vip", "pro", "max", "new", "org", "net",
    "play", "game", "games", "online", "free", "best", "cool", "hot", "all",
    "the", "and", "for", "you", "aboutus", "news", "payments", "platform",
    "privacy", "terms", "contact", "blog", "home", "search", "category",
    "copyright dispute policy",
}


def d1_query(sql, params=None):
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/d1/database/{D1_DATABASE_ID}/query"
    payload = {"sql": sql}
    if params:
        payload["params"] = params
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {CF_API_TOKEN}",
        "Content-Type": "application/json",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())
        if result.get("success") and result.get("result"):
            return result["result"][0]
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        print(f"  D1 HTTP {e.code}: {body}", file=sys.stderr)
    except Exception as e:
        print(f"  D1 error: {e}", file=sys.stderr)
    return None


def d1_execute(sql, params=None):
    result = d1_query(sql, params)
    return result is not None


def fetch_sitemap_urls(sitemap_url, depth=0):
    if depth > 2:
        return []
    try:
        req = urllib.request.Request(sitemap_url, headers={"User-Agent": "Mozilla/5.0 (compatible; KeywordScanner/1.0)"})
        resp = urllib.request.urlopen(req, timeout=30)
        text = resp.read().decode("utf-8", errors="replace")
        root = ET.fromstring(text)
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

        urls = []
        sitemap_locs = root.findall(".//sm:sitemap/sm:loc", ns)
        if sitemap_locs:
            for loc in sitemap_locs[:5]:
                sub_urls = fetch_sitemap_urls(loc.text, depth + 1)
                urls.extend(sub_urls)
                time.sleep(1)
        else:
            for loc in root.findall(".//sm:url/sm:loc", ns):
                if loc.text:
                    urls.append(loc.text)
        return urls
    except Exception as e:
        print(f"  Sitemap error ({sitemap_url}): {e}", file=sys.stderr)
        return []


def extract_keyword(url, rules=None):
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


def normalize_keyword(keyword):
    return re.sub(r"\s+", " ", keyword.lower().strip())


def scan_source(source):
    name = source.get("name", "unknown")
    sitemap_url = source.get("sitemap_url")
    source_id = source.get("id")
    user_id = source.get("user_id", "")
    rules = None
    if source.get("rules_json"):
        try:
            rules = json.loads(source["rules_json"])
        except:
            pass

    print(f"\n📡 {name} ({sitemap_url})", flush=True)
    urls = fetch_sitemap_urls(sitemap_url)
    print(f"  {len(urls)} URLs", flush=True)

    if not urls:
        return 0, 0

    keywords = {}
    for u in urls:
        kw = extract_keyword(u, rules)
        if kw:
            norm = normalize_keyword(kw)
            if norm not in keywords:
                keywords[norm] = kw

    print(f"  {len(keywords)} unique keywords after filtering", flush=True)
    if not keywords:
        return 0, 0

    inserted = 0
    skipped = 0
    kw_list = list(keywords.items())

    for i in range(0, len(kw_list), 14):
        batch = kw_list[i:i + 100]
        norms = [k for k, v in batch]

        # Check existing in chunks of 50
        existing = set()
        for j in range(0, len(norms), 30):
            chunk = norms[j:j + 50]
            placeholders = ",".join(["?"] * len(chunk))
            result = d1_query(
                f"SELECT keyword_normalized FROM discovered_keywords WHERE keyword_normalized IN ({placeholders})",
                chunk
            )
            if result and result.get("results"):
                existing.update(r["keyword_normalized"] for r in result["results"])

        new_kws = [(n, d) for n, d in batch if n not in existing]
        skipped += len(batch) - len(new_kws)

        if not new_kws:
            continue

        # Batch INSERT
        values_sql = ",".join(["(?,?,?,?,?,?,?)"] * len(new_kws))
        params = []
        for norm, display in new_kws:
            kw_id = hashlib.md5(f"{source_id}:{norm}".encode()).hexdigest()[:8]
            params.extend([kw_id, user_id, source_id, display, norm, "", "new"])

        ok = d1_execute(
            f"INSERT OR IGNORE INTO discovered_keywords (id, user_id, source_id, keyword, keyword_normalized, url, status) VALUES {values_sql}",
            params
        )
        if ok:
            inserted += len(new_kws)
        else:
            print(f"  ⚠️ Insert failed for {len(new_kws)} keywords", flush=True)

    print(f"  ✅ +{inserted} new, {skipped} existing", flush=True)
    return inserted, skipped


def cleanup_junk():
    print("\n🧹 Cleanup...", flush=True)
    d1_execute("DELETE FROM discovered_keywords WHERE keyword_normalized GLOB '[0-9]*' AND length(keyword_normalized) <= 5")
    d1_execute("DELETE FROM discovered_keywords WHERE length(keyword_normalized) <= 3")
    # Generic words via individual deletes for safety
    for w in list(GENERIC_KEYWORDS)[:20]:
        d1_execute("DELETE FROM discovered_keywords WHERE keyword_normalized = ?", [w])
    result = d1_query("SELECT COUNT(*) as cnt FROM discovered_keywords")
    total = result["results"][0]["cnt"] if result and result.get("results") else "?"
    print(f"  Total after cleanup: {total}", flush=True)


def main():
    if not CF_API_TOKEN or not CF_ACCOUNT_ID:
        print("Error: CF_API_TOKEN and CF_ACCOUNT_ID required", file=sys.stderr)
        sys.exit(1)

    print(f"🔍 Discovery Scanner - {datetime.now(timezone.utc).isoformat()}", flush=True)

    result = d1_query(
        "SELECT * FROM sitemap_sources WHERE enabled = 1 ORDER BY last_checked_at ASC LIMIT ?",
        [MAX_SOURCES_PER_RUN]
    )

    if not result or not result.get("results"):
        print("No sources to scan", flush=True)
        return

    sources = result["results"]
    print(f"Scanning {len(sources)} sources", flush=True)

    total_inserted = 0
    total_skipped = 0

    for source in sources:
        inserted, skipped = scan_source(source)

        now = datetime.now(timezone.utc).isoformat()
        d1_execute(
            "UPDATE sitemap_sources SET last_checked_at = ?, updated_at = ? WHERE id = ?",
            [now, now, source["id"]]
        )

        total_inserted += inserted
        total_skipped += skipped
        time.sleep(3)

    cleanup_junk()

    result = d1_query("SELECT COUNT(*) as cnt FROM discovered_keywords")
    total = result["results"][0]["cnt"] if result and result.get("results") else "?"

    print(f"\n{'='*50}", flush=True)
    print(f"📊 Done: {len(sources)} sources, +{total_inserted} new, {total_skipped} existing, total: {total}", flush=True)


if __name__ == "__main__":
    main()
