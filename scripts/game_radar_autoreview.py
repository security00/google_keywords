#!/usr/bin/env python3
"""Auto-approve high-confidence Game Radar trend_pass candidates.

This is intentionally conservative. It learns from source-level historical
outcomes, then only moves candidates from trend_pass to approved when the
source has enough successful validated examples. It never promotes directly to
game_keyword_pipeline; SERP and promotion remain separate gates.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone

try:
    from scripts.game_suggest_radar import D1Client
    from scripts.game_radar_trends import load_env
except ModuleNotFoundError:
    from game_suggest_radar import D1Client
    from game_radar_trends import load_env


DEFAULT_MIN_DECISIONS = 5
DEFAULT_MIN_SUCCESS_RATE = 0.7
DEFAULT_MAX_PRECHECK_RATE = 0.1
DEFAULT_MIN_TREND_RATIO = 0.3
DEFAULT_MIN_TREND_SLOPE = 0.0


@dataclass(frozen=True)
class SourceLearningStats:
    source_id: str
    source_name: str
    positive_count: int
    negative_count: int
    precheck_count: int
    success_rate: float
    precheck_rate: float

    @property
    def decisions(self) -> int:
        return self.positive_count + self.negative_count


@dataclass(frozen=True)
class AutoReviewCandidate:
    id: str
    keyword: str
    source_id: str
    trend_ratio: float
    trend_slope: float
    trend_verdict: str


@dataclass(frozen=True)
class AutoReviewDecision:
    candidate: AutoReviewCandidate
    should_approve: bool
    reason: str


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


def build_source_stats(row: dict) -> SourceLearningStats:
    positive = parse_int(row.get("positive_count"))
    negative = parse_int(row.get("negative_count"))
    precheck = parse_int(row.get("precheck_count"))
    decisions = positive + negative
    total = decisions + precheck
    return SourceLearningStats(
        source_id=str(row.get("source_id") or "unknown"),
        source_name=str(row.get("source_name") or row.get("source_id") or "unknown"),
        positive_count=positive,
        negative_count=negative,
        precheck_count=precheck,
        success_rate=positive / decisions if decisions else 0.0,
        precheck_rate=precheck / total if total else 0.0,
    )


def fetch_source_stats(d1: D1Client) -> dict[str, SourceLearningStats]:
    rows = d1.query(
        """
        SELECT
          s.id AS source_id,
          s.name AS source_name,
          SUM(CASE WHEN c.status IN ('serp_pass', 'promoted') THEN 1 ELSE 0 END) AS positive_count,
          SUM(CASE WHEN c.status IN ('rejected', 'serp_fail') THEN 1 ELSE 0 END) AS negative_count,
          SUM(CASE WHEN c.reject_reason = 'not_game_name_precheck' THEN 1 ELSE 0 END) AS precheck_count
        FROM game_radar_sources s
        LEFT JOIN game_radar_candidates c ON c.source_id = s.id
        GROUP BY s.id, s.name
        """
    )
    return {stats.source_id: stats for stats in (build_source_stats(row) for row in rows)}


def fetch_candidates(d1: D1Client, *, limit: int, source: str | None) -> list[AutoReviewCandidate]:
    where = ["c.status = 'trend_pass'"]
    params: list[object] = []
    if source:
        where.append("c.source_id = ?")
        params.append(source)
    sql = f"""
        SELECT c.id, c.keyword, c.source_id, c.trend_ratio, c.trend_slope, c.trend_verdict
        FROM game_radar_candidates c
        JOIN game_radar_sources s ON s.id = c.source_id
        WHERE {" AND ".join(where)}
        ORDER BY s.quality_tier ASC, c.trend_ratio DESC, c.updated_at DESC, c.created_at DESC
        LIMIT ?
    """
    params.append(limit)
    rows = d1.query(sql, params)
    return [
        AutoReviewCandidate(
            id=str(row["id"]),
            keyword=str(row["keyword"]),
            source_id=str(row["source_id"]),
            trend_ratio=parse_float(row.get("trend_ratio")),
            trend_slope=parse_float(row.get("trend_slope")),
            trend_verdict=str(row.get("trend_verdict") or "unknown"),
        )
        for row in rows
    ]


def evaluate_candidate(
    candidate: AutoReviewCandidate,
    stats: SourceLearningStats | None,
    *,
    min_decisions: int = DEFAULT_MIN_DECISIONS,
    min_success_rate: float = DEFAULT_MIN_SUCCESS_RATE,
    max_precheck_rate: float = DEFAULT_MAX_PRECHECK_RATE,
    min_trend_ratio: float = DEFAULT_MIN_TREND_RATIO,
    min_trend_slope: float = DEFAULT_MIN_TREND_SLOPE,
) -> AutoReviewDecision:
    if stats is None:
        return AutoReviewDecision(candidate, False, "source_learning_missing")
    if stats.decisions < min_decisions:
        return AutoReviewDecision(
            candidate,
            False,
            f"insufficient_source_history: decisions={stats.decisions}, required={min_decisions}",
        )
    if stats.success_rate < min_success_rate:
        return AutoReviewDecision(
            candidate,
            False,
            f"source_success_rate_low: rate={stats.success_rate:.2f}, required={min_success_rate:.2f}",
        )
    if stats.precheck_rate > max_precheck_rate:
        return AutoReviewDecision(
            candidate,
            False,
            f"source_precheck_rate_high: rate={stats.precheck_rate:.2f}, max={max_precheck_rate:.2f}",
        )
    if candidate.trend_ratio < min_trend_ratio:
        return AutoReviewDecision(
            candidate,
            False,
            f"trend_ratio_low: ratio={candidate.trend_ratio:.2f}, required={min_trend_ratio:.2f}",
        )
    if candidate.trend_slope < min_trend_slope:
        return AutoReviewDecision(
            candidate,
            False,
            f"trend_slope_low: slope={candidate.trend_slope:.2f}, required={min_trend_slope:.2f}",
        )
    return AutoReviewDecision(
        candidate,
        True,
        (
            "auto_approved_by_source_learning: "
            f"decisions={stats.decisions}, success_rate={stats.success_rate:.2f}, "
            f"precheck_rate={stats.precheck_rate:.2f}, ratio={candidate.trend_ratio:.2f}, "
            f"slope={candidate.trend_slope:.2f}"
        ),
    )


def approve_candidate(d1: D1Client, decision: AutoReviewDecision) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    note = decision.reason
    d1.query(
        """
        UPDATE game_radar_candidates
        SET status = 'approved',
            reject_reason = NULL,
            operator_note = CASE
              WHEN operator_note IS NULL OR operator_note = '' THEN ?
              ELSE operator_note || ' | ' || ?
            END,
            updated_at = ?
        WHERE id = ?
        """,
        [note, note, now, decision.candidate.id],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto-review high-confidence Game Radar trend_pass candidates")
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--source", help="Filter by source_id")
    parser.add_argument("--min-decisions", type=int, default=DEFAULT_MIN_DECISIONS)
    parser.add_argument("--min-success-rate", type=float, default=DEFAULT_MIN_SUCCESS_RATE)
    parser.add_argument("--max-precheck-rate", type=float, default=DEFAULT_MAX_PRECHECK_RATE)
    parser.add_argument("--min-trend-ratio", type=float, default=DEFAULT_MIN_TREND_RATIO)
    parser.add_argument("--min-trend-slope", type=float, default=DEFAULT_MIN_TREND_SLOPE)
    parser.add_argument("--write", action="store_true", help="Write approvals. Omit for dry-run.")
    args = parser.parse_args()

    load_env()
    d1 = D1Client()
    stats_by_source = fetch_source_stats(d1)
    candidates = fetch_candidates(d1, limit=max(1, args.limit), source=args.source)
    print(f"Game Radar AutoReview - candidates={len(candidates)} write={args.write}", flush=True)
    approved = 0
    skipped = 0
    for candidate in candidates:
        stats = stats_by_source.get(candidate.source_id)
        decision = evaluate_candidate(
            candidate,
            stats,
            min_decisions=args.min_decisions,
            min_success_rate=args.min_success_rate,
            max_precheck_rate=args.max_precheck_rate,
            min_trend_ratio=args.min_trend_ratio,
            min_trend_slope=args.min_trend_slope,
        )
        action = "approve" if decision.should_approve else "skip"
        print(f"- {candidate.keyword} [{candidate.source_id}] {action}: {decision.reason}", flush=True)
        if decision.should_approve:
            approved += 1
            if args.write:
                approve_candidate(d1, decision)
        else:
            skipped += 1
    print(f"summary: approved={approved} skipped={skipped}", flush=True)
    if not args.write:
        print("dry-run: pass --write to approve eligible candidates", flush=True)


if __name__ == "__main__":
    main()
