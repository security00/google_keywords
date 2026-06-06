"""Hacker News signal collector — active discovery mode.

Adapted from Thysrael/Horizon (src/scrapers/hackernews.py).
Instead of checking keywords against HN, this monitors HN to discover new keyword candidates.
"""

import logging
import re
from datetime import datetime, timezone
from typing import List, Optional
import asyncio
import httpx

from ..base import BaseSignalScraper
from ..models import SignalItem, SignalProvider

logger = logging.getLogger(__name__)


class HackerNewsScraper(BaseSignalScraper):
    """Scrape Hacker News top stories for keyword discovery."""

    BASE_URL = "https://hacker-news.firebaseio.com/v0"

    def __init__(self, config: dict, http_client: httpx.AsyncClient):
        super().__init__(config, http_client)

    async def fetch(self, since: datetime) -> List[SignalItem]:
        """Fetch HN stories published since 'since' time.

        1. Top stories (by score, configurable count)
        2. New stories (to catch emerging trends early)
        """
        fetch_top = self.config.get("fetch_top_stories", 50)
        fetch_new = self.config.get("fetch_new_stories", 30)
        min_score = self.config.get("min_score", 50)

        items = []

        # Fetch both top and new story IDs concurrently
        try:
            top_ids_resp, new_ids_resp = await asyncio.gather(
                self.client.get(f"{self.BASE_URL}/topstories.json"),
                self.client.get(f"{self.BASE_URL}/newstories.json"),
            )
            top_ids = top_ids_resp.json()[:fetch_top]
            new_ids = new_ids_resp.json()[:fetch_new]
        except Exception as e:
            logger.warning("Failed to fetch HN story IDs: %s", e)
            return []

        # Deduplicate: new stories that aren't in top stories
        top_set = set(top_ids)
        extra_new_ids = [sid for sid in new_ids if sid not in top_set]

        all_story_ids = top_ids + extra_new_ids[:fetch_new]
        logger.info("Fetching %d HN stories (top=%d + new=%d)",
                     len(all_story_ids), len(top_ids), len(extra_new_ids))

        # Fetch all story details concurrently
        tasks = [self._fetch_story(sid) for sid in all_story_ids]
        stories = await asyncio.gather(*tasks, return_exceptions=True)

        for story in stories:
            if isinstance(story, Exception) or story is None:
                continue
            if story.get("score", 0) < min_score:
                continue
            published_at = datetime.fromtimestamp(story["time"], tz=timezone.utc)
            if published_at < since:
                continue

            points = story.get("score", 0)
            item = self._parse_story(story, points)
            if item:
                items.append(item)

        items.sort(key=lambda x: x.hotness, reverse=True)
        logger.info("HN: collected %d stories with score >= %d", len(items), min_score)
        return items

    async def _fetch_story(self, story_id: int) -> Optional[dict]:
        try:
            resp = await self.client.get(f"{self.BASE_URL}/item/{story_id}.json")
            resp.raise_for_status()
            return resp.json()
        except Exception:
            return None

    def _parse_story(self, story: dict, points: int) -> Optional[SignalItem]:
        story_id = story["id"]
        title = (story.get("title") or "").strip()
        if not title:
            return None

        url = story.get("url", f"https://news.ycombinator.com/item?id={story_id}")
        author = story.get("by", "unknown")
        published_at = datetime.fromtimestamp(story["time"], tz=timezone.utc)

        # Build content: story text (if Ask HN etc.) + tags
        text = story.get("text", "")
        content_parts = [text] if text else []
        content_parts.append(f"[{points} points]")

        # Add top-level comment snippets (first 3)
        comment_ids = story.get("kids", [])[:3]
        # We don't fetch comments here — too expensive for discovery.
        # The signal is the title + score + discussion count.

        return SignalItem(
            id=self._make_id("hackernews", "story", str(story_id)),
            provider=SignalProvider.HACKERNEWS,
            title=title,
            url=url,
            content="\n".join(content_parts).strip(),
            author=author,
            published_at=published_at,
            hotness=float(points),
            metadata={
                "descendants": story.get("descendants", 0),
                "type": story.get("type", "story"),
                "discussion_url": f"https://news.ycombinator.com/item?id={story_id}",
            },
        )
