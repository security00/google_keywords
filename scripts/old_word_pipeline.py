#!/usr/bin/env python3
"""
Old-word pipeline: find low-competition keyword opportunities.

Calls our own /api/research/keyword-suggestions endpoint (which proxies to DataForSEO).
No DataForSEO credentials needed locally — they live in Worker secrets.

Flow:
1. Read seed keywords
2. Call /api/research/keyword-suggestions for each seed
3. Filter: intent=transactional/commercial, volume>=500, KD<=35, toolable
4. Score: volume * (100-KD) / 100 * CPC weight
5. Save to D1 via /api/admin/old-keywords

Cost: ~$0.013/seed × 127 = ~$1.65/run (weekly recommended)
"""

import json
import os
import subprocess
import sys
import time
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from scripts.pipeline_runtime import (
        fail_pipeline_task,
        pipeline_run,
        record_cost_event,
        start_pipeline_task,
        succeed_pipeline_task,
        update_pipeline_run,
    )
except ModuleNotFoundError:
    from pipeline_runtime import (
        fail_pipeline_task,
        pipeline_run,
        record_cost_event,
        start_pipeline_task,
        succeed_pipeline_task,
        update_pipeline_run,
    )

GK_SITE_URL = os.environ.get("GK_SITE_URL", "https://discoverkeywords.co")
GK_API_KEY = os.environ.get("GK_API_KEY", "")
GK_CRON_SECRET = os.environ.get("GK_CRON_SECRET", "")

SEED_FILE = Path(
    os.environ.get("GK_SEED_FILE", "/root/clawd/projects/google_keywords/config/shared-keyword-defaults.json")
)
STATE_DIR = Path(os.environ.get("GK_PRECOMPUTE_STATE_DIR", "/root/.local/state/google_keywords"))
SHARED_TIMEZONE = ZoneInfo(os.environ.get("GK_PRECOMPUTE_TIMEZONE", "Asia/Shanghai"))

LIMIT_PER_SEED = int(os.environ.get("GK_OLD_WORD_LIMIT_PER_SEED", "20"))
MAX_SEEDS = int(os.environ.get("GK_OLD_WORD_MAX_SEEDS", "0"))  # 0 = all
SLEEP_SECONDS = float(os.environ.get("GK_OLD_WORD_SLEEP", "1.0"))

MIN_VOLUME = int(os.environ.get("GK_OLD_WORD_MIN_VOLUME", "500"))
MAX_KD = int(os.environ.get("GK_OLD_WORD_MAX_KD", "35"))

TOOL_WORDS = {
    "generator", "maker", "builder", "creator", "converter", "editor", "detector",
    "checker", "solver", "tracker", "planner", "scraper", "viewer", "writer",
    "translator", "transcriber", "summarizer", "optimizer", "uploader", "downloader",
    "enhancer", "upscaler", "processor", "compiler", "finder", "explorer",
    "comparator", "analyzer", "verifier", "restorer", "modifier", "manager",
    "scheduler", "calculator", "tool", "app", "software", "online", "free",
}

BRAND_WORDS = {
    "chatgpt", "openai", "claude", "gemini", "deepseek", "copilot", "canva", "adobe",
    "grammarly", "quillbot", "midjourney", "perplexity", "cursor", "bolt", "lovable",
    "replit", "github", "notion", "figma", "capcut", "pixelcut", "character ai",
    "copyleaks", "scribbr", "synthesia", "topaz", "walter",
}

INFORMATIONAL_WORDS = {"what is", "how to", "guide", "tutorial", "faq", "example", "sample"}


def today_str():
    return datetime.now(timezone.utc).astimezone(SHARED_TIMEZONE).strftime("%Y-%m-%d")


def load_seeds():
    data = json.loads(SEED_FILE.read_text())
    keywords = data.get("defaultKeywords", [])
    seeds = [kw.strip() for kw in keywords if isinstance(kw, str) and kw.strip()]
    if MAX_SEEDS > 0:
        seeds = seeds[:MAX_SEEDS]
    return seeds


