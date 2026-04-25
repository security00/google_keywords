#!/usr/bin/env python3
"""
Precompute the shared default expand result end-to-end.

Flow:
1. Load shared default keywords
2. Submit /api/research/expand with useCache=false
3. Poll /api/research/expand/status until complete
4. Optionally refine with LLM and write shared expand cache
5. Submit one shared /api/research/compare precompute job for the recommended pool

Usage:
  python3 scripts/precompute_shared_expand.py
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from scripts.pipeline_runtime import pipeline_run
except ModuleNotFoundError:
    from pipeline_runtime import pipeline_run

GK_SITE_URL = os.environ.get("GK_SITE_URL", "https://discoverkeywords.co")

# ── Load shared business rules ──
_RULES_PATH = os.path.join(os.path.dirname(__file__), '..', 'config', 'business-rules.json')
try:
    with open(_RULES_PATH) as _f:
        _RULES = json.load(_f)
except (FileNotFoundError, json.JSONDecodeError):
    _RULES = {}

GK_API_KEY = os.environ.get("GK_API_KEY", "")
GK_CRON_SECRET = os.environ.get("GK_CRON_SECRET", os.environ.get("CRON_SECRET", ""))
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "openai/gpt-5.2")
OPENROUTER_FILTER_TERMS = [
    term.strip()
    for term in os.environ.get(
        "OPENROUTER_FILTER_TERMS",
        "gambling,betting,casino,news,celebrity,movie,film,lottery,politics,sports,exam,coupon",
    ).replace("；", ",").split(",")
    if term.strip()
]
POLL_INTERVAL_SECONDS = int(os.environ.get("GK_PRECOMPUTE_POLL_SECONDS", "10"))
MAX_WAIT_SECONDS = int(os.environ.get("GK_PRECOMPUTE_MAX_WAIT_SECONDS", "1800"))
EXPAND_STATUS_TIMEOUT_SECONDS = int(
    os.environ.get("GK_PRECOMPUTE_EXPAND_STATUS_TIMEOUT_SECONDS", "120")
)
COMPARE_STATUS_TIMEOUT_SECONDS = int(
    os.environ.get("GK_PRECOMPUTE_COMPARE_STATUS_TIMEOUT_SECONDS", "60")
)
INTENT_STATUS_TIMEOUT_SECONDS = int(
    os.environ.get("GK_PRECOMPUTE_INTENT_STATUS_TIMEOUT_SECONDS", "60")
)
ENABLE_LLM_FILTER = os.environ.get("GK_PRECOMPUTE_LLM_FILTER", "true").lower() not in {
    "0",
    "false",
    "no",
}
ENABLE_COMPARE_PRECOMPUTE = os.environ.get("GK_PRECOMPUTE_COMPARE", "true").lower() not in {
    "0",
    "false",
    "no",
}
ENABLE_COMPARE_INTENT = os.environ.get("GK_PRECOMPUTE_COMPARE_INTENT", "true").lower() not in {
    "0",
    "false",
    "no",
}
USE_EXPAND_CACHE = os.environ.get("GK_PRECOMPUTE_USE_CACHE", "false").lower() in {
    "1",
    "true",
    "yes",
}
RESUME_EXPAND_JOB_ID = os.environ.get("GK_PRECOMPUTE_RESUME_EXPAND_JOB_ID", "").strip()
PRINT_RESULT = os.environ.get("GK_PRECOMPUTE_PRINT_RESULT", "false").lower() in {
    "1",
    "true",
    "yes",
}
COMPARE_BENCHMARK = os.environ.get("GK_COMPARE_BENCHMARK", _RULES.get('compare', {}).get('DEFAULT_COMPARE_BENCHMARK', 'gpts'))
RECOMMENDED_COMPARE_LIMIT = int(os.environ.get("GK_RECOMMENDED_COMPARE_LIMIT", _RULES.get('expand', {}).get('RECOMMENDED_COMPARE_LIMIT', 50)))
RECOMMENDED_MIN_SCORE = int(os.environ.get("GK_RECOMMENDED_MIN_SCORE", "20"))
RECOMMENDED_HIGH_CONFIDENCE_SCORE = int(os.environ.get("GK_RECOMMENDED_HIGH_CONFIDENCE_SCORE", "60"))
RECOMMENDED_SECTION_QUOTAS = {
    "explosive": int(os.environ.get("GK_RECOMMENDED_EXPLOSIVE_QUOTA", "22")),
    "fastRising": int(os.environ.get("GK_RECOMMENDED_FAST_RISING_QUOTA", "16")),
    "steadyRising": int(os.environ.get("GK_RECOMMENDED_STEADY_RISING_QUOTA", "12")),
}
LLM_BATCH_SIZE = int(os.environ.get("GK_PRECOMPUTE_LLM_BATCH_SIZE", "80"))
LLM_MAX_CANDIDATES = int(os.environ.get("GK_PRECOMPUTE_LLM_MAX_CANDIDATES", "900"))
SHARED_DEFAULTS_PATH = Path(
    os.environ.get(
        "GK_SHARED_DEFAULTS_PATH",
        "/root/clawd/projects/google_keywords/config/shared-keyword-defaults.json",
    )
)
STATE_DIR = Path(os.environ.get("GK_PRECOMPUTE_STATE_DIR", "/root/.local/state/google_keywords"))
SHARED_TIMEZONE = ZoneInfo(os.environ.get("GK_PRECOMPUTE_TIMEZONE", "Asia/Shanghai"))


def current_shared_date():
    return time.strftime("%Y-%m-%d", time.localtime(time.time() + 8 * 3600)) if SHARED_TIMEZONE.key == "Asia/Shanghai" else __import__("datetime").datetime.now(SHARED_TIMEZONE).strftime("%Y-%m-%d")


SHARED_DATE = current_shared_date()
STATE_PATH = STATE_DIR / f"precompute_state_{SHARED_DATE}.json"
EXPAND_RESPONSE_PATH = STATE_DIR / f"precompute_expand_{SHARED_DATE}.json"
HEALTH_PATH = STATE_DIR / f"precompute_health_{SHARED_DATE}.json"


def utc_now_iso():
    return __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()


def load_keywords():
    data = json.loads(SHARED_DEFAULTS_PATH.read_text())
    keywords = data.get("defaultKeywords", [])
    if not isinstance(keywords, list):
        raise RuntimeError("shared defaults missing defaultKeywords array")
    result = [item.strip() for item in keywords if isinstance(item, str) and item.strip()]
    if not result:
        raise RuntimeError("shared defaults keyword list is empty")
    return result


def ensure_state_dir():
    STATE_DIR.mkdir(parents=True, exist_ok=True)


def load_state():
    ensure_state_dir()
    if not STATE_PATH.exists():
        return {}
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {}


def write_health_report(state):
    ensure_state_dir()
    stage = state.get("stage") or "unknown"
    health = {
        "sharedDate": SHARED_DATE,
        "status": "complete" if stage == "complete" else "in_progress",
        "stage": stage,
        "updatedAt": state.get("updatedAt"),
        "stageStartedAt": state.get("stageStartedAt"),
        "expandCompletedAt": state.get("expandCompletedAt"),
        "compareCompletedAt": state.get("compareCompletedAt"),
        "intentCompletedAt": state.get("intentCompletedAt"),
        "expandJobId": state.get("expandJobId"),
        "compareJobId": state.get("compareJobId"),
        "intentJobId": state.get("intentJobId"),
    }
    HEALTH_PATH.write_text(json.dumps(health, ensure_ascii=False, indent=2))
    return health


def save_state(**updates):
    ensure_state_dir()
    state = load_state()
    previous_stage = state.get("stage")
    next_stage = updates.get("stage", previous_stage)
    state.update(updates)
    state["sharedDate"] = SHARED_DATE
    now = utc_now_iso()
    state["updatedAt"] = now
    if next_stage != previous_stage:
        state["stageStartedAt"] = now
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2))
    health = write_health_report(state)
    sync_remote_health(health)
    return state


def save_expand_response(expand_response):
    ensure_state_dir()
    EXPAND_RESPONSE_PATH.write_text(json.dumps(expand_response, ensure_ascii=False))
    save_state(expandResponseSavedAt=utc_now_iso())


def load_expand_response():
    if not EXPAND_RESPONSE_PATH.exists():
        return None
    try:
        return json.loads(EXPAND_RESPONSE_PATH.read_text())
    except Exception:
        return None


def curl_json(method, path, body=None, timeout=120, extra_headers=None):
    url = f"{GK_SITE_URL}{path}"
    input_payload = None
    cmd = [
        "curl",
        "-sS",
        "-L",
        "--max-time",
        str(timeout),
        "-X",
        method,
        url,
        "-H",
        "Content-Type: application/json",
        "-H",
        f"Authorization: Bearer {GK_API_KEY}",
    ]
    for name, value in (extra_headers or {}).items():
        cmd.extend(["-H", f"{name}: {value}"])
    if body is not None:
        input_payload = json.dumps(body)
        cmd.extend(["--data-binary", "@-"])
    result = subprocess.run(
        cmd,
        input=input_payload,
        capture_output=True,
        text=True,
        timeout=timeout + 10,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"curl failed with exit {result.returncode}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"failed to parse JSON: {exc}") from exc


def sync_remote_health(health):
    if not GK_SITE_URL or not GK_CRON_SECRET:
        return
    try:
        curl_json(
            "POST",
            "/api/admin/precompute-health",
            body=health,
            timeout=30,
            extra_headers={"x-cron-secret": GK_CRON_SECRET},
        )
    except Exception as exc:
        print(f"⚠️  Failed to sync remote health: {exc}", file=sys.stderr)


def post_json(url, headers, body, timeout=120):
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc


def batches(items, size):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def organize_candidates(candidates):
    sorted_candidates = sorted(candidates, key=lambda item: item.get("score", 0), reverse=True)
    organized = {
        "explosive": [],
        "fastRising": [],
        "steadyRising": [],
        "slowRising": [],
    }
    for candidate in sorted_candidates:
        value = float(candidate.get("value") or 0)
        if value > 500:
            organized["explosive"].append(candidate)
        elif value > 200:
            organized["fastRising"].append(candidate)
        elif value > 100:
            organized["steadyRising"].append(candidate)
        else:
            organized["slowRising"].append(candidate)
    return organized


def flatten_organized(organized):
    return (
        organized["explosive"]
        + organized["fastRising"]
        + organized["steadyRising"]
        + organized["slowRising"]
    )


def build_recommended_selection(expand_response):
    organized = expand_response.get("organized") or {}
    flat_list = expand_response.get("flatList") or []
    picked = []
    picked_set = set()
    limit = max(1, RECOMMENDED_COMPARE_LIMIT)

    def add_keyword(item):
        keyword = item.get("keyword") if isinstance(item, dict) else None
        if not keyword or keyword in picked_set:
            return False
        score = float(item.get("score") or 0)
        if score < RECOMMENDED_MIN_SCORE:
            return False
        picked.append(keyword)
        picked_set.add(keyword)
        return True

    def add_candidates(items, max_count):
        added = 0
        for item in items or []:
            if len(picked) >= limit or added >= max_count:
                break
            if add_keyword(item):
                added += 1

    strong_candidates = [
        item for item in flat_list
        if isinstance(item, dict) and float(item.get("score") or 0) >= RECOMMENDED_HIGH_CONFIDENCE_SCORE
    ]
    for item in strong_candidates:
        if len(picked) >= limit:
            break
        add_keyword(item)

    add_candidates(organized.get("explosive"), RECOMMENDED_SECTION_QUOTAS["explosive"])
    add_candidates(organized.get("fastRising"), RECOMMENDED_SECTION_QUOTAS["fastRising"])
    add_candidates(organized.get("steadyRising"), RECOMMENDED_SECTION_QUOTAS["steadyRising"])

    if len(picked) < limit:
        slow_ids = {id(item) for item in organized.get("slowRising", []) if isinstance(item, dict)}
        non_slow = [item for item in flat_list if id(item) not in slow_ids]
        add_candidates(non_slow, limit)

    return picked[:limit]


def refine_with_llm(expand_response):
    if not ENABLE_LLM_FILTER:
        print("ℹ️  LLM filter disabled by GK_PRECOMPUTE_LLM_FILTER", file=sys.stderr)
        return expand_response
    if not OPENROUTER_API_KEY:
        print("⚠️  OPENROUTER_API_KEY missing; keeping rule-filtered result", file=sys.stderr)
        return expand_response

    candidates = expand_response.get("flatList") or expand_response.get("candidates") or []
    candidates = [item for item in candidates if isinstance(item, dict) and item.get("keyword")]
    candidates_for_model = candidates[: max(1, min(LLM_MAX_CANDIDATES, len(candidates)))]
    blocked = set()

    system_prompt = (
        "You are filtering keyword research candidates before they are shown to a human operator. "
        "Keep durable, productizable, commercial keywords, especially AI tools, software, utilities, "
        "SaaS, templates, workflows, automation, and online games (browser games, game tools, game platforms). "
        "Block short-lived noise, entertainment/news/sports/politics/celebrity/exam answers/coupons/gambling/adult/domain spam/local "
        "navigation queries. Block exact brands or one-off entities unless the query clearly describes "
        "a reusable software/tool/game opportunity. Return strict JSON only."
    )

    print(
        f"🤖 LLM filter: {len(candidates_for_model)}/{len(candidates)} candidates, batch={LLM_BATCH_SIZE}",
        file=sys.stderr,
    )
    for idx, batch in enumerate(batches(candidates_for_model, LLM_BATCH_SIZE), start=1):
        body = {
            "model": OPENROUTER_MODEL,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "blacklist_topics": OPENROUTER_FILTER_TERMS,
                            "keywords": [
                                {
                                    "keyword": item["keyword"],
                                    "trend_value": item.get("value", 0),
                                    "source_seed": item.get("source", ""),
                                    "rule_score": item.get("score", 0),
                                }
                                for item in batch
                            ],
                            "output": '{ "blocked": ["keyword"] }',
                            "rules": [
                                "blocked may only include exact keywords from the provided input",
                                "preserve original spelling",
                                "do not include explanations",
                                "if all keywords should be kept, return {\"blocked\":[]}",
                            ],
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            "max_tokens": 1400,
        }
        result = post_json(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            {"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
            body,
            timeout=120,
        )
        content = (
            ((result.get("choices") or [{}])[0].get("message") or {}).get("content")
            or (result.get("choices") or [{}])[0].get("text")
            or ""
        )
        start = content.find("{")
        end = content.rfind("}")
        parsed = json.loads(content[start:end + 1]) if start >= 0 and end >= start else {}
        blocked_list = parsed.get("blocked") if isinstance(parsed, dict) else []
        if isinstance(blocked_list, list):
            for keyword in blocked_list:
                if isinstance(keyword, str):
                    blocked.add(keyword.lower().strip())
        print(f"   LLM batch {idx}: blocked={len(blocked_list or [])}", file=sys.stderr)

    if not blocked:
        print("ℹ️  LLM returned no blocked keywords", file=sys.stderr)
        return expand_response

    filtered = [item for item in candidates if item["keyword"].lower().strip() not in blocked]
    blocked_candidates = [item for item in candidates if item["keyword"].lower().strip() in blocked]
    organized = organize_candidates(filtered)
    flat = flatten_organized(organized)
    previous_filtered = expand_response.get("filteredOut") or []
    refined = {
        **expand_response,
        "candidates": flat,
        "organized": organized,
        "flatList": flat,
        "filteredOut": previous_filtered + blocked_candidates,
        "filter": {
            "enabled": True,
            "model": OPENROUTER_MODEL,
            "total": len(candidates),
            "removed": len(previous_filtered) + len(blocked_candidates),
            "kept": len(flat),
        },
    }
    print(f"✅ LLM filter done: kept={len(flat)} blocked_by_llm={len(blocked_candidates)}", file=sys.stderr)
    return refined


def write_shared_cache(expand_response):
    if not GK_CRON_SECRET:
        raise RuntimeError("GK_CRON_SECRET or CRON_SECRET env var required to write shared cache")
    return curl_json(
        "POST",
        "/api/research/expand/cache",
        {"response": expand_response},
        timeout=120,
        extra_headers={"x-cron-secret": GK_CRON_SECRET},
    )


def precompute_shared_compare(expand_response, resume_job_id=""):
    if not ENABLE_COMPARE_PRECOMPUTE:
        print("ℹ️  Compare precompute disabled by GK_PRECOMPUTE_COMPARE", file=sys.stderr)
        return None
    if not GK_CRON_SECRET:
        raise RuntimeError("GK_CRON_SECRET or CRON_SECRET env var required to precompute compare")

    selected = build_recommended_selection(expand_response)
    if not selected:
        print("⚠️  No recommended keywords for compare precompute", file=sys.stderr)
        return None

    print(
        f"📊 Shared compare precompute: {len(selected)} keywords, benchmark={COMPARE_BENCHMARK}",
        file=sys.stderr,
    )
    if resume_job_id:
        submit = {"jobId": resume_job_id}
        print(f"↩️  Resuming compare job: {resume_job_id}", file=sys.stderr)
    else:
        submit = curl_json(
            "POST",
            "/api/research/compare",
            {
                "keywords": selected,
                "dateFrom": expand_response.get("dateFrom"),
                "dateTo": expand_response.get("dateTo"),
                "benchmark": COMPARE_BENCHMARK,
                "minRuleScore": RECOMMENDED_MIN_SCORE,
            },
            timeout=120,
            extra_headers={"x-cron-secret": GK_CRON_SECRET},
        )

    if submit.get("status") == "complete":
        print(f"✅ Shared compare already cached: {len(submit.get('results') or [])} results", file=sys.stderr)
        save_state(stage="compare_complete", compareCompletedAt=utc_now_iso())
        precompute_compare_intent(expand_response, selected)
        return submit

    job_id = submit.get("jobId")
    if not job_id:
        raise RuntimeError(f"compare submit returned unexpected payload: {submit}")

    save_state(
        stage="compare_pending",
        compareJobId=job_id,
        compareSelected=selected,
        compareStartedAt=utc_now_iso(),
    )
    print(f"📋 Submitted compare job: {job_id}", file=sys.stderr)
    started_at = time.time()
    while time.time() - started_at < MAX_WAIT_SECONDS:
        status = curl_json(
            "GET",
            f"/api/research/compare/status?jobId={job_id}",
            body=None,
            timeout=COMPARE_STATUS_TIMEOUT_SECONDS,
        )
        state = status.get("status")
        if state == "complete":
            print(f"✅ Shared compare complete: {len(status.get('results') or [])} results", file=sys.stderr)
            save_state(
                stage="compare_complete",
                compareJobId=job_id,
                compareCompletedAt=utc_now_iso(),
                compareReady=status.get("ready"),
                compareTotal=status.get("total"),
            )
            precompute_compare_intent(expand_response, selected)
            return status
        if state == "failed":
            raise RuntimeError(status.get("error") or "compare status failed")
        ready = status.get("ready")
        total = status.get("total")
        save_state(
            stage="compare_pending",
            compareJobId=job_id,
            compareSelected=selected,
            compareReady=ready,
            compareTotal=total,
            compareLastPollAt=utc_now_iso(),
        )
        print(f"⏳ Compare pending: {ready}/{total}", file=sys.stderr)
        time.sleep(POLL_INTERVAL_SECONDS)

    raise RuntimeError(f"timed out after {MAX_WAIT_SECONDS}s waiting for shared compare job")


def precompute_compare_intent(expand_response, selected, resume_job_id=""):
    if not ENABLE_COMPARE_INTENT:
        print("ℹ️  Compare intent precompute disabled by GK_PRECOMPUTE_COMPARE_INTENT", file=sys.stderr)
        return None

    print("🧭 Shared compare intent precompute: async SERP/LLM", file=sys.stderr)
    if resume_job_id:
        submit = {"jobId": resume_job_id}
        print(f"↩️  Resuming intent job: {resume_job_id}", file=sys.stderr)
    else:
        submit = curl_json(
            "POST",
            "/api/research/compare/intent",
            {
                "keywords": selected,
                "dateFrom": expand_response.get("dateFrom"),
                "dateTo": expand_response.get("dateTo"),
                "benchmark": COMPARE_BENCHMARK,
                "minRuleScore": RECOMMENDED_MIN_SCORE,
            },
            timeout=120,
            extra_headers={"x-cron-secret": GK_CRON_SECRET},
        )

    if submit.get("status") == "complete":
        print(f"✅ Shared compare intent complete: {submit.get('results')} results", file=sys.stderr)
        save_state(stage="complete", intentCompletedAt=utc_now_iso())
        return submit

    job_id = submit.get("jobId")
    if not job_id:
        raise RuntimeError(f"intent submit returned unexpected payload: {submit}")

    save_state(
        stage="intent_pending",
        intentJobId=job_id,
        intentStartedAt=utc_now_iso(),
        compareSelected=selected,
    )
    print(
        f"📋 Submitted intent job: {job_id} tasks={submit.get('total')} keywords={submit.get('intentKeywords')}",
        file=sys.stderr,
    )
    started_at = time.time()
    while time.time() - started_at < MAX_WAIT_SECONDS:
        status = curl_json(
            "GET",
            f"/api/research/compare/intent/status?jobId={job_id}",
            body=None,
            timeout=INTENT_STATUS_TIMEOUT_SECONDS,
        )
        state = status.get("status")
        if state == "complete":
            print(
                f"✅ Shared compare intent complete: intents={status.get('intents')} results={status.get('results')}",
                file=sys.stderr,
            )
            save_state(
                stage="complete",
                intentJobId=job_id,
                intentCompletedAt=utc_now_iso(),
                intentReady=status.get("ready"),
                intentTotal=status.get("total"),
            )
            return status
        if state == "failed":
            raise RuntimeError(status.get("error") or "intent status failed")
        save_state(
            stage="intent_pending",
            intentJobId=job_id,
            intentReady=status.get("ready"),
            intentTotal=status.get("total"),
            intentLastPollAt=utc_now_iso(),
            compareSelected=selected,
        )
        print(f"⏳ Intent pending: {status.get('ready')}/{status.get('total')}", file=sys.stderr)
        time.sleep(POLL_INTERVAL_SECONDS)

    raise RuntimeError(f"timed out after {MAX_WAIT_SECONDS}s waiting for shared intent job")


def maybe_print_result(result):
    if PRINT_RESULT:
        print(json.dumps(result, ensure_ascii=False))


def main():
    if not GK_API_KEY:
        raise RuntimeError("GK_API_KEY env var required")

    state = load_state()
    keywords = load_keywords()
    print(f"🚀 Shared expand precompute: {len(keywords)} keywords", file=sys.stderr)
    print(f"   Site: {GK_SITE_URL}", file=sys.stderr)

    if state.get("stage") == "complete":
        print(f"✅ Shared precompute already complete for {SHARED_DATE}", file=sys.stderr)
        save_state(stage="complete", lastVerifiedAt=utc_now_iso())
        cached_response = load_expand_response()
        if cached_response:
            maybe_print_result(cached_response)
        return

    cached_expand_response = load_expand_response()
    if cached_expand_response and state.get("stage") in {"expand_cache_written", "compare_pending", "compare_complete", "intent_pending"}:
        print(f"↩️  Reusing cached expand response for {SHARED_DATE}", file=sys.stderr)
        save_state(stage=state.get("stage"), resumeAt=utc_now_iso())
        selected = build_recommended_selection(cached_expand_response)
        if state.get("stage") == "compare_pending":
            precompute_shared_compare(cached_expand_response, str(state.get("compareJobId") or ""))
            maybe_print_result(cached_expand_response)
            return
        if state.get("stage") == "compare_complete" and selected:
            precompute_compare_intent(cached_expand_response, selected, str(state.get("intentJobId") or ""))
            maybe_print_result(cached_expand_response)
            return
        if state.get("stage") == "intent_pending" and selected:
            precompute_compare_intent(cached_expand_response, selected, str(state.get("intentJobId") or ""))
            maybe_print_result(cached_expand_response)
            return
        precompute_shared_compare(cached_expand_response, str(state.get("compareJobId") or ""))
        maybe_print_result(cached_expand_response)
        return

    resume_expand_job_id = RESUME_EXPAND_JOB_ID or str(state.get("expandJobId") or "")
    if resume_expand_job_id:
        submit = {"jobId": resume_expand_job_id}
        print(f"↩️  Resuming expand job: {resume_expand_job_id}", file=sys.stderr)
    else:
        submit = curl_json(
            "POST",
            "/api/research/expand",
            {
                "keywords": keywords,
                "useCache": USE_EXPAND_CACHE,
                "enableLlmFilter": False,
            },
            timeout=120,
            extra_headers={"x-cron-secret": GK_CRON_SECRET} if GK_CRON_SECRET else None,
        )
        if submit.get("jobId"):
            save_state(stage="expand_pending", expandJobId=submit.get("jobId"), expandStartedAt=utc_now_iso())

    if submit.get("status") == "complete":
        refined = refine_with_llm(submit)
        cache_result = write_shared_cache(refined) if refined is not submit else None
        save_expand_response(refined)
        save_state(
            stage="expand_cache_written",
            expandJobId=submit.get("jobId"),
            expandCompletedAt=utc_now_iso(),
        )
        flat = refined.get("flatList", [])
        print(f"✅ Shared result already complete: {len(flat)} keywords", file=sys.stderr)
        if cache_result:
            print(f"✅ Shared cache updated: {cache_result.get('flatList')} keywords", file=sys.stderr)
        precompute_shared_compare(refined, str(state.get("compareJobId") or ""))
        maybe_print_result(refined)
        return

    job_id = submit.get("jobId")
    if not job_id:
        raise RuntimeError(f"expand submit returned unexpected payload: {submit}")

    save_state(stage="expand_pending", expandJobId=job_id, expandStartedAt=utc_now_iso())
    print(f"📋 Submitted job: {job_id}", file=sys.stderr)
    started_at = time.time()

    while time.time() - started_at < MAX_WAIT_SECONDS:
        status = curl_json(
            "GET",
            f"/api/research/expand/finalize?jobId={job_id}",
            body=None,
            timeout=EXPAND_STATUS_TIMEOUT_SECONDS,
            extra_headers={"x-cron-secret": GK_CRON_SECRET} if GK_CRON_SECRET else None,
        )
        state = status.get("status")
        if state == "complete":
            refined = refine_with_llm(status)
            cache_result = write_shared_cache(refined) if refined is not status else None
            save_expand_response(refined)
            save_state(
                stage="expand_cache_written",
                expandJobId=job_id,
                expandCompletedAt=utc_now_iso(),
                expandReady=status.get("ready"),
                expandTotal=status.get("total"),
            )
            flat = refined.get("flatList", [])
            print(f"✅ Shared expand complete: {len(flat)} keywords", file=sys.stderr)
            if cache_result:
                print(f"✅ Shared cache updated: {cache_result.get('flatList')} keywords", file=sys.stderr)
            precompute_shared_compare(refined, str(load_state().get("compareJobId") or ""))
            maybe_print_result(refined)
            return
        if state == "failed":
            raise RuntimeError(status.get("error") or "expand status failed")

        ready = status.get("ready")
        total = status.get("total")
        save_state(
            stage="expand_pending",
            expandJobId=job_id,
            expandReady=ready,
            expandTotal=total,
            expandLastPollAt=utc_now_iso(),
        )
        print(f"⏳ Pending: {ready}/{total}", file=sys.stderr)
        time.sleep(POLL_INTERVAL_SECONDS)

    raise RuntimeError(f"timed out after {MAX_WAIT_SECONDS}s waiting for shared expand job")


if __name__ == "__main__":
    try:
        with pipeline_run("precompute-shared-expand") as run_id:
            print(f"run_id={run_id}", file=sys.stderr)
            main()
    except Exception as exc:
        import traceback
        tb = traceback.format_exc()
        msg = f"⚔️ 预计算失败告警\n\n时间: {time.strftime('%Y-%m-%d %H:%M UTC')}\n错误: {exc}\n\n```\n{tb[-500:]}```"
        print(f"❌ FATAL: {exc}\n{tb}", file=sys.stderr)
        # Send Telegram alert
        tg_token = os.environ.get("TG_ALERT_TOKEN", "")
        tg_chat = os.environ.get("TG_ALERT_CHAT", "")
        if tg_token and tg_chat:
            try:
                urllib.request.urlopen(
                    urllib.request.Request(
                        f"https://api.telegram.org/bot{tg_token}/sendMessage",
                        data=json.dumps({"chat_id": tg_chat, "text": msg, "parse_mode": "Markdown"}).encode(),
                        headers={"Content-Type": "application/json"},
                    ),
                    timeout=10,
                )
            except Exception:
                pass
        sys.exit(1)
