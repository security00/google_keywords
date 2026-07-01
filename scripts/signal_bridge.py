#!/usr/bin/env python3
"""
Signal Bridge: feed signal discovery candidates into the main keyword pipeline.

Reads unprocessed candidates from signal_candidates table, submits them
to the Worker's expand endpoint (same path as regular seed keywords),
and marks them as processed.

Usage: python3 signal_bridge.py [--dry-run] [--limit N]

Revert: remove the cron job that runs this script.
"""
import os
import sys
import json
import re
import time
import subprocess
import urllib.request
import ssl

# Config
GK_SITE_URL = os.environ.get("GK_SITE_URL", "https://discoverkeywords.co")
GK_API_KEY = os.environ.get("GK_API_KEY", "")

# CF/D1
CF_TOKEN = os.environ.get("CF_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN", "")
CF_ACCOUNT = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
D1_ID = os.environ.get("D1_DB_ID", "")

EVENT_INTENT_RE = re.compile(
    r"\b(news|breaking|viral|lawsuit|recall|layoff|layoffs|upgrade|upgrades|rollout|leak|leaked|"
    r"score|scores|result|results|live|stream|broadcast|episode|trailer|cast)\b",
    re.I,
)
SPORTS_EVENT_RE = re.compile(
    r"\b(world cup|fifa|uefa|premier league|champions league|nba|nhl|nfl|mlb|rugby|soccer|football|"
    r"cricket|tennis|grand slam|olympics?|qualifier|qualifiers?|match|fixture|fixtures?)\b",
    re.I,
)
BUSINESS_BRAND_RE = re.compile(
    r"\b(mcdonald'?s|burger king|wendy'?s|starbucks|walmart|target|costco|state farm|"
    r"nissan|toyota|ford|tesla|disney|netflix)\b",
    re.I,
)
ENTERTAINMENT_IP_RE = re.compile(
    r"\b(spidey|spider[- ]?man|marvel|dc comics|star wars|harry potter|wu[- ]?tang|disney|pixar|"
    r"naruto|dragon ball|one piece|agent kim|k[- ]?drama|tv drama|drama series|tv series|netflix series)\b",
    re.I,
)
RIGHTS_EVASION_RE = re.compile(
    r"\b(watermark remover|remove watermark|logo remover|remove logo|bypass watermark|"
    r"unlock premium|paywall remover)\b",
    re.I,
)
TITLE_FRAGMENT_RE = re.compile(
    r"\b(ai generated|ai already|contain claude|contains claude|claude across|across multiple|"
    r"already killed|slightly reducing|sprinting towards|comfortably monitor|maker lastpass)\b",
    re.I,
)
GENERIC_PLATFORM_RE = re.compile(
    r"\b(game engine|extensions sdk|extension sdk|language model|prompt injection|performance benchmarks|"
    r"test-driven development|strncpy api|electronic calculator|ai assistant|game boy)\b",
    re.I,
)
REPO_FRAGMENT_RE = re.compile(r"\b[\w.-]+/[\w.-]+\b")
AI_PRODUCT_RE = re.compile(
    r"\b(ai|gpt|llm|claude|gemini|openai|copilot|agent|chatbot|automation|cursor|perplexity)\b",
    re.I,
)
TOOL_RE = re.compile(
    r"\b(tool|tools|builder|generator|creator|maker|checker|converter|analyzer|calculator|"
    r"finder|scanner|detector|solver|optimizer|editor|planner|tracker|monitor|extractor|"
    r"compressor|enhancer|remover|template|workflow|api|sdk|plugin|extension|desktop|browser|"
    r"studio|canvas|assistant|runtime|terminal|workspace|app|software|platform)\b",
    re.I,
)
GAME_RE = re.compile(
    r"\b(game|games|gaming|play|roblox|steam|itch|itchio|minecraft|fortnite|pokemon|pokémon|"
    r"valorant|pubg|obby|simulator|tycoon|tower defense|anime game)\b",
    re.I,
)


def classify_signal_keyword(keyword: str) -> tuple[str, str]:
    """Return (fit, reason) before submitting a signal into paid expand."""
    text = (keyword or "").strip()
    lower = text.lower()
    if not lower:
        return "noise", "empty_keyword"
    if any(ord(ch) > 127 for ch in text):
        return "noise", "non_english_keyword"
    if len(lower) > 80:
        return "noise", "too_long"
    if len(re.findall(r"[a-z0-9]+", lower)) > 6:
        return "noise", "too_many_words"
    if RIGHTS_EVASION_RE.search(lower):
        return "unsafe", "rights_evasion"
    if ENTERTAINMENT_IP_RE.search(lower):
        return "unsafe", "entertainment_ip_or_trademark"
    if TITLE_FRAGMENT_RE.search(lower):
        return "noise", "title_fragment"
    if GENERIC_PLATFORM_RE.search(lower):
        return "noise", "generic_platform_phrase"
    if REPO_FRAGMENT_RE.search(lower):
        return "noise", "repo_fragment"
    if SPORTS_EVENT_RE.search(lower):
        return "general_content", "sports_event"
    if BUSINESS_BRAND_RE.search(lower) and EVENT_INTENT_RE.search(lower):
        return "business_news_event", "brand_news_event"
    if EVENT_INTENT_RE.search(lower) and not (AI_PRODUCT_RE.search(lower) and TOOL_RE.search(lower)):
        return "general_content", "event_or_news_intent"
    if GAME_RE.search(lower):
        return "new_game", "game_candidate"
    if AI_PRODUCT_RE.search(lower) and TOOL_RE.search(lower):
        return "new_tool", "ai_tool_candidate"
    if TOOL_RE.search(lower):
        return "new_tool", "tool_candidate"
    return "noise", "weak_pipeline_fit"