def normalize_keyword(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().strip())


def classify_intent(keyword: str) -> str:
    k = normalize_keyword(keyword)
    if any(brand in k for brand in BRAND_WORDS):
        return "navigational"
    if any(token in k for token in INFORMATIONAL_WORDS):
        return "informational"
    words = set(k.split())
    if TOOL_WORDS.intersection(words) or "free" in words:
        return "transactional"
    if any(w in k for w in ("best", "top", "review", "vs", "alternative", "compare")):
        return "commercial"
    return "unknown"


def is_toolable(keyword: str) -> bool:
    words = set(normalize_keyword(keyword).split())
    return bool(TOOL_WORDS.intersection(words))


def is_noise(keyword: str) -> bool:
    k = normalize_keyword(keyword)
    if any(brand in k for brand in BRAND_WORDS):
        return True
    if any(w in k for w in ("reddit", "discord", "youtube", "twitter", "download apk")):
        return True
    return False


def has_low_confidence_kd(item: dict) -> bool:
    """Treat suspicious KD=0 rows as unknown, not as a free opportunity."""
    kd = int(item.get("kd") or 0)
    volume = int(item.get("volume") or 0)
    competition = str(item.get("competition") or "").upper()
    return kd <= 0 and (volume >= 10000 or competition not in ("", "LOW"))


def opportunity_score(volume: int, kd: int, cpc: float) -> float:
    kd = min(kd, 100)
    if cpc >= 5: cpc_w = 1.5
    elif cpc >= 2: cpc_w = 1.2
    elif cpc >= 1: cpc_w = 1.0
    else: cpc_w = 0.8
    return round(volume * (100 - kd) / 100 * cpc_w, 1)


def actual_cost_from_response(resp):
    if isinstance(resp, dict) and isinstance(resp.get("cost"), dict):
        return resp["cost"].get("actualCostUsd")
    return None


def curl_json(method, path, body=None, timeout=30):
    url = f"{GK_SITE_URL}{path}"
    cmd = ["curl", "-sS", "-L", "--max-time", str(timeout), "-X", method, url,
           "-H", "Content-Type: application/json",
           "-H", f"Authorization: Bearer {GK_API_KEY}"]
    if GK_CRON_SECRET:
        cmd.extend(["-H", f"x-cron-secret: {GK_CRON_SECRET}"])
    input_payload = None
    if body is not None:
        input_payload = json.dumps(body)
        cmd.extend(["--data-binary", "@-"])
    result = subprocess.run(cmd, input=input_payload, capture_output=True, text=True, timeout=timeout + 10)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"curl exit {result.returncode}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"JSON parse error: {exc}") from exc


