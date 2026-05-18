#!/usr/bin/env python3
"""Google Suggest radar for game keyword candidates.

V1: collect Google autocomplete suggestions from a small seed set, clean them
into game-entity candidates, and optionally write them to the admin-only
game_radar_* tables. No Trends, SERP, LLM, or student-facing writes happen here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone


DEFAULT_D1_DATABASE_ID = "b40de8a4-75e1-4df6-a84d-3ecd62b70538"
DEFAULT_SOURCE_ID = "google-suggest"
DEFAULT_SEEDS = [
    "new game",
    "upcoming game",
    "game codes",
    "game guide",
    "roblox game",
    "steam game",
    "itch.io game",
    "unblocked game",
]

ENTITY_SUFFIX_PATTERNS = [
    r"\bcodes?\b",
    r"\bguide\b",
    r"\bwalkthrough\b",
    r"\bwiki\b",
    r"\btier list\b",
    r"\bvalue list\b",
    r"\bvalues?\b",
    r"\bcalculator\b",
    r"\brelease date\b",
    r"\bdownload\b",
    r"\bunblocked\b",
    r"\bonline\b",
    r"\bgameplay\b",
    r"\btrailer\b",
    r"\bapk\b",
    r"\bmod\b",
    r"\bmods\b",
    r"\bscript\b",
    r"\bscripts\b",
]

LEADING_INTENT_PATTERNS = [
    r"^game codes?[ ]+(for[ ]+)?",
    r"^game guide[ ]+",
    r"^roblox games?[ ]+",
    r"^steam games?[ ]+",
    r"^new games?[ ]+",
    r"^upcoming games?[ ]+",
]

GENERIC_REJECTS = {
    "game", "games", "new game", "new games", "online game", "online games",
    "unblocked game", "unblocked games", "steam game", "steam games",
    "roblox game", "roblox games", "itch io game", "itch io games",
    "game codes", "game guide", "upcoming game", "upcoming games",
    "app", "books", "cheap", "cos", "free", "ideas", "plus", "ps5",
    "releases", "releases 2026", "sale", "stats", "steam", "website", "xbox",
}

NOISE_PATTERNS = [
    r"\b(best|top|free|online|unblocked)\s+(games?|roblox games?)\b",
    r"\b(games?|roblox|steam|itch io)\s+(to play|for kids|online|unblocked)\b",
    r"\b(download|apk|mod menu|script executor|hack|cheat)\b",
    r"\b(reddit|discord|youtube|twitter|tiktok)\b",
    r"\b(game of thrones|nintendo switch)\b",
    r"\b(gamepass|game pass|create|price|cheap|sale)\b",
    r"\b(python|editor|engine|example|discount|comparison|qr|join)\b",
    r"\b(android|archive|booklet|books pdf|jobs|nebraska|channel|unity)\b",
]


@dataclass(frozen=True)
class SuggestCandidate:
    keyword: str
    normalized: str
    suggestion: str
    seed: str
    query: str
    url: str


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


def stable_id(*parts: str, length: int = 16) -> str:
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:length]


def normalize_keyword(keyword: str) -> str:
    text = keyword.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def title_case_keyword(keyword: str) -> str:
    small = {"and", "or", "of", "the", "a", "an", "to", "in", "on", "for"}
    words = keyword.split()
    titled: list[str] = []
    for index, word in enumerate(words):
        lower = word.lower()
        if index > 0 and lower in small:
            titled.append(lower)
        elif word.isupper() and len(word) <= 5:
            titled.append(word)
        else:
            titled.append(word[:1].upper() + word[1:].lower())
    return " ".join(titled)


def clean_suggest_keyword(suggestion: str) -> str | None:
    text = normalize_keyword(suggestion)
    if not text:
        return None
    if text in GENERIC_REJECTS or any(re.search(pattern, text, flags=re.I) for pattern in NOISE_PATTERNS):
        return None

    for pattern in LEADING_INTENT_PATTERNS:
        text = re.sub(pattern, " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()

    for pattern in ENTITY_SUFFIX_PATTERNS:
        text = re.sub(pattern, " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\b(game|games)\b$", " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()

    if not text or text in GENERIC_REJECTS:
        return None
    if any(re.search(pattern, text, flags=re.I) for pattern in NOISE_PATTERNS):
        return None
    if text.isdigit() or len(text) < 4 or len(text) > 60:
        return None
    words = text.split()
    if len(words) > 5:
        return None
    if len(words) == 1 and words[0] in {"roblox", "steam", "minecraft", "fortnite"}:
        return None
    return title_case_keyword(text)


def build_seed_queries(seeds: list[str], alphabet: bool) -> list[tuple[str, str]]:
    queries: list[tuple[str, str]] = []
    seen: set[str] = set()
    for seed in seeds:
        cleaned = re.sub(r"\s+", " ", seed.strip().lower())
        if not cleaned:
            continue
        variants = [cleaned]
        if alphabet and "codes" not in cleaned and "code" not in cleaned:
            variants.extend(f"{cleaned} {letter}" for letter in string.ascii_lowercase)
        for query in variants:
            if query in seen:
                continue
            seen.add(query)
            queries.append((cleaned, query))
    return queries


def fetch_google_suggestions(query: str) -> list[str]:
    params = urllib.parse.urlencode({"client": "firefox", "hl": "en", "gl": "US", "q": query})
    url = f"https://suggestqueries.google.com/complete/search?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; GameSuggestRadar/1.0)"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read().decode("utf-8", errors="replace"))
    if not isinstance(payload, list) or len(payload) < 2 or not isinstance(payload[1], list):
        return []
    return [str(item) for item in payload[1] if isinstance(item, str) and item.strip()]


def collect_candidates(seeds: list[str], *, alphabet: bool, sleep_seconds: float = 0.2) -> list[SuggestCandidate]:
    by_keyword: dict[str, SuggestCandidate] = {}
    for seed, query in build_seed_queries(seeds, alphabet):
        try:
            suggestions = fetch_google_suggestions(query)
        except Exception as exc:
            print(f"  suggest failed: {query}: {exc}", file=sys.stderr, flush=True)
            continue
        for suggestion in suggestions:
            keyword = clean_suggest_keyword(suggestion)
            if not keyword:
                continue
            normalized = normalize_keyword(keyword)
            by_keyword.setdefault(
                normalized,
                SuggestCandidate(
                    keyword=keyword,
                    normalized=normalized,
                    suggestion=suggestion,
                    seed=seed,
                    query=query,
                    url=f"https://www.google.com/search?q={urllib.parse.quote_plus(suggestion)}",
                ),
            )
        time.sleep(max(0, sleep_seconds))
    return sorted(by_keyword.values(), key=lambda item: (item.seed, item.keyword))


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


def ensure_suggest_source(d1: D1Client, source_id: str) -> None:
    d1.query(
        """
        INSERT OR IGNORE INTO game_radar_sources
          (id, name, base_url, sitemap_url, enabled, quality_tier, url_include_patterns, url_exclude_patterns, keyword_extract_rule)
        VALUES (?, 'Google Suggest', 'https://www.google.com', 'https://suggestqueries.google.com/complete/search', 1, 1, '[]', '[]', '{"type":"google_suggest"}')
        """,
        [source_id],
    )


def write_candidates(d1: D1Client, source_id: str, candidates: list[SuggestCandidate]) -> dict[str, int]:
    ensure_suggest_source(d1, source_id)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    inserted_pages = 0
    inserted_candidates = 0
    for candidate in candidates:
        page_id = stable_id(source_id, candidate.url, length=16)
        candidate_id = stable_id(source_id, candidate.normalized, length=16)
        url_hash = stable_id(candidate.url, length=40)
        title = f"{candidate.suggestion} | Google Suggest"
        d1.query(
            """
            INSERT OR IGNORE INTO game_radar_pages
              (id, source_id, url, url_hash, first_seen_at, last_seen_at, title, slug_keyword, extracted_keyword, page_type, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggest', 'new', ?, ?)
            """,
            [page_id, source_id, candidate.url, url_hash, now, now, title, candidate.suggestion, candidate.keyword, now, now],
        )
        d1.query("UPDATE game_radar_pages SET last_seen_at = ?, updated_at = ? WHERE id = ?", [now, now, page_id])
        inserted_pages += 1
        d1.query(
            """
            INSERT OR IGNORE INTO game_radar_candidates
              (id, page_id, source_id, keyword, keyword_normalized, url, title, extraction_method, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'google_suggest', 'new', ?, ?)
            """,
            [candidate_id, page_id, source_id, candidate.keyword, candidate.normalized, candidate.url, title, now, now],
        )
        inserted_candidates += 1
    d1.query("UPDATE game_radar_sources SET last_checked_at = ?, updated_at = ? WHERE id = ?", [now, now, source_id])
    return {"pages": inserted_pages, "candidates": inserted_candidates}


def parse_seed_args(values: list[str]) -> list[str]:
    seeds: list[str] = []
    for value in values:
        seeds.extend(part.strip() for part in value.split(",") if part.strip())
    return seeds or DEFAULT_SEEDS


def main() -> None:
    parser = argparse.ArgumentParser(description="Google Suggest game radar")
    parser.add_argument("--seed", action="append", default=[], help="Seed query; can be repeated or comma-separated")
    parser.add_argument("--alphabet", action="store_true", help="Also query seed plus a-z")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--write", action="store_true", help="Write candidates to D1. Omit for dry-run.")
    parser.add_argument("--source-id", default=DEFAULT_SOURCE_ID)
    parser.add_argument("--sleep", type=float, default=0.2)
    args = parser.parse_args()

    seeds = parse_seed_args(args.seed)
    print(f"Game Suggest Radar - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", flush=True)
    print(f"seeds={seeds} alphabet={args.alphabet} write={args.write}", flush=True)
    candidates = collect_candidates(seeds, alphabet=args.alphabet, sleep_seconds=args.sleep)
    if args.limit > 0:
        candidates = candidates[: args.limit]
    print(f"candidates={len(candidates)}", flush=True)
    for item in candidates[:30]:
        print(f"- {item.keyword} <- {item.suggestion} [{item.query}]", flush=True)
    if not args.write:
        print("dry-run: pass --write to save into game_radar_candidates", flush=True)
        return
    d1 = D1Client()
    result = write_candidates(d1, args.source_id, candidates)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
