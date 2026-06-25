#!/usr/bin/env python3
"""Run the Game Radar automation loop and record per-source funnel snapshots.

The pipeline is conservative: raw radar candidates still need Trends, SERP game
relevance, and promotion gates before they can appear in the student endpoint.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

try:
    from scripts.game_suggest_radar import D1Client
    from scripts.game_radar_trends import load_env
except ModuleNotFoundError:
    from game_suggest_radar import D1Client
    from game_radar_trends import load_env


DEFAULT_RELEASE_SOURCES = ["steam-new", "steam-topsellers", "roblox-search", "itchio-new", "itchio-new-free"]


@dataclass(frozen=True)
class FunnelSnapshot:
    source_id: str
    discovered_count: int
    trend_checked_count: int
    trend_pass_count: int
    trend_fail_count: int
    serp_checked_count: int
    serp_pass_count: int
    serp_fail_count: int
    promoted_count: int
    student_visible_count: int


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_sources(values: list[str]) -> list[str]:
    sources: list[str] = []
    for value in values:
        sources.extend(part.strip() for part in value.split(",") if part.strip())
    return sources or DEFAULT_RELEASE_SOURCES


def run_step(label: str, args: list[str], *, dry_run: bool) -> None:
    command = [sys.executable, *args]
    if dry_run:
        print(f"dry-run step {label}: {' '.join(command)}", flush=True)
        return
    print(f"step {label}: {' '.join(command)}", flush=True)
    subprocess.run(command, check=True)


def fetch_funnel_snapshot(d1: D1Client, source_id: str, run_started_at: str) -> FunnelSnapshot:
    rows = d1.query(
        """
        SELECT
          SUM(CASE WHEN c.created_at >= ? THEN 1 ELSE 0 END) AS discovered_count,
          SUM(CASE WHEN c.trend_checked_at >= ? THEN 1 ELSE 0 END) AS trend_checked_count,
          SUM(CASE WHEN c.trend_checked_at >= ? AND c.status IN ('trend_pass', 'approved', 'serp_pass', 'promoted') THEN 1 ELSE 0 END) AS trend_pass_count,
          SUM(CASE WHEN c.trend_checked_at >= ? AND c.status = 'trend_fail' THEN 1 ELSE 0 END) AS trend_fail_count,
          SUM(CASE WHEN c.serp_checked_at >= ? THEN 1 ELSE 0 END) AS serp_checked_count,
          SUM(CASE WHEN c.serp_checked_at >= ? AND c.status IN ('serp_pass', 'promoted') THEN 1 ELSE 0 END) AS serp_pass_count,
          SUM(CASE WHEN c.serp_checked_at >= ? AND c.status = 'serp_fail' THEN 1 ELSE 0 END) AS serp_fail_count,
          SUM(CASE WHEN c.updated_at >= ? AND c.status = 'promoted' THEN 1 ELSE 0 END) AS promoted_count
        FROM game_radar_candidates c
        WHERE c.source_id = ?
        """,
        [
            run_started_at,
            run_started_at,
            run_started_at,
            run_started_at,
            run_started_at,
            run_started_at,
            run_started_at,
            run_started_at,
            source_id,
        ],
    )
    row = rows[0] if rows else {}
    visible_rows = d1.query(
        """
        SELECT COUNT(*) AS count
        FROM game_keyword_pipeline
        WHERE source_site = ?
          AND status = 'recommended'
          AND recommendation IS NOT NULL
          AND recommendation != '⏭️ skip'
          AND serp_organic > 0
        """,
        [source_id],
    )
    return FunnelSnapshot(
        source_id=source_id,
        discovered_count=int(row.get("discovered_count") or 0),
        trend_checked_count=int(row.get("trend_checked_count") or 0),
        trend_pass_count=int(row.get("trend_pass_count") or 0),
        trend_fail_count=int(row.get("trend_fail_count") or 0),
        serp_checked_count=int(row.get("serp_checked_count") or 0),
        serp_pass_count=int(row.get("serp_pass_count") or 0),
        serp_fail_count=int(row.get("serp_fail_count") or 0),
        promoted_count=int(row.get("promoted_count") or 0),
        student_visible_count=int((visible_rows[0] if visible_rows else {}).get("count") or 0),
    )


def record_funnel_snapshot(
    d1: D1Client,
    snapshot: FunnelSnapshot,
    *,
    run_id: str,
    run_started_at: str,
    run_completed_at: str,
    status: str,
    error: str | None,
) -> None:
    d1.query(
        """
        INSERT INTO game_radar_source_funnel_runs
          (id, source_id, run_started_at, run_completed_at, status,
           discovered_count, trend_checked_count, trend_pass_count, trend_fail_count,
           serp_checked_count, serp_pass_count, serp_fail_count, promoted_count,
           student_visible_count, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            f"{run_id}:{snapshot.source_id}",
            snapshot.source_id,
            run_started_at,
            run_completed_at,
            status,
            snapshot.discovered_count,
            snapshot.trend_checked_count,
            snapshot.trend_pass_count,
            snapshot.trend_fail_count,
            snapshot.serp_checked_count,
            snapshot.serp_pass_count,
            snapshot.serp_fail_count,
            snapshot.promoted_count,
            snapshot.student_visible_count,
            error,
        ],
    )


