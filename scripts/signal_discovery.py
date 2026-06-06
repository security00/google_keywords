#!/usr/bin/env python3
"""
Signal Discovery — 多源信号采集 + 关键词发现。

每天定时运行：
  1. 采集 Reddit + HN + 后续其他源
  2. 提取关键词候选
  3. 与已有候选池去重
  4. 对新候选词查 DataForSEO volume
  5. 输出：飞书 Top 10 + D1 入库

用法：
  python3 scripts/signal_discovery.py                    # 正常跑
  python3 scripts/signal_discovery.py --dry-run          # 只采集不写库
  python3 scripts/signal_discovery.py --hours 48         # 回看 48 小时
  python3 scripts/signal_discovery.py --no-dataforseo    # 跳过 DataForSEO 查询
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from signal_collector.pipeline import SignalDiscoveryPipeline, DEFAULT_CONFIG
from signal_collector.models import KeywordCandidate

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("signal_discovery")


def load_known_keywords() -> set:
    """Load known keywords from the existing expand candidates pool.

    Returns set of normalized keywords already in the system.
    """
    # Check D1 for existing keywords
    cf_token = os.environ.get("CF_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN")
    cf_account = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    d1_id = os.environ.get("D1_DB_ID", "")

    if not (cf_token and cf_account and d1_id):
        logger.warning("No CF credentials, skipping known keyword lookup")
        return set()

    try:
        import ssl
        import urllib.request

        url = f"https://api.cloudflare.com/client/v4/accounts/{cf_account}/d1/database/{d1_id}/query"

        # Get from existing candidates table
        sql = """SELECT DISTINCT LOWER(keyword) FROM candidates
                 UNION SELECT DISTINCT LOWER(keyword) FROM old_keyword_opportunities
                 UNION SELECT DISTINCT LOWER(keyword) FROM signal_candidates"""
        payload = json.dumps({"sql": sql, "params": []}).encode()

        req = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Authorization": f"Bearer {cf_token}",
                "Content-Type": "application/json",
            },
        )
        ctx = ssl.create_default_context()
        resp = json.loads(urllib.request.urlopen(req, context=ctx, timeout=15).read())

        if resp.get("success") and resp.get("result"):
            rows = resp["result"][0].get("results", [])
            known = set()
            for row in rows:
                for val in row.values():
                    if val:
                        known.add(str(val).strip().lower())
            logger.info("Loaded %d known keywords from D1", len(known))
            return known
    except Exception as e:
        logger.warning("Failed to load known keywords from D1: %s", e)

    return set()


def check_dataforseo_volume(keywords: list[str]) -> dict:
    """Query DataForSEO for search volume of keyword candidates.

    Returns dict of keyword -> volume info.
    """
    # Build API call
    login = os.environ.get("DATAFORSEO_LOGIN", "")
    password = os.environ.get("DATAFORSEO_PASSWORD", "")

    if not (login and password):
        logger.warning("No DataForSEO credentials, skipping volume check")
        return {}

    try:
        import base64
        import ssl
        import urllib.request

        auth = base64.b64encode(f"{login}:{password}".encode()).decode()

        # DataForSEO v3 API — 批量查询 Google keyword suggestions
        # We use /dataforseo_labs/google/bulk_keyword_volume/live
        payload = json.dumps(keywords).encode()

        req = urllib.request.Request(
            "https://api.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_volume/live",
            data=payload,
            headers={
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/json",
            },
        )
        ctx = ssl.create_default_context()
        resp = json.loads(urllib.request.urlopen(req, context=ctx, timeout=30).read())

        results = {}
        if resp.get("tasks"):
            for task in resp["tasks"]:
                if task.get("result"):
                    for r in task["result"]:
                        kw = r.get("keyword", "").lower().strip()
                        results[kw] = {
                            "volume": r.get("keyword_data", {}).get("keyword_info", {}).get("search_volume", 0),
                            "cpc": r.get("keyword_data", {}).get("keyword_info", {}).get("cpc", 0),
                        }
        logger.info("DataForSEO volume: checked %d keywords, got %d results",
                     len(keywords), len(results))
        return results

    except Exception as e:
        logger.warning("DataForSEO volume check failed: %s", e)
        return {}


def save_candidates_to_d1(candidates: list[KeywordCandidate], volume_data: dict) -> int:
    """Save keyword candidates to D1 signal_candidates table.

    Returns count of saved candidates.
    """
    cf_token = os.environ.get("CF_API_TOKEN") or os.environ.get("CLOUDFLARE_API_TOKEN")
    cf_account = os.environ.get("CF_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    d1_id = os.environ.get("D1_DB_ID", "")

    if not (cf_token and cf_account and d1_id):
        logger.warning("No CF credentials, skipping D1 save")
        return 0

    try:
        import ssl
        import uuid
        import urllib.request

        now = datetime.now(timezone.utc).isoformat()
        saved = 0

        for c in candidates:
            kw = c.keyword_normalized
            vol = volume_data.get(kw, {})
            signal_sources = json.dumps({
                s.provider.value: s.title for s in c.source_signals
            })

            sql = """INSERT OR IGNORE INTO signal_candidates
                     (id, keyword, keyword_normalized, signal_sources,
                      signal_score, avg_hotness, first_seen_at, last_seen_at,
                      dataforseo_volume, dataforseo_kd, dataforseo_cpc,
                      processed, accepted, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, NULL, ?)"""

            params = [
                str(uuid.uuid4()),
                c.keyword,
                kw,
                signal_sources,
                c.source_count * 5 + (c.avg_hotness / 10),
                c.avg_hotness,
                c.first_seen_at.isoformat(),
                c.last_seen_at.isoformat(),
                vol.get("volume", 0),
                vol.get("cpc", 0),
                now,
            ]

            payload = json.dumps({"sql": sql, "params": params}).encode()
            req = urllib.request.Request(
                f"https://api.cloudflare.com/client/v4/accounts/{cf_account}/d1/database/{d1_id}/query",
                data=payload,
                headers={
                    "Authorization": f"Bearer {cf_token}",
                    "Content-Type": "application/json",
                },
            )
            ctx = ssl.create_default_context()
            resp = json.loads(urllib.request.urlopen(req, context=ctx, timeout=15).read())

            if resp.get("success"):
                saved += 1

        logger.info("Saved %d/%d candidates to D1", saved, len(candidates))
        return saved

    except Exception as e:
        logger.warning("Failed to save to D1: %s", e)
        return 0


def format_top10_text(candidates: list[KeywordCandidate], volume_data: dict) -> str:
    """Format top 10 candidates as markdown for Feishu/Telegram push."""
    lines = []
    lines.append(f"🔔 信号发现 Top 10 | {datetime.now(timezone.utc).strftime('%Y-%m-%d')}")
    lines.append("")

    for i, c in enumerate(candidates[:10], 1):
        kw = c.keyword
        vol = volume_data.get(c.keyword_normalized, {})

        # Source breakdown
        providers = {}
        for s in c.source_signals:
            p = s.provider.value
            if p not in providers:
                providers[p] = []
            if hasattr(s, 'metadata') and s.metadata.get("subreddit"):
                providers[p].append(f"r/{s.metadata['subreddit']}")
            else:
                providers[p].append(s.title[:40])

        # Source breakdown
        src_labels = []
        for s in c.source_signals:
            p = s.provider.value
            if p == "reddit":
                sub = s.metadata.get("subreddit", "reddit")
                src_labels.append(f"r/{sub}")
            elif p == "hackernews":
                src_labels.append("HN")
            elif p == "rss":
                fn = s.metadata.get("feed_name", "RSS")
                src_labels.append(fn)
            elif p == "github_trending":
                repo = s.metadata.get("repo", "GitHub")
                src_labels.append(repo)
            else:
                src_labels.append(p)
        src_str = ", ".join(sorted(set(src_labels)))[:60]
        vol_str = str(vol.get("volume", "")) if vol.get("volume", 0) > 0 else "-"

        lines.append(f"{i}. **{kw}** (分:{c.avg_hotness:.0f})")
        lines.append(f"   源: {src_str} | 搜索量: {vol_str}")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Signal Discovery Pipeline")
    parser.add_argument("--dry-run", action="store_true", help="Only collect, don't write")
    parser.add_argument("--hours", type=int, default=24, help="Look back hours")
    parser.add_argument("--no-dataforseo", action="store_true", help="Skip DataForSEO volume")
    parser.add_argument("--top-k", type=int, default=10, help="Top K to display")
    args = parser.parse_args()

    logger.info("🚀 Signal Discovery starting (hours=%d, dry_run=%s)",
                args.hours, args.dry_run)

    # Step 1: Collect signals
    import asyncio

    async def _run():
        pipeline = SignalDiscoveryPipeline()
        return await pipeline.run(hours_back=args.hours)

    candidates = asyncio.run(_run())

    logger.info("Collected %d keyword candidates", len(candidates))

    if not candidates:
        logger.info("No candidates found, exiting")
        return

    # Step 2: Load known keywords for dedup
    known = load_known_keywords()
    new_candidates = [c for c in candidates if c.keyword_normalized not in known]
    logger.info("After dedup: %d new of %d total", len(new_candidates), len(candidates))

    if not new_candidates:
        logger.info("All candidates already known, nothing new to push")
        return

    # Step 3: Check DataForSEO volume
    volume_data = {}
    if not args.no_dataforseo:
        unique_kws = list(dict.fromkeys(
            c.keyword_normalized for c in new_candidates[:30]
        ))
        volume_data = check_dataforseo_volume(unique_kws)
    else:
        logger.info("--no-dataforseo set, skipping volume check")

    # Step 4: Save to D1 (unless dry run)
    if not args.dry_run:
        saved = save_candidates_to_d1(new_candidates[:50], volume_data)
        logger.info("Saved %d candidates to D1", saved)

    # Step 5: Output per-source top 3
    from collections import defaultdict
    by_source = defaultdict(list)
    for c in new_candidates:
        src = c.source_signals[0].provider.value
        vol = volume_data.get(c.keyword_normalized, {}).get("volume", 0)
        vol_score = min(vol / 100, 100)
        hotness = c.avg_hotness if src == "hackernews" else c.avg_hotness + 30
        by_source[src].append((hotness + vol_score, c))

    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    lines = []
    lines.append("=" * 60)
    lines.append(f"信号发现 {today}")
    lines.append("=" * 60)
    for src, label in [("hackernews", "HN"), ("reddit", "Reddit"), ("rss", "RSS"), ("github_trending", "GitHub")]:
        items = by_source.get(src, [])
        if not items:
            continue
        items.sort(key=lambda x: x[0], reverse=True)
        lines.append(f"\n📡 {label} (Top {min(3, len(items))} of {len(items)}):")
        for score, c in items[:3]:
            meta = c.source_signals[0].metadata
            ctx = meta.get('subreddit', '') or meta.get('feed_name', '') or meta.get('repo', '') or ''
            ctx_str = f" [{ctx}]" if ctx else ""
            vol_str = str(volume_data.get(c.keyword_normalized, {}).get("volume", "")) or "-"
            lines.append(f"  \u2022 {c.keyword}{ctx_str} (\u641c\u7d22\u91cf: {vol_str})")
    lines.append("\n" + "=" * 60)
    output = "\n".join(lines)
    print(output)
    logger.info("\n" + output)

    logger.info("✅ Signal Discovery complete")


if __name__ == "__main__":
    main()
