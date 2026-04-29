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
import hashlib
import os
import re
import time
import urllib.request
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

_CURRENT_RUN: dict[str, object] = {}

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


def _stable_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256_short(value: str, length: int = 24) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def _normalize_key_part(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9._:-]+", "-", value.strip().lower())
    return normalized.strip("-")


def _pipeline_env_key(name: str, suffix: str) -> str:
    normalized = re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")
    return f"GK_{normalized}_{suffix}"


def _env_float(*keys: str) -> float | None:
    for key in keys:
        value = os.environ.get(key)
        if not value:
            continue
        try:
            return float(value)
        except ValueError:
            print(f"⚠️ ignoring invalid float env {key}={value!r}", flush=True)
    return None


def _sum_run_cost(run_id: str) -> float | None:
    """Aggregate all cost events for a run and return total estimated_cost_usd."""
    env = _d1_env()
    if not env:
        return None
    account_id, api_token, database_id = env
    payload = json.dumps({
        "sql": "SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total FROM pipeline_cost_events WHERE run_id = ?",
        "params": [run_id],
    }).encode("utf-8")
    try:
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
        if body.get("success"):
            rows = (body.get("result") or [{}])[0].get("results") or []
            total = rows[0].get("total", 0) if rows else 0
            return round(float(total), 6) if total else 0.0
    except Exception:
        pass
    return None


def _pipeline_run_key_from_env(name: str) -> str | None:
    return os.environ.get(_pipeline_env_key(name, "RUN_KEY")) or os.environ.get("GK_PIPELINE_RUN_KEY")


def _pipeline_budget_from_env(name: str) -> float | None:
    return _env_float(_pipeline_env_key(name, "BUDGET_USD"), "GK_PIPELINE_BUDGET_USD")


def _cost_event_key(
    *,
    run_id: str,
    provider: str,
    endpoint: str,
    idempotency_key: str | None = None,
    research_job_id: str | None = None,
    provider_request_id: str | None = None,
    task_id: str | None = None,
) -> str | None:
    basis = provider_request_id or research_job_id or idempotency_key or task_id
    if not basis:
        return None
    scope = basis if provider_request_id or research_job_id else f"{run_id}:{basis}"
    return f"cost:{_normalize_key_part(provider)}:{_normalize_key_part(endpoint)}:{_sha256_short(scope)}"


def _pipeline_task_key(
    *,
    run_id: str,
    stage: str,
    idempotency_key: str,
) -> str:
    scope = f"{run_id}:{stage}:{idempotency_key}"
    return f"task-{_sha256_short(scope, 32)}"


def current_run_id() -> str | None:
    value = _CURRENT_RUN.get("run_id")
    return str(value) if value else None


def current_pipeline_name() -> str | None:
    value = _CURRENT_RUN.get("name")
    return str(value) if value else None


def _record_pipeline_run(
    *,
    run_id: str,
    name: str,
    status: str,
    started_at_iso: str,
    run_key: str | None = None,
    budget_usd: float | None = None,
    completed_at_iso: str | None = None,
    duration_seconds: float | None = None,
    error: str | None = None,
    metadata: dict | None = None,
) -> None:
    try:
        _d1_execute(
            """
            INSERT INTO pipeline_runs
              (run_id, run_key, pipeline, status, started_at, completed_at, duration_seconds,
               budget_usd, error, metadata_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(run_id) DO UPDATE SET
              run_key = COALESCE(excluded.run_key, pipeline_runs.run_key),
              status = excluded.status,
              completed_at = excluded.completed_at,
              duration_seconds = excluded.duration_seconds,
              budget_usd = COALESCE(excluded.budget_usd, pipeline_runs.budget_usd),
              error = excluded.error,
              metadata_json = excluded.metadata_json,
              updated_at = datetime('now')
            """,
            [
                run_id,
                run_key,
                name,
                status,
                started_at_iso,
                completed_at_iso,
                duration_seconds,
                budget_usd,
                error,
                json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True),
            ],
        )
    except Exception as exc:
        if any(token in str(exc).lower() for token in ("no such column", "has no column named")):
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
                return
            except Exception as fallback_exc:
                print(f"⚠️ pipeline_runs D1 write skipped: {fallback_exc}", flush=True)
                return
        # D1 run logging must never break the actual pipeline.
        print(f"⚠️ pipeline_runs D1 write skipped: {exc}", flush=True)


