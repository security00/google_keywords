#!/usr/bin/env python3
"""Small runtime guardrails for long-running pipeline scripts.

Provides:
- per-pipeline single-instance lock
- run_id generation
- structured start/end JSONL log records

This module intentionally has no external dependencies.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DEFAULT_STATE_DIR = Path(os.environ.get("GK_PRECOMPUTE_STATE_DIR", "/root/.local/state/google_keywords"))


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_run_id(prefix: str) -> str:
    return f"{prefix}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{uuid.uuid4().hex[:8]}"


def _append_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


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
                "locked_at_iso": _now_iso(),
                "pid": os.getpid(),
            },
            ensure_ascii=False,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    _append_jsonl(log_path, {"event": "start", "name": name, "run_id": run_id, "ts": _now_iso(), "pid": os.getpid()})

    try:
        yield run_id
    except Exception as exc:
        _append_jsonl(
            log_path,
            {
                "event": "error",
                "name": name,
                "run_id": run_id,
                "ts": _now_iso(),
                "duration_seconds": round(time.time() - started_at, 3),
                "error": str(exc),
            },
        )
        raise
    else:
        _append_jsonl(
            log_path,
            {
                "event": "complete",
                "name": name,
                "run_id": run_id,
                "ts": _now_iso(),
                "duration_seconds": round(time.time() - started_at, 3),
            },
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