def record_all_sources(
    d1: D1Client,
    sources: list[str],
    *,
    run_id: str,
    run_started_at: str,
    status: str,
    error: str | None = None,
) -> list[FunnelSnapshot]:
    completed_at = utc_now()
    snapshots = [fetch_funnel_snapshot(d1, source, run_started_at) for source in sources]
    for snapshot in snapshots:
        record_funnel_snapshot(
            d1,
            snapshot,
            run_id=run_id,
            run_started_at=run_started_at,
            run_completed_at=completed_at,
            status=status,
            error=error,
        )
    return snapshots


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Game Radar discovery, validation, promotion, and source funnel logging")
    parser.add_argument("--source", action="append", default=[], help="Release source to scan; repeatable or comma-separated")
    parser.add_argument("--release-limit", type=int, default=80)
    parser.add_argument("--trend-limit", type=int, default=25)
    parser.add_argument("--serp-limit", type=int, default=15)
    parser.add_argument("--promote-limit", type=int, default=10)
    parser.add_argument("--write", action="store_true", help="Execute writes. Omit for dry-run.")
    args = parser.parse_args()

    load_env()
    sources = parse_sources(args.source)
    run_id = str(uuid.uuid4())
    run_started_at = utc_now()
    print(f"Game Radar Pipeline - run_id={run_id} sources={sources} write={args.write}", flush=True)

    d1 = D1Client()
    try:
        release_args = ["scripts/game_release_radar.py", "--limit", str(args.release_limit)]
        for source in sources:
            release_args.extend(["--source", source])
        if args.write:
            release_args.append("--write")
        run_step("release-radar", release_args, dry_run=not args.write)

        for source in sources:
            trends_args = [
                "scripts/game_radar_trends.py",
                "--source",
                source,
                "--status",
                "new",
                "--limit",
                str(args.trend_limit),
            ]
            if args.write:
                trends_args.append("--write")
            run_step(f"trends:{source}", trends_args, dry_run=not args.write)

        for source in sources:
            serp_args = [
                "scripts/game_radar_serp.py",
                "--source",
                source,
                "--status",
                "trend_pass",
                "--limit",
                str(args.serp_limit),
            ]
            if args.write:
                serp_args.append("--write")
            run_step(f"serp:{source}", serp_args, dry_run=not args.write)

        for source in sources:
            promote_args = ["scripts/game_radar_promote.py", "--source", source, "--limit", str(args.promote_limit)]
            if args.write:
                promote_args.append("--write")
            run_step(f"promote:{source}", promote_args, dry_run=not args.write)

        if not args.write:
            print("dry-run: pass --write to execute and record funnel snapshots", flush=True)
            return

        snapshots = record_all_sources(d1, sources, run_id=run_id, run_started_at=run_started_at, status="ok")
        print(json.dumps([snapshot.__dict__ for snapshot in snapshots], ensure_ascii=False, indent=2), flush=True)
    except Exception as exc:
        if args.write:
            try:
                record_all_sources(
                    d1,
                    sources,
                    run_id=run_id,
                    run_started_at=run_started_at,
                    status="error",
                    error=str(exc)[:500],
                )
            except Exception as record_exc:
                print(f"failed to record funnel error snapshot: {record_exc}", flush=True)
        raise


if __name__ == "__main__":
    main()
