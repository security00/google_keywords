#!/usr/bin/env python3
"""Promote fully validated Game Radar candidates to game_keyword_pipeline.

Promotion is intentionally conservative:
- source candidate must already be status=serp_pass
- trend and SERP fields must be present
- writes one recommended row to game_keyword_pipeline
- marks the radar candidate as promoted
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone

try:
    from scripts.game_suggest_radar import D1Client
    from scripts.game_radar_trends import load_env
except ModuleNotFoundError:
    from game_suggest_radar import D1Client
    from game_radar_trends import load_env


@dataclass(frozen=True)
class PromotableCandidate:
    id: str
    keyword: str
    source_id: str
    trend_ratio: float
    trend_slope: float
    trend_verdict: str
    trend_series: str | None
    serp_organic: int
    serp_auth: int
    serp_featured: int
    serp_game_relevance: int
    trend_reason: str | None
    serp_reason: str | None
    operator_note: str | None


def parse_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def recommendation_for(candidate: PromotableCandidate) -> tuple[str, str]:
    if candidate.trend_ratio >= 2.0 or candidate.trend_slope > 5:
        recommendation = "🔥 hot"
    elif candidate.trend_ratio >= 0.5 and candidate.trend_slope > 0:
        recommendation = "📈 rising"
    else:
        recommendation = "🎯 niche"

    reason_parts = [
        f"Radar promotion: trend ratio {candidate.trend_ratio:.2f}, slope {candidate.trend_slope:.2f}, verdict {candidate.trend_verdict}",
        f"SERP passed: organic {candidate.serp_organic}, auth {candidate.serp_auth}, game relevance {candidate.serp_game_relevance}",
    ]
    if candidate.trend_reason:
        reason_parts.append(candidate.trend_reason)
    if candidate.serp_reason:
        reason_parts.append(candidate.serp_reason)
    if candidate.operator_note:
        reason_parts.append(f"operator_note: {candidate.operator_note}")
    return recommendation, "；".join(reason_parts)


def fetch_candidates(d1: D1Client, *, limit: int, source: str | None, keyword: str | None) -> list[PromotableCandidate]:
    where = [
        "c.status = 'serp_pass'",
        "c.trend_ratio IS NOT NULL",
        "c.trend_slope IS NOT NULL",
        "c.serp_organic IS NOT NULL",
        "c.serp_game_relevance > 0",
    ]
    params: list[object] = []
    if source:
        where.append("c.source_id = ?")
        params.append(source)
    if keyword:
        where.append("LOWER(c.keyword) = LOWER(?)")
        params.append(keyword)

    sql = f"""
        SELECT c.id, c.keyword, c.source_id,
               c.trend_ratio, c.trend_slope, c.trend_verdict, c.trend_series, c.trend_reason,
               c.serp_organic, c.serp_auth, c.serp_featured, c.serp_game_relevance, c.serp_reason,
               c.operator_note
        FROM game_radar_candidates c
        JOIN game_radar_sources s ON s.id = c.source_id
        WHERE {" AND ".join(where)}
        ORDER BY c.trend_ratio DESC, s.quality_tier ASC, c.updated_at DESC
        LIMIT ?
    """
    params.append(limit)
    rows = d1.query(sql, params)
    return [
        PromotableCandidate(
            id=str(row["id"]),
            keyword=str(row["keyword"]),
            source_id=str(row["source_id"]),
            trend_ratio=parse_float(row.get("trend_ratio")),
            trend_slope=parse_float(row.get("trend_slope")),
            trend_verdict=str(row.get("trend_verdict") or "unknown"),
            trend_series=row.get("trend_series"),
            serp_organic=parse_int(row.get("serp_organic")),
            serp_auth=parse_int(row.get("serp_auth")),
            serp_featured=parse_int(row.get("serp_featured")),
            serp_game_relevance=parse_int(row.get("serp_game_relevance")),
            trend_reason=row.get("trend_reason"),
            serp_reason=row.get("serp_reason"),
            operator_note=row.get("operator_note"),
        )
        for row in rows
    ]


def promote_candidate(d1: D1Client, candidate: PromotableCandidate) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    recommendation, reason = recommendation_for(candidate)
    trend_series = candidate.trend_series
    if trend_series:
        try:
            json.loads(trend_series)
        except (TypeError, json.JSONDecodeError):
            trend_series = None

    d1.query(
        """
        INSERT INTO game_keyword_pipeline
            (keyword, source_site, trend_ratio, trend_slope, trend_verdict,
             trend_checked_at, status, serp_organic, serp_auth, serp_featured,
             recommendation, reason, trend_series)
        VALUES (?, ?, ?, ?, ?, ?, 'recommended', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(keyword) DO UPDATE SET
            source_site = excluded.source_site,
            trend_ratio = excluded.trend_ratio,
            trend_slope = excluded.trend_slope,
            trend_verdict = excluded.trend_verdict,
            trend_checked_at = excluded.trend_checked_at,
            status = excluded.status,
            serp_organic = excluded.serp_organic,
            serp_auth = excluded.serp_auth,
            serp_featured = excluded.serp_featured,
            recommendation = excluded.recommendation,
            reason = excluded.reason,
            trend_series = excluded.trend_series
        """,
        [
            candidate.keyword,
            candidate.source_id,
            candidate.trend_ratio,
            candidate.trend_slope,
            candidate.trend_verdict,
            now,
            candidate.serp_organic,
            candidate.serp_auth,
            candidate.serp_featured,
            recommendation,
            reason,
            trend_series,
        ],
    )
    d1.query(
        """
        UPDATE game_radar_candidates
        SET status = 'promoted',
            reject_reason = NULL,
            updated_at = ?
        WHERE id = ?
        """,
        [now, candidate.id],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Promote validated Game Radar candidates")
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--source", help="Filter by source_id")
    parser.add_argument("--keyword", help="Promote one exact keyword")
    parser.add_argument("--write", action="store_true", help="Write promotion. Omit for dry-run.")
    args = parser.parse_args()

    load_env()
    d1 = D1Client()
    candidates = fetch_candidates(d1, limit=max(1, args.limit), source=args.source, keyword=args.keyword)
    print(f"Game Radar Promote - candidates={len(candidates)} write={args.write}")
    for candidate in candidates:
        recommendation, reason = recommendation_for(candidate)
        print(f"- {candidate.keyword} [{candidate.source_id}] -> {recommendation} | {reason}")
        if args.write:
            promote_candidate(d1, candidate)
    if not args.write:
        print("dry-run: pass --write to promote")


if __name__ == "__main__":
    main()