def update_pipeline_run(
    *,
    checked_count: int | None = None,
    saved_count: int | None = None,
    estimated_cost_usd: float | None = None,
    budget_usd: float | None = None,
    metadata: dict | None = None,
) -> None:
    """Best-effort update of aggregate counters for the active run."""
    run_id = current_run_id()
    if not run_id:
        return
    sets: list[str] = []
    params: list[object] = []
    if checked_count is not None:
        sets.append("checked_count = ?")
        params.append(int(checked_count))
    if saved_count is not None:
        sets.append("saved_count = ?")
        params.append(int(saved_count))
    if estimated_cost_usd is not None:
        sets.append("estimated_cost_usd = ?")
        params.append(round(float(estimated_cost_usd), 6))
    if budget_usd is not None:
        sets.append("budget_usd = ?")
        params.append(round(float(budget_usd), 6))
    if metadata is not None:
        sets.append("metadata_json = ?")
        params.append(json.dumps(metadata, ensure_ascii=False, sort_keys=True))
    if not sets:
        return
    sets.append("updated_at = datetime('now')")
    params.append(run_id)
    try:
        _d1_execute(f"UPDATE pipeline_runs SET {', '.join(sets)} WHERE run_id = ?", params)
    except Exception as exc:
        print(f"⚠️ pipeline_runs aggregate update skipped: {exc}", flush=True)


def start_pipeline_task(
    *,
    stage: str,
    idempotency_key: str,
    payload: dict | None = None,
    metadata: dict | None = None,
    max_attempts: int = 3,
) -> str | None:
    """Best-effort insert of a running task for the active run."""
    run_id = current_run_id()
    pipeline = current_pipeline_name()
    if not run_id or not pipeline:
        return None
    scoped_idempotency_key = f"{run_id}:{stage}:{idempotency_key}"
    task_id = _pipeline_task_key(
        run_id=run_id,
        stage=stage,
        idempotency_key=idempotency_key,
    )
    now = _now_iso()
    try:
        _d1_execute(
            """
            INSERT OR IGNORE INTO pipeline_tasks
              (task_id, run_id, pipeline, stage, status, idempotency_key,
               payload_json, attempt_count, max_attempts, started_at, metadata_json,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, 'running', ?, ?, 1, ?, ?, ?, datetime('now'), datetime('now'))
            """,
            [
                task_id,
                run_id,
                pipeline,
                stage,
                scoped_idempotency_key,
                _stable_json(payload or {}),
                int(max_attempts),
                now,
                _stable_json(metadata or {}),
            ],
        )
        return task_id
    except Exception as exc:
        print(f"⚠️ pipeline task start skipped: {exc}", flush=True)
        return None


def succeed_pipeline_task(
    task_id: str | None,
    *,
    status: str = "succeeded",
    result: dict | None = None,
    metadata: dict | None = None,
    output_ref: str | None = None,
) -> None:
    """Best-effort mark of a task as succeeded/skipped/warned."""
    if not task_id:
        return
    try:
        _d1_execute(
            """
            UPDATE pipeline_tasks
            SET status = ?,
                output_ref = COALESCE(?, output_ref),
                result_json = COALESCE(?, result_json),
                metadata_json = COALESCE(?, metadata_json),
                completed_at = ?,
                updated_at = datetime('now')
            WHERE task_id = ?
            """,
            [
                status,
                output_ref,
                _stable_json(result) if result is not None else None,
                _stable_json(metadata) if metadata is not None else None,
                _now_iso(),
                task_id,
            ],
        )
    except Exception as exc:
        print(f"⚠️ pipeline task success skipped: {exc}", flush=True)


def fail_pipeline_task(
    task_id: str | None,
    *,
    error: str,
    metadata: dict | None = None,
) -> None:
    """Best-effort mark of a task as failed."""
    if not task_id:
        return
    try:
        _d1_execute(
            """
            UPDATE pipeline_tasks
            SET status = 'failed',
                error = ?,
                metadata_json = COALESCE(?, metadata_json),
                completed_at = ?,
                updated_at = datetime('now')
            WHERE task_id = ?
            """,
            [
                error,
                _stable_json(metadata) if metadata is not None else None,
                _now_iso(),
                task_id,
            ],
        )
    except Exception as exc:
        print(f"⚠️ pipeline task failure skipped: {exc}", flush=True)


