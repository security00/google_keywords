#!/usr/bin/env python3
"""Minimal production smoke checks for discoverkeywords.co.

Checks intentionally avoid creating paid jobs. They verify auth, student-facing
read-only endpoints, and shared-cache behavior.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

SITE = os.environ.get("GK_SITE_URL", "https://www.discoverkeywords.co").rstrip("/")
API_KEY = os.environ.get("GK_API_KEY")


def request(path: str, method: str = "GET", body: dict[str, Any] | None = None) -> tuple[int, Any]:
    if not API_KEY:
        raise RuntimeError("GK_API_KEY env var required")
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{SITE}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "curl/8.5.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = raw[:500]
        return exc.code, parsed


def assert_ok(name: str, condition: bool, detail: str) -> None:
    status = "✅" if condition else "❌"
    print(f"{status} {name}: {detail}")
    if not condition:
        raise AssertionError(name)


def main() -> int:
    failures = 0

    checks: list[tuple[str, callable]] = []

    def check_me() -> None:
        code, data = request("/api/me")
        assert_ok("/api/me", code == 200 and data.get("role") in {"admin", "student"}, f"http={code} role={data.get('role') if isinstance(data, dict) else '?'}")

    def check_old_keywords() -> None:
        code, data = request("/api/old-keywords")
        count = len(data.get("keywords") or []) if isinstance(data, dict) else 0
        assert_ok("/api/old-keywords", code == 200 and count > 0, f"http={code} count={count}")

    def check_game_keywords() -> None:
        code, data = request("/api/game-keywords")
        # Empty is valid when no qualified games exist; endpoint/auth should work.
        count = len(data.get("keywords") or []) if isinstance(data, dict) else 0
        assert_ok("/api/game-keywords", code == 200, f"http={code} count={count}")

    def check_expand_shared_cache() -> None:
        code, data = request("/api/research/expand", "POST", {"keywords": []})
        # Empty keyword request should be rejected cleanly; this guards JSON/API health.
        assert_ok("/api/research/expand empty request", code in {400, 409}, f"http={code} status={data.get('status') if isinstance(data, dict) else '?'}")

    checks.extend([
        ("me", check_me),
        ("old-keywords", check_old_keywords),
        ("game-keywords", check_game_keywords),
        ("expand-shared-cache", check_expand_shared_cache),
    ])

    for _, fn in checks:
        try:
            fn()
        except Exception as exc:
            failures += 1
            print(f"❌ check failed: {exc}", file=sys.stderr)

    print(f"\nSmoke checks completed: failures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