def allow_signal_bridge(keyword: str) -> tuple[bool, str, str]:
    fit, reason = classify_signal_keyword(keyword)
    return fit in {"new_tool", "new_game"}, fit, reason


def d1_query(sql: str, params: list = None) -> list:
    """Execute SQL on D1 and return results."""
    if not (CF_TOKEN and CF_ACCOUNT and D1_ID):
        print("ERROR: CF credentials not configured", file=sys.stderr)
        sys.exit(1)

    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/d1/database/{D1_ID}/query"
    payload = {"sql": sql}
    if params:
        payload["params"] = params

    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {CF_TOKEN}",
        "Content-Type": "application/json",
    })
    ctx = ssl.create_default_context()
    resp = json.loads(urllib.request.urlopen(req, context=ctx, timeout=30).read())

    if not resp.get("success"):
        raise Exception(f"D1 query failed: {resp}")
    return resp["result"][0]["results"]


def curl_post(path: str, body: dict, timeout: int = 120):
    """POST to Worker API via curl (same approach as precompute.py)."""
    url = f"{GK_SITE_URL}{path}"
    payload = json.dumps(body)
    cmd = [
        "curl", "-sL", "--max-time", str(timeout), url,
        "-H", "Content-Type: application/json",
        "-H", f"Authorization: Bearer {GK_API_KEY}",
        "-d", payload,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 10)
        if result.returncode != 0:
            return None, f"curl exit {result.returncode}: {result.stderr[:200]}"
        return json.loads(result.stdout), None
    except json.JSONDecodeError as e:
        return None, f"JSON parse error: {e}"
    except subprocess.TimeoutExpired:
        return None, "curl timed out"
    except Exception as e:
        return None, str(e)


def main():
    if not GK_API_KEY:
        print("ERROR: GK_API_KEY env var required", file=sys.stderr)
        sys.exit(1)

    import argparse
    parser = argparse.ArgumentParser(description="Feed signal candidates into the expand pipeline.")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be submitted, don't actually submit")
    parser.add_argument("--limit", type=int, default=20, help="Max candidates to process (default: 20)")
    args = parser.parse_args()

    ts = time.strftime("%Y-%m-%d %H:%M UTC")
    print(f"🚀 Signal Bridge — {ts}", file=sys.stderr)

    # Fetch admin-approved, unprocessed candidates.
    try:
        rows = d1_query(
            "SELECT id, keyword, keyword_normalized, signal_score, signal_sources, avg_hotness "
            "FROM signal_candidates "
            "WHERE processed = 0 AND accepted LIKE 'accepted:%' "
            "ORDER BY signal_score DESC LIMIT ?",
            [args.limit]
        )
    except Exception as e:
        print(f"ERROR: Failed to query signal_candidates: {e}", file=sys.stderr)
        sys.exit(1)

    if not rows:
        print("No unprocessed signal candidates found.", file=sys.stderr)
        return

    print(f"Found {len(rows)} unprocessed candidates", file=sys.stderr)

    if args.dry_run:
        print(f"\nWould submit {len(rows)} candidates (dry run):", file=sys.stderr)
        for r in rows:
            kw = r["keyword"]
            score = r["signal_score"]
            allowed, fit, reason = allow_signal_bridge(kw)
            action = "submit" if allowed else "block"
            print(f"  • {kw:45s} (signal_score={score:.1f}, action={action}, fit={fit}, reason={reason})", file=sys.stderr)
        return

    # Submit each candidate to the expand pipeline
    submitted = 0
    blocked = 0
    failed = 0
    for r in rows:
        kw = r["keyword"]
        cid = r["id"]

        allowed, fit, reason = allow_signal_bridge(kw)
        if not allowed:
            print(f"  ⛔ block: {kw} ({fit}:{reason})", file=sys.stderr)
            try:
                d1_query(
                    "UPDATE signal_candidates SET processed = 1, accepted = ? WHERE id = ?",
                    [f"rejected:{fit}:{reason}", cid],
                )
            except Exception as e:
                print(f"WARNING: Failed to mark blocked signal {kw}: {e}", file=sys.stderr)
            blocked += 1
            continue

        body = {
            "keywords": [kw],
            "postbackUrl": f"{GK_SITE_URL}/api/research/webhook",
        }

        print(f"  → expand: {kw}...", end=" ", file=sys.stderr)
        resp, err = curl_post("/api/research/expand", body)
        if err:
            print(f"FAILED: {err}", file=sys.stderr)
            failed += 1
            continue

        # Mark as processed in D1
        try:
            d1_query(
                "UPDATE signal_candidates SET processed = 1, accepted = ? WHERE id = ?",
                [f"accepted:{fit}:{reason}", cid],
            )
        except Exception as e:
            print(f"WARNING: Failed to mark {kw} as processed: {e}", file=sys.stderr)

        print(f"OK (job_id={resp.get('jobId', '?')})", file=sys.stderr)
        submitted += 1

        # Brief pause between submissions
        time.sleep(0.5)

    print(f"\n✅ Bridge complete: {submitted} submitted, {blocked} blocked, {failed} failed", file=sys.stderr)


if __name__ == "__main__":
    main()
