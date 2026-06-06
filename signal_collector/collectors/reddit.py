"""Reddit signal collector via RSS feeds.

Uses Reddit's public RSS feeds (no API key needed).
Collects posts from configured subreddits for keyword discovery.

Adapted from Thysrael/Horizon's approach but simplified for keyword discovery focus.
"""

import logging
import re
from datetime import datetime, timezone
from typing import List, Optional
import asyncio

import feedparser
import httpx

from ..base import BaseSignalScraper
from ..models import SignalItem, SignalProvider

logger = logging.getLogger(__name__)

# Regex to strip Reddit flair prefixes like "[Tool] Title"
FLAIR_RE = re.compile(r"^\[.*?\]\s*")

# Common low-value post patterns — checked as individual patterns to avoid nest depth issues
_LOW_VALUE_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"^daily\s+(thread|discussion|chat)",
        r"^weekly\s+",
        r"^monthly\s+",
        r"^mega[- ]?thread",
        r"^where\s+(to\s+)?(start|begin)",
        r"^recommend\s+(me\s+)?(a|an|some)",
        r"^what\s+(is|does|can|do)\s+(your|everyone)",
        r"^how\s+(is|does|can|do)\s+(your|everyone)",
        r"^I\s+(just|ve|have|am)\s+(started|made|created|built)",
    ]
]


def _is_low_value_title(title: str) -> bool:
    for p in _LOW_VALUE_PATTERNS:
        if p.match(title):
            return True
    return False


class RedditScraper(BaseSignalScraper):
    """Scrape Reddit subreddits for keyword discovery."""

    RSS_BASE = "https://www.reddit.com/r/{subreddit}/{sort}.rss"

    def __init__(self, config: dict, http_client: httpx.AsyncClient):
        super().__init__(config, http_client)

    async def fetch(self, since: datetime) -> List[SignalItem]:
        subreddits = self.config.get("subreddits", [])
        sort = self.config.get("sort", "hot")
        fetch_limit = self.config.get("fetch_limit", 25)

        if not subreddits:
            logger.info("Reddit: no subreddits configured, skipping")
            return []

        tasks = [
            self._fetch_subreddit(sub, sort, since)
            for sub in subreddits
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        all_items = []
        for result in results:
            if isinstance(result, Exception):
                logger.warning("Reddit subreddit fetch failed: %s", result)
                continue
            all_items.extend(result[:fetch_limit])

        all_items.sort(key=lambda x: x.hotness, reverse=True)
        logger.info("Reddit: collected %d items from %d subreddits",
                     len(all_items), len(subreddits))
        return all_items

    async def _fetch_subreddit(
        self, subreddit: str, sort: str, since: datetime
    ) -> List[SignalItem]:
        url = self.RSS_BASE.format(subreddit=subreddit.lower(), sort=sort)
        logger.info("Reddit fetching r/%s (%s)", subreddit, sort)

        try:
            resp = await self.client.get(url, follow_redirects=True, timeout=15)
            resp.raise_for_status()
        except Exception as e:
            logger.warning("Reddit r/%s HTTP error: %s", subreddit, e)
            return []

        feed = feedparser.parse(resp.text)

        items = []
        for entry in feed.entries[:50]:  # Process max 50 per subreddit
            try:
                item = self._parse_entry(entry, subreddit, since)
                if item:
                    items.append(item)
            except Exception as e:
                logger.debug("Reddit parse error r/%s: %s", subreddit, e)
                continue

        return items

    def _parse_entry(
        self, entry, subreddit: str, since: datetime
    ) -> Optional[SignalItem]:
        title = (entry.get("title") or "").strip()

        # Skip low-value posts
        if _is_low_value_title(title):
            return None

        # Strip flair
        clean_title = FLAIR_RE.sub("", title).strip()
        if not clean_title or len(clean_title) < 10:
            return None

        # Parse published time
        published = entry.get("published_parsed") or entry.get("updated_parsed")
        if published:
            published_dt = datetime(*published[:6], tzinfo=timezone.utc)
        else:
            published_dt = datetime.now(timezone.utc)

        if published_dt < since:
            return None

        # Get content
        content_text = ""
        if hasattr(entry, "content") and entry.content:
            content_text = entry.content[0].get("value", "")
        elif hasattr(entry, "summary"):
            content_text = entry.summary or ""

        # Clean HTML from content
        content_text = re.sub(r"<[^>]+>", " ", content_text)
        content_text = re.sub(r"\s+", " ", content_text).strip()[:1000]

        # Extract link
        link = entry.get("link", "")
        entry_id = entry.get("id", link)

        # Score (RSS doesn't give upvotes directly, use 0 as unknown)
        return SignalItem(
            id=self._make_id("reddit", "post", entry_id),
            provider=SignalProvider.REDDIT,
            title=clean_title,
            url=link,
            content=content_text or clean_title,
            author=entry.get("author", "unknown"),
            published_at=published_dt,
            hotness=0.0,  # RSS doesn't provide scores
            metadata={
                "subreddit": subreddit,
                "entry_id": entry_id,
            },
        )
