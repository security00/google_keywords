#!/usr/bin/env python3
"""Replay an existing expand job without creating new DataForSEO tasks."""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import urllib.error
import urllib.request


DEFAULT_SITE_URL = "https://www.discoverkeywords.co"
DEFAULT_ACCOUNT_ID = "faae494a756090f5f9c0ad7b8d1ddb88"
DEFAULT_DATABASE_ID = "b40de8a4-75e1-4df6-a84d-3ecd62b70538"


def env(name: str, fallback: str | None = None) -> str:
    value = os.getenv(name) or fallback
    if not value:
        raise SystemExit(f"missing required env: {name}")
    return value


def d1_query(account_id: str, database_id: str, token: str, sql: str, params=None):
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{account_id}/d1/database/{database_id}/query"
    )
    body = json.dumps({"sql": sql, "params": params or []}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("success"):
        raise RuntimeError(json.dumps(payload, ensure_ascii=False))
    return payload


def fetch_status(site_url: str, job_id: str, api_key: str, timeout: int):
    url = f"{site_url.rstrip('/')}/api/research/expand/status?jobId={job_id}"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; keyword-research-replay/1.0)",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw)
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"error": raw}
        return error.code, payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job_id")
    parser.add_argument("--site-url", default=os.getenv("GK_SITE_URL", DEFAULT_SITE_URL))
    parser.add_argument("--timeout", type=int, default=int(os.getenv("REPLAY_TIMEOUT", "240")))
    parser.add_argument("--user-id", default=os.getenv("REPLAY_USER_ID"))
    args = parser.parse_args()

    token = env("CLOUDFLARE_API_TOKEN")
    account_id = env("CLOUDFLARE_ACCOUNT_ID", DEFAULT_ACCOUNT_ID)
    database_id = env("D1_DATABASE_ID", DEFAULT_DATABASE_ID)

    job_rows = d1_query(
        account_id,
        database_id,
        token,
        "SELECT user_id, json_array_length(task_ids) AS task_count FROM research_jobs WHERE id = ? LIMIT 1",
        [args.job_id],
    )["result"][0]["results"]
    if not job_rows:
        raise SystemExit(f"job not found: {args.job_id}")

    user_id = args.user_id or job_rows[0]["user_id"]
    task_count = job_rows[0]["task_count"]
    api_key = "gk_live_" + secrets.token_hex(16)

    print(f"replay job={args.job_id} user={user_id} tasks={task_count}", file=sys.stderr)
    try:
        d1_query(
            account_id,
            database_id,
            token,
            "UPDATE research_jobs SET status = 'pending', error = NULL, session_id = NULL, updated_at = datetime('now') WHERE id = ?",
            [args.job_id],
        )
        d1_query(
            account_id,
            database_id,
            token,
            "INSERT INTO api_keys (key, user_id, name, expires_at, active) VALUES (?, ?, 'codex-replay', datetime('now', '+1 hour'), 1)",
            [api_key, user_id],
        )
        status_code, payload = fetch_status(args.site_url, args.job_id, api_key, args.timeout)
        print(json.dumps({"httpStatus": status_code, "payload": payload}, ensure_ascii=False))
        return 0 if status_code < 500 else 1
    finally:
        d1_query(
            account_id,
            database_id,
            token,
            "DELETE FROM api_keys WHERE key = ? OR name = 'codex-replay'",
            [api_key],
        )


if __name__ == "__main__":
    raise SystemExit(main())
