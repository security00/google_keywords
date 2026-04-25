#!/usr/bin/env python3
"""Small runtime guardrails for long-running pipeline scripts.

Provides:
- per-pipeline single-instance lock
- run_id generation
- structured start/end JSONL log records
- best-effort D1 pipeline_runs status writes

This module intentionally has no external dependencies.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DEFAULT_STATE_DIR = Path(os.environ.get("GK_PRECOMPUTE_STATE_DIR", "/root/.local/state/google_keywords"))
DEFAULT_D1_DATABASE_ID = "b40de8a4-75e1-4df6-a84d-3ecd62b70538"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_run_id(prefix: str) -> str:
    return f"{prefix}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{uuid.uuid4().hex[:8]}"


def _append_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def _d1_env() -> tuple[str, str, str] | None:
    account_id = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    api_token = os.environ.get("CF_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN")
    database_id = os.environ.get("D1_DATABASE_ID") or DEFAULT_D1_DATABASE_ID
    if not account_id or not api_token:
        return None
    return account_id, api_token, database_id


def _d1_execute(sql: str, params: list[object]) -> None:
    env = _d1_env()
    if not env:
        return
    account_id, api_token, database_id = env
    payload = json.dumps({"sql": sql, "params": params}).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        body = json.loads(response.read().decode("utf-8"))
    if not body.get("success"):
        raise RuntimeError(f"D1 pipeline_runs write failed: {body}")


def _record_pipeline_run(
    *,
    run_id: str,
    name: str,
    status: str,
    started_at_iso: str,
    completed_at_iso: str | None = None,
    duration_seconds: float | None = None,
    error: str | None = None,
    metadata: dict | None = None,
) -> None:
    try:
        _d1_execute(
            """
            INSERT INTO pipeline_runs
              (run_id, pipeline, status, started_at, completed_at, duration_seconds, error, metadata_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(run_id) DO UPDATE SET
              status = excluded.status,
              completed_at = excluded.completed_at,
              duration_seconds = excluded.duration_seconds,
              error = excluded.error,
              metadata_json = excluded.metadata_json,
              updated_at = datetime('now')
            """,
            [
                run_id,
                name,
                status,
                started_at_iso,
                completed_at_iso,
                duration_seconds,
                error,
                json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True),
            ],
        )
    except Exception as exc:
        # D1 run logging must never break the actual pipeline.
        print(f"⚠️ pipeline_runs D1 write skipped: {exc}", flush=True)


@contextmanager
def pipeline_run(
    name: str,
    *,
    state_dir: Path | None = None,
    stale_after_seconds: int = 6 * 60 * 60,
) -> Iterator[str]:
    """Guard a pipeline with a simple lock file and emit start/end records.

    The lock is intentionally conservative: if a recent lock exists, the second
    process exits fast. If a lock is stale, it is replaced.
    """

    root = state_dir or DEFAULT_STATE_DIR
    root.mkdir(parents=True, exist_ok=True)
    run_id = new_run_id(name)
    lock_path = root / f"{name}.lock"
    log_path = root / "pipeline_runs.jsonl"
    started_at = time.time()
    started_at_iso = _now_iso()

    if lock_path.exists():
        try:
            existing = json.loads(lock_path.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
        locked_at = float(existing.get("locked_at") or 0)
        age = time.time() - locked_at if locked_at else stale_after_seconds + 1
        if age < stale_after_seconds:
            raise RuntimeError(
                f"Pipeline {name} already running: run_id={existing.get('run_id', 'unknown')} age={int(age)}s"
            )

    lock_path.write_text(
        json.dumps(
            {
                "name": name,
                "run_id": run_id,
                "locked_at": started_at,
                "locked_at_iso": started_at_iso,
                "pid": os.getpid(),
            },
            ensure_ascii=False,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    _append_jsonl(log_path, {"event": "start", "name": name, "run_id": run_id, "ts": started_at_iso, "pid": os.getpid()})
    _record_pipeline_run(run_id=run_id, name=name, status="running", started_at_iso=started_at_iso)

    try:
        yield run_id
    except Exception as exc:
        duration = round(time.time() - started_at, 3)
        completed_at_iso = _now_iso()
        _append_jsonl(
            log_path,
            {
                "event": "error",
                "name": name,
                "run_id": run_id,
                "ts": completed_at_iso,
                "duration_seconds": duration,
                "error": str(exc),
            },
        )
        _record_pipeline_run(
            run_id=run_id,
            name=name,
            status="failed",
            started_at_iso=started_at_iso,
            completed_at_iso=completed_at_iso,
            duration_seconds=duration,
            error=str(exc),
        )
        raise
    else:
        duration = round(time.time() - started_at, 3)
        completed_at_iso = _now_iso()
        _append_jsonl(
            log_path,
            {
                "event": "complete",
                "name": name,
                "run_id": run_id,
                "ts": completed_at_iso,
                "duration_seconds": duration,
            },
        )
        _record_pipeline_run(
            run_id=run_id,
            name=name,
            status="success",
            started_at_iso=started_at_iso,
            completed_at_iso=completed_at_iso,
            duration_seconds=duration,
        )
    finally:
        try:
            current = json.loads(lock_path.read_text(encoding="utf-8"))
            if current.get("run_id") == run_id:
                lock_path.unlink()
        except FileNotFoundError:
            pass
        except Exception:
            # Best-effort cleanup; never mask pipeline failures.
            pass
