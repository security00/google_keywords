#!/usr/bin/env python3
"""Trend validation for admin-only Game Radar candidates.

This script validates newly found game candidates against the existing Trends
API, then writes the result back to game_radar_candidates. It does not promote
anything to game_keyword_pipeline and should only be run from admin/cron.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone

try:
    from scripts.game_suggest_radar import D1Client
except ModuleNotFoundError:
    from game_suggest_radar import D1Client


DEFAULT_API_URL = "https://discoverkeywords.co"
DEFAULT_DAYS = 14
DEFAULT_BENCHMARK = "gpts"
POLL_INTERVAL_SECONDS = 5
MIN_RATIO = 0.3
MIN_SLOPE = 0.0
PASS_VERDICTS = {"strong", "pass", "close", "watch"}


@dataclass(frozen=True)
class RadarCandidate:
    id: str
    keyword: str
    source_id: str
    status: str


@dataclass(frozen=True)
class TrendDecision:
    status: str
    ratio: float
    slope: float
    verdict: str
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


def parse_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def classify_trend_result(result: dict, *, min_ratio: float = MIN_RATIO, min_slope: float = MIN_SLOPE) -> TrendDecision:
    ratio = parse_float(result.get("ratioMean", result.get("ratio", 0)))
    slope = parse_float(result.get("slopeRatio", 0))
    verdict = str(result.get("verdict") or "unknown")
    has_traffic = ratio >= min_ratio
    has_shape = slope >= min_slope or verdict in PASS_VERDICTS

    if has_traffic and has_shape:
        return TrendDecision(
            status="trend_pass",
            ratio=ratio,
            slope=slope,
            verdict=verdict,
            reason=f"trend_signal_ok: ratio={ratio:.2f}, slope={slope:.2f}, verdict={verdict}",
            reject_reason=None,
        )

    return TrendDecision(
        status="trend_fail",
        ratio=ratio,
        slope=slope,
        verdict=verdict,
        reason=f"low_trend_signal: ratio={ratio:.2f}, slope={slope:.2f}, verdict={verdict}",
        reject_reason="low_trend_signal",
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
        ORDER BY s.quality_tier ASC, c.created_at DESC
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


def request_json(url: str, *, api_key: str, method: str = "GET", payload: dict | None = None, timeout: int = 20) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "curl/8.5.0",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}: {exc.read().decode(errors='ignore')[:400]}") from exc


def call_trends_api(api_url: str, api_key: str, keywords: list[str], *, days: int, benchmark: str, max_wait: int) -> list[dict]:
    submit_url = api_url.rstrip("/") + "/api/research/trends"
    response = request_json(
        submit_url,
        api_key=api_key,
        method="POST",
        payload={"keywords": keywords, "days": days, "benchmark": benchmark},
    )
    if response.get("results") is not None:
        return list(response.get("results") or [])

    job_id = response.get("jobId")
    if not job_id:
        raise RuntimeError(f"Trends response missing jobId: {json.dumps(response)[:300]}")

    deadline = time.time() + max_wait
    status_url = api_url.rstrip("/") + f"/api/research/trends/status?jobId={urllib.parse.quote(str(job_id))}"
    print(f"  trends job {job_id}", flush=True)
    while time.time() < deadline:
        status = request_json(status_url, api_key=api_key, timeout=20)
        print(f"  trends status {status.get('status', 'unknown')}", flush=True)
        if status.get("status") == "complete" or status.get("results") is not None:
            return list(status.get("results") or [])
        if status.get("status") == "failed":
            raise RuntimeError(f"Trends job failed: {status.get('error', 'unknown')}")
        time.sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError(f"Trends job timed out after {max_wait}s")


def update_candidate(d1: D1Client, candidate_id: str, decision: TrendDecision, series: dict | None) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    d1.query(
        """
        UPDATE game_radar_candidates
        SET status = ?,
            reject_reason = ?,
            trend_ratio = ?,
            trend_slope = ?,
            trend_verdict = ?,
            trend_checked_at = ?,
            trend_reason = ?,
            trend_series = ?,
            updated_at = ?
        WHERE id = ?
        """,
        [
            decision.status,
            decision.reject_reason,
            decision.ratio,
            decision.slope,
            decision.verdict,
            now,
            decision.reason,
            json.dumps(series, ensure_ascii=False) if series is not None else None,
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
    days: int,
    benchmark: str,
    max_wait: int,
    min_ratio: float,
    min_slope: float,
    dry_run: bool,
) -> dict[str, int]:
    totals = {"checked": 0, "passed": 0, "failed": 0}
    by_keyword = {item.keyword.lower(): item for item in candidates}

    for start in range(0, len(candidates), batch_size):
        batch = candidates[start:start + batch_size]
        keywords = [item.keyword for item in batch]
        print(f"batch {start // batch_size + 1}: {keywords}", flush=True)
        results = call_trends_api(api_url, api_key, keywords, days=days, benchmark=benchmark, max_wait=max_wait)

        for result in results:
            keyword = str(result.get("keyword") or "").lower()
            candidate = by_keyword.get(keyword)
            if not candidate:
                continue
            decision = classify_trend_result(result, min_ratio=min_ratio, min_slope=min_slope)
            totals["checked"] += 1
            totals["passed" if decision.status == "trend_pass" else "failed"] += 1
            print(
                f"  {candidate.keyword}: {decision.status} ratio={decision.ratio:.2f} slope={decision.slope:.2f} verdict={decision.verdict}",
                flush=True,
            )
            if not dry_run:
                update_candidate(d1, candidate.id, decision, result.get("series"))

    return totals


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate Game Radar candidates with Trends")
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--source", help="Filter by source_id")
    parser.add_argument("--status", action="append", default=[], help="Candidate status to validate; repeatable")
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
    parser.add_argument("--benchmark", default=DEFAULT_BENCHMARK)
    parser.add_argument("--min-ratio", type=float, default=MIN_RATIO)
    parser.add_argument("--min-slope", type=float, default=MIN_SLOPE)
    parser.add_argument("--max-wait", type=int, default=180)
    parser.add_argument("--write", action="store_true", help="Write trend verdicts to D1. Omit for dry-run.")
    args = parser.parse_args()

    load_env()
    api_url = os.environ.get("GK_API_URL", DEFAULT_API_URL)
    api_key = os.environ.get("GK_API_KEY", "")
    if not api_key:
        raise RuntimeError("GK_API_KEY env var required")

    d1 = D1Client()
    statuses = args.status or ["approved", "new"]
    candidates = fetch_candidates(d1, limit=args.limit, source=args.source, status=statuses)
    print(
        f"Game Radar Trends - candidates={len(candidates)} statuses={statuses} source={args.source or 'all'} write={args.write}",
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
        days=args.days,
        benchmark=args.benchmark,
        max_wait=args.max_wait,
        min_ratio=args.min_ratio,
        min_slope=args.min_slope,
        dry_run=not args.write,
    )
    print(json.dumps(totals, ensure_ascii=False, indent=2), flush=True)
    if not args.write:
        print("dry-run: pass --write to save trend verdicts", flush=True)


if __name__ == "__main__":
    main()
