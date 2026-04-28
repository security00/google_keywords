#!/usr/bin/env python3
"""Static guard checks for student API keys and paid provider calls.

This intentionally does not call production APIs. A live cache-miss test would
be dangerous because the regression we want to catch could itself create paid
DataForSEO tasks.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def assert_contains(path: str, needle: str) -> None:
    text = read(path)
    if needle not in text:
        raise AssertionError(f"{path}: missing {needle!r}")


def assert_order(path: str, before: str, after: str) -> None:
    text = read(path)
    before_index = text.find(before)
    after_index = text.find(after)
    if before_index < 0:
        raise AssertionError(f"{path}: missing guard {before!r}")
    if after_index < 0:
        raise AssertionError(f"{path}: missing paid call {after!r}")
    if before_index > after_index:
        raise AssertionError(f"{path}: guard {before!r} appears after paid call {after!r}")


def main() -> int:
    assert_contains(
        "lib/authz.ts",
        "return requireCronOrAdmin(request);",
    )

    assert_order(
        "app/api/research/expand/expand-job-service.ts",
        "if (!allowCreateSharedJob)",
        "const taskSubmission = await submitExpansionTasksWithCost",
    )
    assert_order(
        "app/api/research/compare/compare-job-service.ts",
        "if (!allowCreateSharedJob)",
        "const taskSubmission = await submitComparisonTasksWithCost",
    )
    assert_order(
        "app/api/research/serp/route.ts",
        "requirePaidApiPermission(request)",
        "const taskSubmission = await submitSerpTasksWithCost",
    )
    assert_order(
        "app/api/research/trends/route.ts",
        "requirePaidApiPermission(request)",
        "const taskSubmission = await submitComparisonTasksWithCost",
    )
    assert_order(
        "app/api/research/trends-quick/route.ts",
        "requirePaidApiPermission(request)",
        "fetch(`${DATAFORSEO_BASE}",
    )
    assert_order(
        "app/api/research/keyword-suggestions/route.ts",
        "requirePaidApiPermission(request)",
        "fetch(`${DATAFORSEO_BASE}",
    )
    assert_order(
        "app/api/research/compare/intent/route.ts",
        "if (!isCronAuthorized(request))",
        "const taskSubmission = await submitSerpTasksWithCost",
    )
    assert_order(
        "app/api/game-keywords/route.ts",
        "const access = await checkStudentAccess",
        "FROM game_keyword_pipeline",
    )
    assert_order(
        "app/api/old-keywords/route.ts",
        "const access = await checkStudentAccess",
        "FROM old_keyword_opportunities",
    )

    print("student access and paid API guards OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
