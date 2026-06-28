#!/usr/bin/env python3
"""Read-only review helper for signal_candidates.

Shows pending candidates and rejected reason stats without writing to D1.
This is an admin/backoffice aid; it does not affect student recommendations.
"""

import argparse
import json
import os
import ssl
import sys
import urllib.request


VALID_STATUSES = {"all", "pending", "accepted", "rejected"}


def status_clause(status: str) -> tuple[str, list[str]]:
    if status not in VALID_STATUSES:
        raise ValueError(f"status must be one of: {', '.join(sorted(VALID_STATUSES))}")
    if status == "all":
        return "", []
    if status == "pending":
        return "WHERE accepted IS NULL OR accepted = 'pending'", []
    return "WHERE accepted LIKE ?", [f"{status}:%"]


def source_labels(signal_sources: str) -> str:
    try:
        payload = json.loads(signal_sources or "{}")
    except json.JSONDecodeError:
        return "-"

    evidence = payload.get("evidence")
    if isinstance(evidence, list):
        labels = [
            str(item.get("source_label", "")).strip()
            for item in evidence
            if isinstance(item, dict) and item.get("source_label")
        ]
        return ", ".join(sorted(set(labels))) or "-"

    if isinstance(payload, dict):
        return ", ".join(sorted(payload.keys())) or "-"

    return "-"


def d1_query(sql: str, params: list | None = None) -> list[dict]:
    cf_token = os.environ.get("CF_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN")
    cf_account = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    d1_id = os.environ.get("D1_DB_ID", "")

    if not (cf_token and cf_account and d1_id):
        raise RuntimeError("CF_API_TOKEN, CF_ACCOUNT_ID, and D1_DB_ID are required")

    url = f"https://api.cloudflare.com/client/v4/accounts/{cf_account}/d1/database/{d1_id}/query"
    payload = json.dumps({"sql": sql, "params": params or []}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {cf_token}",
            "Content-Type": "application/json",
        },
    )
    ctx = ssl.create_default_context()
    resp = json.loads(urllib.request.urlopen(req, context=ctx, timeout=30).read())
    if not resp.get("success"):
        raise RuntimeError(f"D1 query failed: {resp}")
    return resp["result"][0].get("results", [])


def print_status_summary() -> None:
    rows = d1_query(
        """SELECT COALESCE(accepted, 'pending') AS status, COUNT(*) AS count
           FROM signal_candidates
           GROUP BY COALESCE(accepted, 'pending')
           ORDER BY count DESC"""
    )
    print("Status summary")
    for row in rows:
        print(f"- {row['status']}: {row['count']}")


def print_rejected_reasons() -> None:
    rows = d1_query(
        """SELECT accepted AS reason, COUNT(*) AS count
           FROM signal_candidates
           WHERE accepted LIKE 'rejected:%'
           GROUP BY accepted
           ORDER BY count DESC"""
    )
    print("\nRejected reasons")
    for row in rows:
        print(f"- {row['reason']}: {row['count']}")


def print_queue(status: str, limit: int) -> None:
    clause, params = status_clause(status)
    rows = d1_query(
        f"""SELECT keyword, signal_score, avg_hotness, accepted, created_at, signal_sources
            FROM signal_candidates
            {clause}
            ORDER BY signal_score DESC, created_at DESC
            LIMIT ?""",
        params + [limit],
    )
    print(f"\nSignal review queue ({status}, top {limit})")
    for idx, row in enumerate(rows, 1):
        accepted = row.get("accepted") or "pending"
        labels = source_labels(row.get("signal_sources") or "{}")
        print(
            f"{idx}. {row['keyword']} | score={row['signal_score']:.1f} | "
            f"status={accepted} | sources={labels}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only signal review queue")
    parser.add_argument("--status", choices=sorted(VALID_STATUSES), default="pending")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--reasons", action="store_true", help="Show rejected reason counts")
    args = parser.parse_args()

    try:
        print_status_summary()
        if args.reasons:
            print_rejected_reasons()
        print_queue(args.status, args.limit)
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

