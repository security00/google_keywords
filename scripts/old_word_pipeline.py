#!/usr/bin/env python3
"""
Old-word pipeline: find low-competition keyword opportunities from DataForSEO keyword_suggestions.

This is a SEPARATE pipeline from the new-word (trends-driven) pipeline.
It finds keywords with established search volume but low competition — ideal for tool sites.

Flow:
1. Read 127 seed keywords
2. Call DataForSEO keyword_suggestions for each seed (limit=20 per seed)
3. Filter: intent=transactional/commercial, volume>=500, KD<=35, toolable
4. Score: volume * (100-KD) / 100 * cpc_weight
5. Store results in D1 (old_keyword_opportunities table)
6. Output report

Cost: ~$0.013 per seed × 127 = ~$1.65 per run (weekly recommended)
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

GK_SITE_URL = os.environ.get("GK_SITE_URL", "https://discoverkeywords.co")
GK_API_KEY = os.environ.get("GK_API_KEY", "")
GK_CRON_SECRET = os.environ.get("GK_CRON_SECRET", os.environ.get("CRON_SECRET", ""))

# DataForSEO credentials (used for direct API calls)
DATAFORSEO_LOGIN = os.environ.get("DATAFORSEO_LOGIN", "")
DATAFORSEO_PASSWORD = os.environ.get("DATAFORSEO_PASSWORD", "")
DATAFORSEO_BASE_URL = "https://api.dataforseo.com/v3"

SEED_FILE = Path(
    os.environ.get("GK_SEED_FILE", "/root/clawd/projects/google_keywords/config/shared-keyword-defaults.json")
)
STATE_DIR = Path(os.environ.get("GK_PRECOMPUTE_STATE_DIR", "/root/.local/state/google_keywords"))
SHARED_TIMEZONE = ZoneInfo(os.environ.get("GK_PRECOMPUTE_TIMEZONE", "Asia/Shanghai"))

LIMIT_PER_SEED = int(os.environ.get("GK_OLD_WORD_LIMIT_PER_SEED", "20"))
MAX_SEEDS = int(os.environ.get("GK_OLD_WORD_MAX_SEEDS", "0"))  # 0 = all
SLEEP_SECONDS = float(os.environ.get("GK_OLD_WORD_SLEEP", "1.0"))

# Filters
MIN_VOLUME = int(os.environ.get("GK_OLD_WORD_MIN_VOLUME", "500"))
MAX_KD = int(os.environ.get("GK_OLD_WORD_MAX_KD", "35"))

# Tool-related suffixes — only keep keywords that can become tool sites
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

INFORMATIONAL_WORDS = {
    "what is", "how to", "guide", "tutorial", "faq", "example", "sample",
}


def now_bj():
    return datetime.now(timezone.utc).astimezone(SHARED_TIMEZONE)


def today_str():
    return now_bj().strftime("%Y-%m-%d")


def load_seeds():
    if not SEED_FILE.exists():
        raise RuntimeError(f"Seed file not found: {SEED_FILE}")
    data = json.loads(SEED_FILE.read_text())
    keywords = data.get("defaultKeywords", [])
    seeds = [kw.strip() for kw in keywords if isinstance(kw, str) and kw.strip()]
    if MAX_SEEDS > 0:
        seeds = seeds[:MAX_SEEDS]
    return seeds


def normalize_keyword(text: str) -> str:
    import re
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
    """Higher = better opportunity. Volume weighted by ease (100-KD) and CPC."""
    kd = min(kd, 100)
    if cpc >= 5:
        cpc_weight = 1.5
    elif cpc >= 2:
        cpc_weight = 1.2
    elif cpc >= 1:
        cpc_weight = 1.0
    else:
        cpc_weight = 0.8
    return round(volume * (100 - kd) / 100 * cpc_weight, 1)


def dataforseo_post(endpoint: str, payload: list, timeout: int = 60) -> dict:
    """Direct DataForSEO API call with Basic auth."""
    import requests
    resp = requests.post(
        f"{DATAFORSEO_BASE_URL}/{endpoint}",
        json=payload,
        auth=(DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD),
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_keyword_suggestions(seed_keyword: str, limit: int = 20) -> list[dict]:
    """Fetch keyword suggestions from DataForSEO Labs."""
    response = dataforseo_post("dataforseo_labs/google/keyword_suggestions/live", [{
        "keyword": seed_keyword,
        "location_code": 2840,
        "language_code": "en",
        "include_seed_keyword": True,
        "limit": limit,
    }])

    items = []
    for task in response.get("tasks", []):
        for result in task.get("result", []):
            for item in (result.get("items") or []):
                info = item.get("keyword_info", {}) or {}
                props = item.get("keyword_properties", {}) or {}
                kw = item.get("keyword", "")
                if not kw:
                    continue
                items.append({
                    "keyword": kw,
                    "volume": info.get("search_volume", 0) or 0,
                    "cpc": info.get("cpc", 0) or 0,
                    "competition": info.get("competition_level", "") or "",
                    "kd": props.get("keyword_difficulty", 0) or 0,
                    "source_seed": seed_keyword,
                })
    return items


def curl_json(method, path, body=None, timeout=30, extra_headers=None):
    """Call discoverkeywords.co API via curl."""
    url = f"{GK_SITE_URL}{path}"
    cmd = [
        "curl", "-sS", "-L", "--max-time", str(timeout),
        "-X", method, url,
        "-H", "Content-Type: application/json",
        "-H", f"Authorization: Bearer {GK_API_KEY}",
    ]
    for name, value in (extra_headers or {}).items():
        cmd.extend(["-H", f"{name}: {value}"])
    input_payload = json.dumps(body) if body else None
    result = subprocess.run(
        cmd, input=input_payload, capture_output=True, text=True, timeout=timeout + 10,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"curl failed with exit {result.returncode}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"failed to parse JSON: {exc}") from exc


def save_results_to_d1(results: list[dict]):
    """Save old-word opportunities to D1 via the site API."""
    if not results:
        return 0
    
    # Send in batches of 50
    batch_size = 50
    total_saved = 0
    for i in range(0, len(results), batch_size):
        batch = results[i:i + batch_size]
        try:
            resp = curl_json(
                "POST",
                "/api/admin/old-keywords",
                body={"keywords": batch},
                timeout=60,
                extra_headers={"x-cron-secret": GK_CRON_SECRET} if GK_CRON_SECRET else None,
            )
            saved = resp.get("saved", 0)
            total_saved += saved
        except Exception as e:
            print(f"⚠️  Failed to save batch: {e}", file=sys.stderr)
    return total_saved


def generate_report(results: list[dict], date: str) -> str:
    """Generate markdown report."""
    lines = [
        f"# 老词机会报告 — {date}",
        "",
        f"**候选词数**: {len(results)} | **筛选条件**: volume≥{MIN_VOLUME}, KD≤{MAX_KD}, toolable",
        "",
        "| # | 关键词 | 月搜索量 | CPC | KD | 竞争 | 评分 | 意图 | 来源种子 |",
        "|---|--------|---------|-----|----|------|------|------|---------|",
    ]
    for idx, item in enumerate(results[:50], start=1):
        lines.append(
            f"| {idx} | **{item['keyword']}** | "
            f"{item['volume']:,} | ${item['cpc']:.2f} | "
            f"{item['kd']} | {item['competition']} | "
            f"{item['score']:.0f} | {item['intent']} | {item['source_seed']} |"
        )
    return "\n".join(lines)


def main():
    if not DATAFORSEO_LOGIN or not DATAFORSEO_PASSWORD:
        print("❌ DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD required", file=sys.stderr)
        sys.exit(1)
    if not GK_API_KEY:
        print("❌ GK_API_KEY required", file=sys.stderr)
        sys.exit(1)

    date = today_str()
    seeds = load_seeds()

    print(f"=== Old Word Pipeline ({date}) ===", file=sys.stderr)
    print(f"Seeds: {len(seeds)} | Limit/seed: {LIMIT_PER_SEED} | Min vol: {MIN_VOLUME} | Max KD: {MAX_KD}", file=sys.stderr)
    print(f"Estimated cost: ${len(seeds) * 0.013:.2f}", file=sys.stderr)
    print(file=sys.stderr)

    all_keywords = {}  # normalized -> item dict
    total_cost = 0.0
    errors = 0

    for idx, seed in enumerate(seeds, start=1):
        # Prefix with "ai " if not already
        query = seed if seed.lower().startswith("ai ") else f"ai {seed}"
        print(f"[{idx}/{len(seeds)}] {query}", end=" ", file=sys.stderr)
        try:
            suggestions = fetch_keyword_suggestions(query, limit=LIMIT_PER_SEED)
            total_cost += 0.013
            print(f"→ {len(suggestions)} suggestions", file=sys.stderr)
            for item in suggestions:
                kw = normalize_keyword(item["keyword"])
                if not kw or is_noise(kw):
                    continue
                intent = classify_intent(kw)
                toolable = is_toolable(kw)
                score = opportunity_score(item["volume"], item["kd"], item["cpc"])
                enriched = {
                    **item,
                    "intent": intent,
                    "toolable": toolable,
                    "score": score,
                }
                # Keep highest score if duplicate
                existing = all_keywords.get(kw)
                if not existing or score > existing.get("score", 0):
                    all_keywords[kw] = enriched
        except Exception as e:
            errors += 1
            print(f"✗ {e}", file=sys.stderr)
        time.sleep(SLEEP_SECONDS)

    # Filter: only keep qualifying keywords
    filtered = [
        item for item in all_keywords.values()
        if item["intent"] in ("transactional", "commercial")
        and item["volume"] >= MIN_VOLUME
        and item["kd"] <= MAX_KD
        and item["competition"] in ("LOW", "MEDIUM", "")
        and item["toolable"]
    ]
    filtered.sort(key=lambda x: x["score"], reverse=True)

    print(f"\n📊 Results:", file=sys.stderr)
    print(f"  Total suggestions: {len(all_keywords)}", file=sys.stderr)
    print(f"  After filter: {len(filtered)}", file=sys.stderr)
    print(f"  Cost: ${total_cost:.2f}", file=sys.stderr)
    print(f"  Errors: {errors}", file=sys.stderr)

    # Save to D1
    if filtered:
        saved = save_results_to_d1(filtered)
        print(f"  Saved to D1: {saved}", file=sys.stderr)

    # Generate report
    report = generate_report(filtered, date)
    report_path = STATE_DIR / f"old-word-report-{date}.md"
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report, encoding="utf-8")
    print(f"  Report: {report_path}", file=sys.stderr)

    # Print top 20
    if filtered:
        print(f"\n🏆 Top 20 opportunities:", file=sys.stderr)
        for idx, item in enumerate(filtered[:20], start=1):
            print(
                f"  {idx:>2}. {item['keyword']} | "
                f"vol={item['volume']:,} cpc=${item['cpc']:.2f} "
                f"kd={item['kd']} score={item['score']:.0f} | "
                f"seed={item['source_seed']}",
                file=sys.stderr,
            )


if __name__ == "__main__":
    main()
