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
    from scripts.pipeline_runtime import pipeline_run, record_cost_event, update_pipeline_run
except ModuleNotFoundError:
    from pipeline_runtime import pipeline_run, record_cost_event, update_pipeline_run

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


def opportunity_score(volume: int, kd: int, cpc: float) -> float:
    kd = min(kd, 100)
    if cpc >= 5: cpc_w = 1.5
    elif cpc >= 2: cpc_w = 1.2
    elif cpc >= 1: cpc_w = 1.0
    else: cpc_w = 0.8
    return round(volume * (100 - kd) / 100 * cpc_w, 1)


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
        try:
            resp = curl_json("POST", "/api/research/keyword-suggestions",
                           {"keyword": query, "limit": LIMIT_PER_SEED}, timeout=60)
            keyword_suggestion_calls += 1
            record_cost_event(
                provider="dataforseo",
                endpoint="keyword_suggestions",
                unit_type="seed",
                unit_count=1,
                unit_price_usd=0.013,
                metadata={"seed": seed, "query": query, "limit": LIMIT_PER_SEED},
            )
            items = resp.get("items", [])
            print(f"→ {len(items)} suggestions", file=sys.stderr)
            for item in items:
                kw = normalize_keyword(item.get("keyword", ""))
                if not kw or is_noise(kw):
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
        except Exception as e:
            errors += 1
            print(f"✗ {e}", file=sys.stderr)
        time.sleep(SLEEP_SECONDS)

    # Filter
    filtered = [
        item for item in all_keywords.values()
        if item["intent"] in ("transactional", "commercial")
        and item.get("volume", 0) >= MIN_VOLUME
        and item.get("cpc", 0) > 0
        and item.get("kd", 0) <= MAX_KD
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
            try:
                resp = curl_json("POST", "/api/research/trends-quick",
                               {"keyword": kw, "months": 12}, timeout=30)
                trends_quick_calls += 1
                record_cost_event(
                    provider="dataforseo",
                    endpoint="trends_quick_12m",
                    unit_type="keyword",
                    unit_count=1,
                    unit_price_usd=0.005,
                    metadata={"keyword": kw, "months": 12},
                )
                series = resp.get("series", [])
                bm_series = resp.get("benchmarkSeries", [])
                # Merge into single structure for frontend
                if series:
                    merged = {"keyword": series, "benchmark": bm_series}
                    item["trend_series"] = json.dumps(merged)
                else:
                    item["trend_series"] = None
                print(f"→ {len(series)} pts (bm: {len(bm_series)})", file=sys.stderr)
            except Exception as e:
                item["trend_series"] = None
                print(f"✗ {e}", file=sys.stderr)
            time.sleep(0.5)

    # Save to D1
    saved_count = 0
    if filtered:
        try:
            resp = curl_json("POST", "/api/admin/old-keywords",
                           {"keywords": filtered}, timeout=60)
            saved_count = int(resp.get('saved', 0) or 0)
            print(f"  Saved to D1: {saved_count}", file=sys.stderr)
        except Exception as e:
            print(f"  ⚠️ Save failed: {e}", file=sys.stderr)

    estimated_cost = keyword_suggestion_calls * 0.013 + trends_quick_calls * 0.005
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
