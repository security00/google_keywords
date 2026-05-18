#!/usr/bin/env python3
"""SERP validation for admin-only Game Radar candidates.

This script validates operator-approved radar candidates against the existing
SERP API, then writes the result back to game_radar_candidates. It does not
promote anything to game_keyword_pipeline.
"""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone

try:
    from scripts.game_suggest_radar import D1Client
    from scripts.game_trend_scanner import check_serp_competition
except ModuleNotFoundError:
    from game_suggest_radar import D1Client
    from game_trend_scanner import check_serp_competition


DEFAULT_API_URL = "https://discoverkeywords.co"
MIN_GAME_RELEVANCE = 1
MAX_AUTH_DOMAINS = 1


@dataclass(frozen=True)
class RadarCandidate:
    id: str
    keyword: str
    source_id: str
    status: str


@dataclass(frozen=True)
class SerpDecision:
    status: str
    organic: int
    auth: int
    featured: bool
    game_relevance: int
    reason: str
    reject_reason: str | None


def load_env() -> None:
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


def classify_serp_result(
    serp_data: dict,
    keyword: str,
    *,
    min_game_relevance: int = MIN_GAME_RELEVANCE,
    max_auth_domains: int = MAX_AUTH_DOMAINS,
) -> SerpDecision:
    is_low, organic, auth, featured, game_relevance = check_serp_competition(serp_data, keyword)
    if game_relevance < min_game_relevance:
        return SerpDecision(
            status="serp_fail",
            organic=int(organic or 0),
            auth=int(auth or 0),
            featured=bool(featured),
            game_relevance=int(game_relevance or 0),
            reason=f"serp_not_game_relevant: organic={organic}, auth={auth}, game_rel={game_relevance}",
            reject_reason="serp_not_game_relevant",
        )
    if int(auth or 0) > max_auth_domains and not is_low:
        return SerpDecision(
            status="serp_fail",
            organic=int(organic or 0),
            auth=int(auth or 0),
            featured=bool(featured),
            game_relevance=int(game_relevance or 0),
            reason=f"serp_competition_high: organic={organic}, auth={auth}, game_rel={game_relevance}",
            reject_reason="serp_competition_high",
        )
    return SerpDecision(
        status="serp_pass",
        organic=int(organic or 0),
        auth=int(auth or 0),
        featured=bool(featured),
        game_relevance=int(game_relevance or 0),
        reason=f"serp_signal_ok: organic={organic}, auth={auth}, featured={bool(featured)}, game_rel={game_relevance}",
        reject_reason=None,
    )


def fetch_candidates(d1: D1Client, *, limit: int, source: str | None, status: list[str]) -> list[RadarCandidate]:
    where = ["c.status IN (%s)" % ",".join("?" for _ in status)]
    params: list[object] = list(status)
    if source:
        where.append("c.source_id = ?")
        params.append(source)
    sql = f"""
        SELECT c.id, c.keyword, c.source_id, c.status
        FROM game_radar_candidates c
        JOIN game_radar_sources s ON s.id = c.source_id
        WHERE {" AND ".join(where)}
        ORDER BY s.quality_tier ASC, c.updated_at DESC, c.created_at DESC
        LIMIT ?
    """
    params.append(limit)
    rows = d1.query(sql, params)
    return [
        RadarCandidate(
            id=str(row["id"]),
            keyword=str(row["keyword"]),
            source_id=str(row["source_id"]),
            status=str(row["status"]),
        )
        for row in rows
    ]


def request_json(url: str, *, api_key: str, payload: dict, timeout: int = 140) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "curl/8.5.0",
            "Authorization": f"Bearer {api_key}",
            "X-Cron-Secret": os.environ.get("GK_CRON_SECRET", ""),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}: {exc.read().decode(errors='ignore')[:400]}") from exc


def call_serp_api(api_url: str, api_key: str, keywords: list[str], *, max_wait_ms: int) -> dict:
    response = request_json(
        api_url.rstrip("/") + "/api/research/serp",
        api_key=api_key,
        payload={"keywords": keywords, "maxWaitMs": max_wait_ms, "mode": "live"},
    )
    if response.get("error"):
        raise RuntimeError(str(response.get("error")))
    return dict(response.get("results") or {})


