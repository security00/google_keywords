#!/usr/bin/env python3
"""Release-source radar for admin-only new game candidates.

Collects explicit new-release feeds (Steam, itch.io newest, itch.io latest
free games, and Roblox search discovery) and writes them into game_radar_* tables. This is candidate
discovery only: no Trends, SERP, LLM, or student-facing writes happen here.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote_plus

try:
    from scripts.game_suggest_radar import D1Client, normalize_keyword, stable_id
    from scripts.game_trend_scanner import is_game_name_valid
except ModuleNotFoundError:
    from game_suggest_radar import D1Client, normalize_keyword, stable_id
    from game_trend_scanner import is_game_name_valid


@dataclass(frozen=True)
class ReleaseCandidate:
    keyword: str
    normalized: str
    source_id: str
    source_name: str
    base_url: str
    feed_url: str
    url: str
    title: str


SOURCES = {
    "steam-new": {
        "name": "Steam New Releases",
        "base_url": "https://store.steampowered.com",
        "feed_url": "https://store.steampowered.com/api/featuredcategories",
        "quality_tier": 1,
    },
    "itchio-new": {
        "name": "itch.io Newest",
        "base_url": "https://itch.io",
        "feed_url": "https://itch.io/games/newest",
        "quality_tier": 2,
    },
    "itchio-new-free": {
        "name": "itch.io Latest Free",
        "base_url": "https://itch.io",
        "feed_url": "https://itch.io/games/newest/free",
        "quality_tier": 3,
    },
    "roblox-search": {
        "name": "Roblox Search",
        "base_url": "https://www.roblox.com",
        "feed_url": "https://apis.roblox.com/search-api/omni-search",
        "quality_tier": 2,
    },
}

ROBLOX_SEARCH_QUERIES = [
    "new",
    "updated",
    "anime",
    "obby",
    "simulator",
    "tycoon",
    "tower defense",
]

ADULT_STEAM_TOKENS = (
    "hentai", "🔞", "nsfw", "18+", "sex", "porn", "futanari", "oneeshota",
    "waifu", "adult", "nude", "erotic", "bdsm", "pleasure", "brothel",
    "succubus", "strip", "lust", "horny",
)


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; GameReleaseRadar/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def fetch_html(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; GameReleaseRadar/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def is_release_name_allowed(name: str) -> bool:
    lower = name.lower()
    if any(token in lower for token in ADULT_STEAM_TOKENS):
        return False
    return is_game_name_valid(name)


def title_from_itch_url(url: str) -> str:
    slug = url.rstrip("/").split("/")[-1]
    return slug.replace("-", " ").strip().title()


def clean_roblox_name(name: str) -> str:
    cleaned = re.sub(r"\[[^\]]{1,24}\]", " ", name)
    cleaned = re.sub(r"[^\w\s:'&!?.+-]", " ", cleaned, flags=re.UNICODE)
    return re.sub(r"\s+", " ", cleaned).strip()


def fetch_steam_new() -> list[ReleaseCandidate]:
    source = SOURCES["steam-new"]
    data = fetch_json(source["feed_url"])
    new_releases = data.get("new_releases", [])
    if isinstance(new_releases, dict) and "items" in new_releases:
        new_releases = new_releases["items"]
    elif isinstance(new_releases, list) and len(new_releases) >= 3 and isinstance(new_releases[2], list):
        new_releases = new_releases[2]

    candidates: list[ReleaseCandidate] = []
    seen: set[str] = set()
    for item in new_releases:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        app_id = item.get("id")
        if not name or not app_id:
            continue
        if not is_release_name_allowed(name):
            continue
        normalized = normalize_keyword(name)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        url = f"https://store.steampowered.com/app/{app_id}"
        candidates.append(
            ReleaseCandidate(
                keyword=name,
                normalized=normalized,
                source_id="steam-new",
                source_name=source["name"],
                base_url=source["base_url"],
                feed_url=source["feed_url"],
                url=url,
                title=f"{name} | Steam New Release",
            )
        )
    return candidates


def fetch_itchio(source_id: str) -> list[ReleaseCandidate]:
    source = SOURCES[source_id]
    html = fetch_html(source["feed_url"])
    links = re.findall(r'href="(https://[a-z0-9-]+\.itch\.io/[a-z0-9-]+)"', html)
    candidates: list[ReleaseCandidate] = []
    seen: set[str] = set()
    for url in dict.fromkeys(links):
        name = title_from_itch_url(url)
        if not is_release_name_allowed(name):
            continue
        normalized = normalize_keyword(name)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        candidates.append(
            ReleaseCandidate(
                keyword=name,
                normalized=normalized,
                source_id=source_id,
                source_name=source["name"],
                base_url=source["base_url"],
                feed_url=source["feed_url"],
                url=url,
                title=f"{name} | {source['name']}",
            )
        )
    return candidates


def fetch_roblox_search(queries: list[str] | None = None) -> list[ReleaseCandidate]:
    source = SOURCES["roblox-search"]
    candidates: list[ReleaseCandidate] = []
    seen: set[str] = set()
    for query in queries or ROBLOX_SEARCH_QUERIES:
        url = f"{source['feed_url']}?searchQuery={quote_plus(query)}&sessionId=game-release-radar"
        data = fetch_json(url)
        for group in data.get("searchResults", []):
            if not isinstance(group, dict) or group.get("contentGroupType") != "Game":
                continue
            contents = group.get("contents", [])
            if not isinstance(contents, list):
                continue
            for item in contents:
                if not isinstance(item, dict):
                    continue
                raw_name = str(item.get("name") or "").strip()
                root_place_id = item.get("rootPlaceId")
                if not raw_name or not root_place_id:
                    continue
                name = clean_roblox_name(raw_name)
                if not name or not is_release_name_allowed(name):
                    continue
                normalized = normalize_keyword(name)
                if not normalized or normalized in seen:
                    continue
                seen.add(normalized)
                canonical_path = str(item.get("canonicalUrlPath") or "")
                game_url = f"{source['base_url']}{canonical_path}" if canonical_path.startswith("/games/") else f"{source['base_url']}/games/{root_place_id}"
                candidates.append(
                    ReleaseCandidate(
                        keyword=name,
                        normalized=normalized,
                        source_id="roblox-search",
                        source_name=source["name"],
                        base_url=source["base_url"],
                        feed_url=source["feed_url"],
                        url=game_url,
                        title=f"{name} | Roblox",
                    )
                )
        time.sleep(0.2)
    return candidates


def collect_candidates(sources: list[str]) -> list[ReleaseCandidate]:
    all_candidates: list[ReleaseCandidate] = []
    for source_id in sources:
        try:
            if source_id == "steam-new":
                candidates = fetch_steam_new()
            elif source_id in {"itchio-new", "itchio-new-free"}:
                candidates = fetch_itchio(source_id)
            elif source_id == "roblox-search":
                candidates = fetch_roblox_search()
            else:
                print(f"skip unknown source: {source_id}", file=sys.stderr, flush=True)
                continue
            print(f"{source_id}: {len(candidates)} candidates", flush=True)
            all_candidates.extend(candidates)
        except Exception as exc:
            print(f"{source_id}: fetch failed: {exc}", file=sys.stderr, flush=True)
        time.sleep(0.5)
    return all_candidates


def ensure_source(d1: D1Client, source_id: str) -> None:
    source = SOURCES[source_id]
    d1.query(
        """
        INSERT OR IGNORE INTO game_radar_sources
          (id, name, base_url, sitemap_url, enabled, quality_tier, url_include_patterns, url_exclude_patterns, keyword_extract_rule)
        VALUES (?, ?, ?, ?, 1, ?, '[]', '[]', '{"type":"release_feed"}')
        """,
        [source_id, source["name"], source["base_url"], source["feed_url"], source["quality_tier"]],
    )


def write_candidates(d1: D1Client, candidates: list[ReleaseCandidate]) -> dict[str, int]:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    inserted_pages = 0
    inserted_candidates = 0
    touched_sources: set[str] = set()

    for candidate in candidates:
        ensure_source(d1, candidate.source_id)
        touched_sources.add(candidate.source_id)
        page_id = stable_id(candidate.source_id, candidate.url, length=16)
        candidate_id = stable_id(candidate.source_id, candidate.normalized, length=16)
        url_hash = stable_id(candidate.url, length=40)
        page_rows = d1.query(
            """
            INSERT OR IGNORE INTO game_radar_pages
              (id, source_id, url, url_hash, first_seen_at, last_seen_at, title, slug_keyword, extracted_keyword, page_type, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'release', 'new', ?, ?)
            RETURNING id
            """,
            [page_id, candidate.source_id, candidate.url, url_hash, now, now, candidate.title, candidate.keyword, candidate.keyword, now, now],
        )
        if page_rows:
            inserted_pages += 1
        else:
            existing_pages = d1.query("SELECT id FROM game_radar_pages WHERE url_hash = ? LIMIT 1", [url_hash])
            if existing_pages and existing_pages[0].get("id"):
                page_id = str(existing_pages[0]["id"])
            else:
                continue
        d1.query("UPDATE game_radar_pages SET last_seen_at = ?, updated_at = ? WHERE id = ?", [now, now, page_id])

        candidate_rows = d1.query(
            """
            INSERT OR IGNORE INTO game_radar_candidates
              (id, page_id, source_id, keyword, keyword_normalized, url, title, extraction_method, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'release_feed', 'new', ?, ?)
            RETURNING id
            """,
            [candidate_id, page_id, candidate.source_id, candidate.keyword, candidate.normalized, candidate.url, candidate.title, now, now],
        )
        if candidate_rows:
            inserted_candidates += 1

    for source_id in touched_sources:
        d1.query("UPDATE game_radar_sources SET last_checked_at = ?, updated_at = ? WHERE id = ?", [now, now, source_id])

    return {"pages": inserted_pages, "candidates": inserted_candidates}


def main() -> None:
    parser = argparse.ArgumentParser(description="New release game radar")
    parser.add_argument("--source", action="append", choices=sorted(SOURCES), default=[], help="Source to scan; repeatable")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--write", action="store_true", help="Write candidates to D1. Omit for dry-run.")
    args = parser.parse_args()

    sources = args.source or ["steam-new", "roblox-search", "itchio-new", "itchio-new-free"]
    print(f"Game Release Radar - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", flush=True)
    print(f"sources={sources} write={args.write}", flush=True)
    candidates = collect_candidates(sources)
    if args.limit > 0:
        candidates = candidates[: args.limit]
    print(f"candidates={len(candidates)}", flush=True)
    for item in candidates[:30]:
        print(f"- {item.keyword} [{item.source_id}] {item.url}", flush=True)

    if not args.write:
        print("dry-run: pass --write to save into game_radar_candidates", flush=True)
        return

    d1 = D1Client()
    result = write_candidates(d1, candidates)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
