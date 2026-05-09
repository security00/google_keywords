#!/usr/bin/env python3
"""Curated game page radar.

V1: sitemap/new-page diff + keyword extraction only. No Trends, SERP, LLM,
or student-facing writes. This replaces the old noisy sitemap discovery path
with curated admin/cron-only source tracking.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlparse


DEFAULT_D1_DATABASE_ID = "b40de8a4-75e1-4df6-a84d-3ecd62b70538"

GENERIC_KEYWORDS = {
    "about", "about us", "all", "best", "blog", "category", "contact",
    "free", "game", "games", "home", "new", "online", "play", "privacy",
    "search", "tag", "tags", "terms", "unblocked",
}

BOILERPLATE_PATTERNS = [
    r"\bplay\b",
    r"\bonline\b",
    r"\bfor free\b",
    r"\bfree\b",
    r"\bunblocked\b",
    r"\bgame\b",
    r"\bgames\b",
    r"\bon poki\b",
    r"\bon crazygames\b",
    r"\bon addicting games\b",
]


@dataclass
class ExtractedKeyword:
    keyword: str
    normalized: str
    method: str


def _load_env() -> None:
    env_path = os.environ.get("ENV_FILE", "/root/.config/google_keywords/precompute.env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def parse_json_list(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(v) for v in value]
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(v) for v in parsed]
    except Exception:
        pass
    return [str(value)]


def normalize_keyword(keyword: str) -> str:
    return re.sub(r"\s+", " ", keyword.lower()).strip()


def title_case_keyword(keyword: str) -> str:
    small = {"and", "or", "of", "the", "a", "an", "to", "in", "on", "for"}
    words = keyword.split()
    titled = []
    for i, word in enumerate(words):
        lower = word.lower()
        if i > 0 and lower in small:
            titled.append(lower)
        elif word.isupper() and len(word) <= 5:
            titled.append(word)
        else:
            titled.append(word[:1].upper() + word[1:].lower())
    return " ".join(titled)


def clean_keyword(raw: str) -> str | None:
    keyword = raw.replace("-", " ").replace("_", " ")
    keyword = re.sub(r"\.(html?|php)$", "", keyword, flags=re.I)
    keyword = re.sub(r"\s+", " ", keyword).strip(" /|-_")
    for pattern in BOILERPLATE_PATTERNS:
        keyword = re.sub(pattern, " ", keyword, flags=re.I)
    keyword = re.sub(r"\s+", " ", keyword).strip(" /|-_")

    if not keyword or keyword.isdigit():
        return None
    if len(keyword) < 4 or len(keyword) > 60:
        return None
    normalized = normalize_keyword(keyword)
    if normalized in GENERIC_KEYWORDS:
        return None
    if len(normalized.split()) > 6:
        return None
    return title_case_keyword(keyword)


def is_candidate_url(url: str, source: dict) -> bool:
    path = urlparse(url).path
    includes = parse_json_list(source.get("url_include_patterns"))
    excludes = parse_json_list(source.get("url_exclude_patterns"))
    if includes and not any(re.search(pattern, path) for pattern in includes):
        return False
    if excludes and any(re.search(pattern, path) for pattern in excludes):
        return False
    return True


def extract_keyword_from_url(url: str, source: dict) -> ExtractedKeyword | None:
    path = urlparse(url).path.strip("/")
    if not path:
        return None

    rule = {}
    if source.get("keyword_extract_rule"):
        try:
            rule = json.loads(source["keyword_extract_rule"])
        except Exception:
            rule = {}

    raw = ""
    if rule.get("type") == "regex" and rule.get("pattern"):
        match = re.search(rule["pattern"], "/" + path)
        if not match:
            return None
        raw = match.group(1)
    else:
        strip_prefix = str(rule.get("stripPrefix") or "").strip("/")
        if strip_prefix and path.startswith(strip_prefix):
            raw = path[len(strip_prefix):].strip("/").split("/")[0]
        else:
            raw = path.split("/")[-1]

    keyword = clean_keyword(raw)
    if not keyword:
        return None
    return ExtractedKeyword(keyword=keyword, normalized=normalize_keyword(keyword), method=rule.get("type") or "slug")


def fetch_sitemap_urls(sitemap_url: str, depth: int = 0, max_sitemaps: int = 20) -> list[str]:
    if depth > 2:
        return []
    req = urllib.request.Request(
        sitemap_url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; GamePageRadar/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8", errors="replace")
    root = ET.fromstring(text)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    sitemap_locs = [loc.text for loc in root.findall(".//sm:sitemap/sm:loc", ns) if loc.text]
    if sitemap_locs:
        urls: list[str] = []
        for loc in sitemap_locs[:max_sitemaps]:
            try:
                urls.extend(fetch_sitemap_urls(loc, depth + 1, max_sitemaps=max_sitemaps))
                time.sleep(0.2)
            except Exception as exc:
                print(f"  ⚠️ sitemap child failed {loc}: {exc}", flush=True)
        return urls
    return [loc.text for loc in root.findall(".//sm:url/sm:loc", ns) if loc.text]


class D1Client:
    def __init__(self) -> None:
        _load_env()
        self.account_id = os.environ.get("CF_ACCOUNT_ID")
        self.token = os.environ.get("CF_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN")
        self.database_id = os.environ.get("D1_DATABASE_ID", DEFAULT_D1_DATABASE_ID)
        if not self.account_id or not self.token:
            raise RuntimeError("CF_ACCOUNT_ID and CF_API_TOKEN are required")
        self.url = f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/d1/database/{self.database_id}/query"

    def query(self, sql: str, params: list | None = None) -> list[dict]:
        payload = {"sql": sql, "params": params or []}
        req = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode(),
            method="POST",
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"D1 HTTP {exc.code}: {exc.read().decode()[:400]}") from exc
        if not body.get("success") or not body.get("result") or not body["result"][0].get("success"):
            raise RuntimeError(f"D1 query failed: {json.dumps(body, ensure_ascii=False)[:800]}")
        return body["result"][0].get("results", [])


def stable_id(*parts: str, length: int = 16) -> str:
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:length]


def scan_source(source: dict, *, max_pages_per_source: int, dry_run: bool, d1: D1Client | None) -> dict:
    print(f"\n📡 {source['name']} — {source['sitemap_url']}", flush=True)
    try:
        urls = fetch_sitemap_urls(source["sitemap_url"])
    except Exception as exc:
        print(f"  ❌ sitemap fetch failed: {exc}", flush=True)
        return {"source": source["id"], "urls": 0, "candidates": 0, "inserted_pages": 0, "inserted_candidates": 0}

    filtered = [url for url in urls if is_candidate_url(url, source)]
    if max_pages_per_source > 0:
        filtered = filtered[:max_pages_per_source]
    print(f"  URLs: {len(urls)} total, {len(filtered)} candidate pages", flush=True)

    candidates = []
    for url in filtered:
        extracted = extract_keyword_from_url(url, source)
        if extracted:
            candidates.append((url, extracted))
    print(f"  Keywords: {len(candidates)} extracted", flush=True)

    if dry_run or not d1:
        for url, extracted in candidates[:10]:
            print(f"    - {extracted.keyword} ← {url}", flush=True)
        return {"source": source["id"], "urls": len(urls), "candidates": len(candidates), "inserted_pages": 0, "inserted_candidates": 0}

    inserted_pages = 0
    inserted_candidates = 0
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    for url, extracted in candidates:
        url_hash = stable_id(url, length=40)
        page_id = stable_id(source["id"], url, length=16)
        candidate_id = stable_id(source["id"], extracted.normalized, length=16)
        slug_keyword = clean_keyword(urlparse(url).path.strip("/").split("/")[-1])

        d1.query(
            """
            INSERT OR IGNORE INTO game_radar_pages
              (id, source_id, url, url_hash, first_seen_at, last_seen_at, slug_keyword, extracted_keyword, page_type, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'game', 'new', ?, ?)
            """,
            [page_id, source["id"], url, url_hash, now, now, slug_keyword, extracted.keyword, now, now],
        )
        d1.query("UPDATE game_radar_pages SET last_seen_at = ?, updated_at = ? WHERE id = ?", [now, now, page_id])
        inserted_pages += 1

        d1.query(
            """
            INSERT OR IGNORE INTO game_radar_candidates
              (id, page_id, source_id, keyword, keyword_normalized, url, extraction_method, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
            """,
            [candidate_id, page_id, source["id"], extracted.keyword, extracted.normalized, url, extracted.method, now, now],
        )
        inserted_candidates += 1

    d1.query("UPDATE game_radar_sources SET last_checked_at = ?, updated_at = ? WHERE id = ?", [now, now, source["id"]])
    return {"source": source["id"], "urls": len(urls), "candidates": len(candidates), "inserted_pages": inserted_pages, "inserted_candidates": inserted_candidates}


def load_sources(d1: D1Client, max_sources: int) -> list[dict]:
    limit = max(1, max_sources)
    return d1.query(
        "SELECT * FROM game_radar_sources WHERE enabled = 1 ORDER BY quality_tier ASC, COALESCE(last_checked_at, '') ASC LIMIT ?",
        [limit],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Curated game page radar")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-sources", type=int, default=3)
    parser.add_argument("--max-pages-per-source", type=int, default=50)
    args = parser.parse_args()

    print(f"🎯 Game Page Radar — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", flush=True)
    d1 = D1Client()
    sources = load_sources(d1, args.max_sources)
    if not sources:
        print("No enabled game_radar_sources found. Apply migration 0009 first.", flush=True)
        return

    totals = []
    for source in sources:
        totals.append(scan_source(source, max_pages_per_source=args.max_pages_per_source, dry_run=args.dry_run, d1=d1))
        time.sleep(1)

    print("\n📊 Summary", flush=True)
    print(json.dumps(totals, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