def update_candidate(d1: D1Client, candidate_id: str, decision: SerpDecision) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    d1.query(
        """
        UPDATE game_radar_candidates
        SET status = ?,
            reject_reason = ?,
            serp_organic = ?,
            serp_auth = ?,
            serp_featured = ?,
            serp_game_relevance = ?,
            serp_checked_at = ?,
            serp_reason = ?,
            updated_at = ?
        WHERE id = ?
        """,
        [
            decision.status,
            decision.reject_reason,
            decision.organic,
            decision.auth,
            1 if decision.featured else 0,
            decision.game_relevance,
            now,
            decision.reason,
            now,
            candidate_id,
        ],
    )


def validate_candidates(
    d1: D1Client,
    candidates: list[RadarCandidate],
    *,
    api_url: str,
    api_key: str,
    batch_size: int,
    max_wait_ms: int,
    min_game_relevance: int,
    max_auth_domains: int,
    dry_run: bool,
) -> dict[str, int]:
    totals = {"checked": 0, "passed": 0, "failed": 0}
    by_keyword = {item.keyword.lower(): item for item in candidates}

    for start in range(0, len(candidates), batch_size):
        batch = candidates[start:start + batch_size]
        keywords = [item.keyword for item in batch]
        print(f"batch {start // batch_size + 1}: {keywords}", flush=True)
        results = call_serp_api(api_url, api_key, keywords, max_wait_ms=max_wait_ms)
        results_by_keyword = {str(key).lower(): value for key, value in results.items()}

        for keyword in keywords:
            candidate = by_keyword.get(keyword.lower())
            serp_data = results.get(keyword) or results_by_keyword.get(keyword.lower())
            if not candidate or not serp_data:
                continue
            decision = classify_serp_result(
                serp_data,
                keyword,
                min_game_relevance=min_game_relevance,
                max_auth_domains=max_auth_domains,
            )
            totals["checked"] += 1
            totals["passed" if decision.status == "serp_pass" else "failed"] += 1
            print(
                f"  {keyword}: {decision.status} organic={decision.organic} auth={decision.auth} game_rel={decision.game_relevance}",
                flush=True,
            )
            if not dry_run:
                update_candidate(d1, candidate.id, decision)

    return totals


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate approved Game Radar candidates with SERP")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--source", help="Filter by source_id")
    parser.add_argument("--status", action="append", default=[], help="Candidate status to validate; repeatable")
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--max-wait-ms", type=int, default=90_000)
    parser.add_argument("--min-game-relevance", type=int, default=MIN_GAME_RELEVANCE)
    parser.add_argument("--max-auth-domains", type=int, default=MAX_AUTH_DOMAINS)
    parser.add_argument("--write", action="store_true", help="Write SERP verdicts to D1. Omit for dry-run.")
    args = parser.parse_args()

    load_env()
    api_url = os.environ.get("GK_API_URL", DEFAULT_API_URL)
    api_key = os.environ.get("GK_API_KEY", "")
    if not api_key:
        raise RuntimeError("GK_API_KEY env var required")

    d1 = D1Client()
    statuses = args.status or ["approved"]
    candidates = fetch_candidates(d1, limit=args.limit, source=args.source, status=statuses)
    print(
        f"Game Radar SERP - candidates={len(candidates)} statuses={statuses} source={args.source or 'all'} write={args.write}",
        flush=True,
    )
    for candidate in candidates[:20]:
        print(f"- {candidate.keyword} [{candidate.source_id}] {candidate.status}", flush=True)
    if not candidates:
        return

    totals = validate_candidates(
        d1,
        candidates,
        api_url=api_url,
        api_key=api_key,
        batch_size=max(1, args.batch_size),
        max_wait_ms=args.max_wait_ms,
        min_game_relevance=args.min_game_relevance,
        max_auth_domains=args.max_auth_domains,
        dry_run=not args.write,
    )
    print(json.dumps(totals, ensure_ascii=False, indent=2), flush=True)
    if not args.write:
        print("dry-run: pass --write to save SERP verdicts", flush=True)


if __name__ == "__main__":
    main()