def record_cost_event(
    *,
    provider: str,
    endpoint: str,
    unit_type: str,
    unit_count: int,
    unit_price_usd: float | None = None,
    estimated_cost_usd: float | None = None,
    actual_cost_usd: float | None = None,
    task_id: str | None = None,
    research_job_id: str | None = None,
    event_key: str | None = None,
    provider_request_id: str | None = None,
    idempotency_key: str | None = None,
    metadata: dict | None = None,
) -> None:
    """Best-effort insert of one paid/cost-related event for the active run."""
    run_id = current_run_id()
    pipeline = current_pipeline_name()
    if not run_id or not pipeline:
        return
    if estimated_cost_usd is None and unit_price_usd is not None:
        estimated_cost_usd = int(unit_count) * float(unit_price_usd)
    if actual_cost_usd is not None:
        actual_cost_usd = round(float(actual_cost_usd), 6)
    if event_key is None:
        event_key = _cost_event_key(
            run_id=run_id,
            provider=provider,
            endpoint=endpoint,
            idempotency_key=idempotency_key,
            research_job_id=research_job_id,
            provider_request_id=provider_request_id,
            task_id=task_id,
        )
    try:
        _d1_execute(
            """
            INSERT OR IGNORE INTO pipeline_cost_events
              (run_id, pipeline, provider, endpoint, unit_type, unit_count, unit_price_usd,
               estimated_cost_usd, actual_cost_usd, task_id, research_job_id, event_key,
               provider_request_id, idempotency_key, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                run_id,
                pipeline,
                provider,
                endpoint,
                unit_type,
                int(unit_count),
                unit_price_usd,
                round(float(estimated_cost_usd), 6) if estimated_cost_usd is not None else None,
                actual_cost_usd,
                task_id,
                research_job_id,
                event_key,
                provider_request_id,
                idempotency_key,
                _stable_json(metadata or {}),
            ],
        )
    except Exception as exc:
        if any(token in str(exc).lower() for token in ("no such column", "has no column named")):
            try:
                _d1_execute(
                    """
                    INSERT INTO pipeline_cost_events
                      (run_id, pipeline, provider, endpoint, unit_type, unit_count, unit_price_usd,
                       estimated_cost_usd, actual_cost_usd, metadata_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        run_id,
                        pipeline,
                        provider,
                        endpoint,
                        unit_type,
                        int(unit_count),
                        unit_price_usd,
                        round(float(estimated_cost_usd), 6) if estimated_cost_usd is not None else None,
                        actual_cost_usd,
                        _stable_json(metadata or {}),
                    ],
                )
                return
            except Exception as fallback_exc:
                print(f"⚠️ pipeline cost event skipped: {fallback_exc}", flush=True)
                return
        print(f"⚠️ pipeline cost event skipped: {exc}", flush=True)


@contextmanager
def pipeline_run(
    name: str,
    *,
    state_dir: Path | None = None,
    stale_after_seconds: int = 6 * 60 * 60,
    run_key: str | None = None,
    budget_usd: float | None = None,
) -> Iterator[str]:
    """Guard a pipeline with a simple lock file and emit start/end records.

    The lock is intentionally conservative: if a recent lock exists, the second
    process exits fast. If a lock is stale, it is replaced.
    """

    root = state_dir or DEFAULT_STATE_DIR
    root.mkdir(parents=True, exist_ok=True)
    run_id = new_run_id(name)
    resolved_run_key = run_key or _pipeline_run_key_from_env(name)
    resolved_budget_usd = budget_usd if budget_usd is not None else _pipeline_budget_from_env(name)
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
                "run_key": resolved_run_key,
                "budget_usd": resolved_budget_usd,
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
    _record_pipeline_run(
        run_id=run_id,
        run_key=resolved_run_key,
        name=name,
        status="running",
        started_at_iso=started_at_iso,
        budget_usd=resolved_budget_usd,
    )
    previous_run = dict(_CURRENT_RUN)
    _CURRENT_RUN.clear()
    _CURRENT_RUN.update(
        {
            "name": name,
            "run_id": run_id,
            "run_key": resolved_run_key,
            "budget_usd": resolved_budget_usd,
        }
    )

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
            run_key=resolved_run_key,
            name=name,
            status="failed",
            started_at_iso=started_at_iso,
            budget_usd=resolved_budget_usd,
            completed_at_iso=completed_at_iso,
            duration_seconds=duration,
            error=str(exc),
        )
        total_cost = _sum_run_cost(run_id)
        if total_cost is not None and total_cost > 0:
            update_pipeline_run(estimated_cost_usd=total_cost)
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
            run_key=resolved_run_key,
            name=name,
            status="success",
            started_at_iso=started_at_iso,
            budget_usd=resolved_budget_usd,
            completed_at_iso=completed_at_iso,
            duration_seconds=duration,
        )
        total_cost = _sum_run_cost(run_id)
        if total_cost is not None and total_cost > 0:
            update_pipeline_run(estimated_cost_usd=total_cost)
    finally:
        _CURRENT_RUN.clear()
        _CURRENT_RUN.update(previous_run)
        try:
            current = json.loads(lock_path.read_text(encoding="utf-8"))
            if current.get("run_id") == run_id:
                lock_path.unlink()
        except FileNotFoundError:
            pass
        except Exception:
            # Best-effort cleanup; never mask pipeline failures.
            pass
