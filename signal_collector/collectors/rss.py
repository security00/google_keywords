"""RSS signal collector — industry blog feeds for keyword discovery.

Adapted from Thysrael/Horizon (src/scrapers/rss.py).
Monitors SEO/marketing/tech blogs for emerging topics.
"""

import logging
import re
from datetime import datetime, timezone
from typing import List, Optional

import feedparser
import httpx

from ..base import BaseSignalScraper
from ..models import SignalItem, SignalProvider

logger = logging.getLogger(__name__)

# Default RSS feeds — SEO and marketing industry
DEFAULT_FEEDS = [
    # SEO
    {"name": "Ahrefs Blog", "url": "https://ahrefs.com/blog/feed/", "category": "seo"},
    {"name": "Moz Blog", "url": "https://moz.com/feed", "category": "seo"},
    {"name": "Search Engine Land", "url": "https://searchengineland.com/feed", "category": "seo"},
    {"name": "Search Engine Journal", "url": "https://www.searchenginejournal.com/feed", "category": "seo"},
    {"name": "Google Search Central", "url": "https://developers.google.com/search/blog/feeds/recent.xml", "category": "seo"},
    # Content Marketing
    {"name": "Content Marketing Institute", "url": "https://contentmarketinginstitute.com/feed/", "category": "content"},
    {"name": "Copyblogger", "url": "https://copyblogger.com/feed/", "category": "content"},
    # Tech / Startup
    {"name": "TechCrunch", "url": "https://techcrunch.com/feed/", "category": "tech"},
    {"name": "Product Hunt", "url": "https://www.producthunt.com/feed", "category": "tech"},
    # AI / LLM
    {"name": "Import AI", "url": "https://jack-clark.net/feed/", "category": "ai"},
]


class RSSScraper(BaseSignalScraper):
    """Scrape RSS feeds for keyword discovery."""

    def __init__(self, config: dict, http_client: httpx.AsyncClient):
        super().__init__(config, http_client)
        self.feeds = config.get("feeds", DEFAULT_FEEDS)
        self.max_per_feed = config.get("max_per_feed", 10)

    async def fetch(self, since: datetime) -> List[SignalItem]:
        """Fetch items from all configured RSS feeds."""
        import asyncio

        if not self.feeds:
            logger.info("RSS: no feeds configured, skipping")
            return []

        tasks = [self._fetch_feed(feed, since) for feed in self.feeds]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_items = []
        for result in results:
            if isinstance(result, Exception):
                logger.warning("RSS feed fetch failed: %s", result)
                continue
            all_items.extend(result[:self.max_per_feed])

        all_items.sort(key=lambda x: x.published_at, reverse=True)
        logger.info("RSS: collected %d items from %d feeds",
                    len(all_items), len([r for r in results if not isinstance(r, Exception)]))
        return all_items

    async def _fetch_feed(self, feed_cfg: dict, since: datetime) -> List[SignalItem]:
        name = feed_cfg.get("name", "unknown")
        url = feed_cfg["url"]
        category = feed_cfg.get("category", "general")

        logger.info("RSS fetching: %s (%s)", name, url)

        try:
            resp = await self.client.get(url, follow_redirects=True, timeout=15)
            resp.raise_for_status()
        except Exception as e:
            logger.debug("RSS HTTP error (%s): %s", name, e)
            return []

        feed = feedparser.parse(resp.text)

        items = []
        for entry in feed.entries[:self.max_per_feed]:
            try:
                item = self._parse_entry(entry, name, category, since)
                if item:
                    items.append(item)
            except Exception as e:
                logger.debug("RSS parse error (%s): %s", name, e)
                continue

        logger.info("  %s: %d items", name, len(items))
        return items

    def _parse_entry(self, entry, feed_name: str, category: str, since: datetime) -> Optional[SignalItem]:
        title = (entry.get("title") or "").strip()
        if not title or len(title) < 10:
            return None

        # Parse published time
        published = entry.get("published_parsed") or entry.get("updated_parsed")
        if published:
            published_dt = datetime(*published[:6], tzinfo=timezone.utc)
        else:
            published_dt = datetime.now(timezone.utc)

        if published_dt < since:
            return None

        # Get content snippet
        content_text = ""
        if hasattr(entry, "content") and entry.content:
            content_text = entry.content[0].get("value", "")
        elif hasattr(entry, "summary"):
            content_text = entry.summary or ""

        # Strip HTML
        content_text = re.sub(r"<[^>]+>", " ", content_text)
        content_text = re.sub(r"\s+", " ", content_text).strip()[:800]

        link = entry.get("link", "")
        entry_id = entry.get("id", link)

        # Author
        author = "unknown"
        if hasattr(entry, "author"):
            author = entry.author or "unknown"

        return SignalItem(
            id=self._make_id("rss", category, entry_id),
            provider=SignalProvider.RSS,
            title=title,
            url=link,
            content=content_text or title,
            author=author,
            published_at=published_dt,
            hotness=0.0,
            metadata={
                "feed_name": feed_name,
                "category": category,
            },
        )