def main():
    if not GK_API_KEY:
        print("❌ GK_API_KEY required", file=sys.stderr)
        sys.exit(1)

    date = today_str()
    seeds = load_seeds()

    print(f"=== Old Word Pipeline ({date}) ===", file=sys.stderr)
    print(f"Seeds: {len(seeds)} | Limit/seed: {LIMIT_PER_SEED} | Vol≥{MIN_VOLUME} | KD≤{MAX_KD}", file=sys.stderr)
    print(f"Est. cost: ${len(seeds) * 0.013:.2f}", file=sys.stderr)
    print(file=sys.stderr)

    all_keywords = {}
    errors = 0
    keyword_suggestion_calls = 0
    trends_quick_calls = 0

    for idx, seed in enumerate(seeds, start=1):
        query = seed if seed.lower().startswith("ai ") else f"ai {seed}"
        print(f"[{idx}/{len(seeds)}] {query}", end=" ", file=sys.stderr)
        task_id = start_pipeline_task(
            stage="old-word.seed",
            idempotency_key=f"keyword-suggestions:{query}:{LIMIT_PER_SEED}",
            payload={"seed": seed, "query": query, "limit": LIMIT_PER_SEED},
            metadata={"index": idx, "total": len(seeds)},
        )
        try:
            resp = curl_json("POST", "/api/research/keyword-suggestions",
                           {"keyword": query, "limit": LIMIT_PER_SEED}, timeout=60)
            keyword_suggestion_calls += 1
            record_cost_event(
                provider="dataforseo",
                endpoint="keyword_suggestions",
                unit_type="call",
                unit_count=1,
                unit_price_usd=0.013,
                actual_cost_usd=actual_cost_from_response(resp),
                task_id=task_id,
                idempotency_key=f"keyword-suggestions:{query}:{LIMIT_PER_SEED}",
                metadata={"seed": seed, "query": query, "limit": LIMIT_PER_SEED, "cost": resp.get("cost")},
            )
            items = resp.get("items", [])
            print(f"→ {len(items)} suggestions", file=sys.stderr)
            kept_for_seed = 0
            for item in items:
                kw = normalize_keyword(item.get("keyword", ""))
                if not kw or is_noise(kw):
                    continue
                if has_low_confidence_kd(item):
                    continue
                intent = classify_intent(kw)
                toolable = is_toolable(kw)
                score = opportunity_score(item.get("volume", 0), item.get("kd", 0), item.get("cpc", 0))
                enriched = {
                    **item,
                    "source_seed": seed,
                    "intent": intent,
                    "toolable": toolable,
                    "score": score,
                }
                existing = all_keywords.get(kw)
                if not existing or score > existing.get("score", 0):
                    all_keywords[kw] = enriched
                    kept_for_seed += 1
            succeed_pipeline_task(
                task_id,
                result={"items": len(items), "kept": kept_for_seed},
                metadata={"seed": seed, "query": query},
            )
        except Exception as e:
            errors += 1
            fail_pipeline_task(
                task_id,
                error=str(e),
                metadata={"seed": seed, "query": query},
            )
            print(f"✗ {e}", file=sys.stderr)
        time.sleep(SLEEP_SECONDS)

    # Filter
    filtered = [
        item for item in all_keywords.values()
        if item["intent"] in ("transactional", "commercial")
        and item.get("volume", 0) >= MIN_VOLUME
        and item.get("cpc", 0) > 0
        and item.get("kd", 0) <= MAX_KD
        and not has_low_confidence_kd(item)
        and item.get("competition", "") in ("LOW", "MEDIUM", "")
        and item["toolable"]
    ]
    filtered.sort(key=lambda x: x["score"], reverse=True)

    print(f"\n📊 Total: {len(all_keywords)} | Filtered: {len(filtered)} | Errors: {errors}", file=sys.stderr)

    # Fetch 12-month trend series for top 20 keywords
    TRENDS_TOP_N = int(os.environ.get("GK_OLD_WORD_TRENDS_TOP", "50"))
    if filtered and TRENDS_TOP_N > 0:
        print(f"\n📈 Fetching 12m trends for top {TRENDS_TOP_N}...", file=sys.stderr)
        for idx, item in enumerate(filtered[:TRENDS_TOP_N], start=1):
            kw = item['keyword']
            print(f"  [{idx}/{min(TRENDS_TOP_N, len(filtered))}] {kw}", end=" ", file=sys.stderr)
            task_id = start_pipeline_task(
                stage="old-word.trends",
                idempotency_key=f"trends-quick-12m:{kw}",
                payload={"keyword": kw, "months": 12},
                metadata={"index": idx, "total": min(TRENDS_TOP_N, len(filtered))},
            )
            try:
                resp = curl_json("POST", "/api/research/trends-quick",
                               {"keyword": kw, "months": 12}, timeout=30)
                trends_quick_calls += 1
                record_cost_event(
                    provider="dataforseo",
                    endpoint="trends_quick_12m",
                    unit_type="call",
                    unit_count=1,
                    unit_price_usd=0.009,
                    actual_cost_usd=actual_cost_from_response(resp),
                    task_id=task_id,
                    idempotency_key=f"trends-quick-12m:{kw}",
                    metadata={"keyword": kw, "months": 12, "cost": resp.get("cost")},
                )
                series = resp.get("series", [])
                bm_series = resp.get("benchmarkSeries", [])
                # Merge into single structure for frontend
                if series:
                    merged = {"keyword": series, "benchmark": bm_series}
                    item["trend_series"] = json.dumps(merged)
                else:
                    item["trend_series"] = None
                succeed_pipeline_task(
                    task_id,
                    result={"points": len(series), "benchmark_points": len(bm_series)},
                    metadata={"keyword": kw, "months": 12},
                )
                print(f"→ {len(series)} pts (bm: {len(bm_series)})", file=sys.stderr)
            except Exception as e:
                item["trend_series"] = None
                fail_pipeline_task(
                    task_id,
                    error=str(e),
                    metadata={"keyword": kw, "months": 12},
                )
                print(f"✗ {e}", file=sys.stderr)
            time.sleep(0.5)

    # Save to D1
    saved_count = 0
    finalize_task_id = start_pipeline_task(
        stage="old-word.finalize",
        idempotency_key=f"save:{date}",
        payload={"date": date, "keywords": len(filtered)},
        metadata={"filtered_total": len(filtered)},
    )
    if filtered:
        try:
            resp = curl_json("POST", "/api/admin/old-keywords",
                           {"keywords": filtered}, timeout=60)
            saved_count = int(resp.get('saved', 0) or 0)
            succeed_pipeline_task(
                finalize_task_id,
                result={"saved": saved_count, "submitted": len(filtered)},
                metadata={"date": date},
            )
            print(f"  Saved to D1: {saved_count}", file=sys.stderr)
        except Exception as e:
            fail_pipeline_task(
                finalize_task_id,
                error=str(e),
                metadata={"date": date, "submitted": len(filtered)},
            )
            print(f"  ⚠️ Save failed: {e}", file=sys.stderr)
    else:
        succeed_pipeline_task(
            finalize_task_id,
            status="skipped",
            result={"saved": 0, "submitted": 0},
            metadata={"date": date},
        )

    estimated_cost = keyword_suggestion_calls * 0.013 + trends_quick_calls * 0.009
    update_pipeline_run(
        checked_count=len(seeds),
        saved_count=saved_count,
        estimated_cost_usd=estimated_cost,
        metadata={
            "suggestions_total": len(all_keywords),
            "filtered_total": len(filtered),
            "errors": errors,
            "keyword_suggestion_calls": keyword_suggestion_calls,
            "trends_quick_calls": trends_quick_calls,
        },
    )

    # Report
    report_path = STATE_DIR / f"old-word-report-{date}.md"
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    lines = [f"# 老词机会报告 — {date}", "",
             f"**候选词**: {len(filtered)} | 条件: vol≥{MIN_VOLUME} KD≤{MAX_KD} toolable", "",
             "| # | 关键词 | 月搜索量 | CPC | KD | 竞争 | 评分 | 意图 | 来源 |",
             "|---|--------|---------|-----|----|------|------|------|------|"]
    for idx, item in enumerate(filtered[:50], start=1):
        lines.append(
            f"| {idx} | **{item['keyword']}** | {item.get('volume',0):,} | "
            f"${item.get('cpc',0):.2f} | {item.get('kd',0)} | {item.get('competition','')} | "
            f"{item['score']:.0f} | {item['intent']} | {item['source_seed']} |"
        )
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"  Report: {report_path}", file=sys.stderr)

    if filtered:
        print(f"\n🏆 Top 10:", file=sys.stderr)
        for idx, item in enumerate(filtered[:10], start=1):
            print(f"  {idx}. {item['keyword']} | vol={item.get('volume',0):,} cpc=${item.get('cpc',0):.2f} "
                  f"kd={item.get('kd',0)} score={item['score']:.0f}", file=sys.stderr)


if __name__ == "__main__":
    with pipeline_run("old-word-pipeline") as run_id:
        print(f"run_id={run_id}", file=sys.stderr)
        main()
