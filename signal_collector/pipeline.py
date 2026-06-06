"""Signal discovery pipeline — orchestrates multi-source collection and keyword extraction."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import httpx

from .models import SignalItem, SignalProvider, KeywordCandidate
from .extractor import extract_keywords_from_items
from .collectors.hackernews import HackerNewsScraper
from .collectors.reddit import RedditScraper
from .collectors.rss import RSSScraper
from .collectors.github_trending import GitHubTrendingScraper

logger = logging.getLogger(__name__)


DEFAULT_CONFIG: dict = {
    "hackernews": {
        "enabled": True,
        "fetch_top_stories": 50,
        "fetch_new_stories": 30,
        "min_score": 50,
    },
    "reddit": {
        "enabled": True,
        "subreddits": [
            "SEO",
            "juststart",
            "blogging",
            "smallbusiness",
            "Entrepreneur",
            "webdev",
            "sideproject",
            "startups",
            "digital_marketing",
            "content_marketing",
        ],
        "sort": "hot",
        "fetch_limit": 25,
    },
    "rss": {
        "enabled": True,
        "max_per_feed": 10,
        # feeds defined in rss.py DEFAULT_FEEDS, can override here
    },
    "github_trending": {
        "enabled": True,
        "period": "past_24_hours",
        "languages": ["All", "Python", "TypeScript", "JavaScript", "Rust", "Go"],
        "min_stars": 20,
        "max_items": 30,
    },
}


class SignalDiscoveryPipeline:
    """Orchestrates signal collection from multiple sources."""

    def __init__(self, config: Optional[dict] = None):
        self.config = config or DEFAULT_CONFIG
        self._results: Dict[str, List[SignalItem]] = {}

    async def run(self, hours_back: int = 24) -> List[KeywordCandidate]:
        """Run full signal discovery pipeline."""
        since = datetime.now(timezone.utc) - timedelta(hours=hours_back)
        logger.info("Signal pipeline starting, collecting since %s", since.isoformat())

        async with httpx.AsyncClient(timeout=30.0) as client:
            all_items = await self._fetch_all(since, client)

        logger.info("Collected %d total signal items", len(all_items))

        if not all_items:
            logger.info("No signal items collected, nothing to extract")
            return []

        candidates = extract_keywords_from_items(all_items)

        # Annotate candidates with source info for downstream display
        source_counts: Dict[str, int] = {}
        for c in candidates:
            for s in c.source_signals:
                p = s.provider.value
                source_counts[p] = source_counts.get(p, 0) + 1
        logger.info("Candidate source breakdown: %s", source_counts)

        return candidates

    async def _fetch_all(
        self, since: datetime, client: httpx.AsyncClient
    ) -> List[SignalItem]:
        """Fetch from all enabled sources concurrently."""
        tasks = []
        source_names = []

        hn_cfg = self.config.get("hackernews", {})
        if hn_cfg.get("enabled", True):
            hn_scraper = HackerNewsScraper(hn_cfg, client)
            tasks.append(self._fetch_source("HN", hn_scraper, since))
            source_names.append("HN")

        reddit_cfg = self.config.get("reddit", {})
        if reddit_cfg.get("enabled", True):
            reddit_scraper = RedditScraper(reddit_cfg, client)
            tasks.append(self._fetch_source("Reddit", reddit_scraper, since))
            source_names.append("Reddit")

        rss_cfg = self.config.get("rss", {})
        if rss_cfg.get("enabled", True):
            rss_scraper = RSSScraper(rss_cfg, client)
            tasks.append(self._fetch_source("RSS", rss_scraper, since))
            source_names.append("RSS")

        gh_cfg = self.config.get("github_trending", {})
        if gh_cfg.get("enabled", True):
            gh_scraper = GitHubTrendingScraper(gh_cfg, client)
            tasks.append(self._fetch_source("GitHub Trending", gh_scraper, since))
            source_names.append("GitHub Trending")

        if not tasks:
            logger.warning("No sources enabled in config")
            return []

        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_items = []
        for name, result in zip(source_names, results):
            if isinstance(result, Exception):
                logger.error("  %s fetch failed: %s", name, result)
                continue
            all_items.extend(result)

        # Dedup by URL
        seen_urls = set()
        deduped = []
        for item in all_items:
            url_key = item.url.rstrip("/").lower()
            if url_key not in seen_urls:
                seen_urls.add(url_key)
                deduped.append(item)

        if len(deduped) < len(all_items):
            logger.info("Dedup removed %d duplicate URLs", len(all_items) - len(deduped))

        return deduped

    async def _fetch_source(self, name: str, scraper, since: datetime) -> List[SignalItem]:
        logger.info("Fetching from %s...", name)
        try:
            items = await scraper.fetch(since)
            logger.info("  %s: %d items", name, len(items))
            return items
        except Exception as e:
            logger.error("  %s fetch failed: %s", name, e)
            return []

    def get_source_summary(self) -> str:
        """Get a summary of what was collected per source."""
        lines = []
        for source, items in self._results.items():
            lines.append(f"  • {source}: {len(items)} items")
        return "\n".join(lines)


def run_pipeline(config: Optional[dict] = None, hours_back: int = 24) -> List[KeywordCandidate]:
    pipeline = SignalDiscoveryPipeline(config)
    return asyncio.run(pipeline.run(hours_back=hours_back))
