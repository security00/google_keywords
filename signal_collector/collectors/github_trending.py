"""GitHub Trending signal collector.

Uses OSSInsight public API to find trending repositories.
New trending repos can reveal emerging tech keywords and market opportunities.

Adapted from Thysrael/Horizon (src/scrapers/ossinsight.py).
"""

import logging
import re
from datetime import datetime, timezone
from typing import List, Optional

import httpx

from ..base import BaseSignalScraper
from ..models import SignalItem, SignalProvider

logger = logging.getLogger(__name__)

OSSINSIGHT_API = "https://api.ossinsight.io/v1/trends/repos"


class GitHubTrendingScraper(BaseSignalScraper):
    """Scrape OSSInsight trending repos for keyword discovery."""

    def __init__(self, config: dict, http_client: httpx.AsyncClient):
        super().__init__(config, http_client)
        self.period = config.get("period", "past_24_hours")
        self.languages = config.get("languages", ["All", "Python", "TypeScript", "JavaScript"])
        self.keywords = config.get("keywords", [])  # optional filter
        self.min_stars = config.get("min_stars", 10)
        self.max_items = config.get("max_items", 30)

    async def fetch(self, since: datetime) -> List[SignalItem]:
        """Fetch trending repos from OSSInsight."""
        all_items = []

        for language in self.languages:
            try:
                items = await self._fetch_period(self.period, language)
                all_items.extend(items)
            except Exception as e:
                logger.warning("OSSInsight fetch failed for %s: %s", language, e)
                continue

        # Filter by min stars
        all_items = [i for i in all_items if i.hotness >= self.min_stars]

        # Deduplicate by repo name
        seen = set()
        deduped = []
        for item in all_items:
            repo = item.metadata.get("repo", "")
            if repo not in seen:
                seen.add(repo)
                deduped.append(item)

        deduped.sort(key=lambda x: x.hotness, reverse=True)
        deduped = deduped[:self.max_items]

        logger.info("GitHub Trending: %d repos", len(deduped))
        return deduped

    async def _fetch_period(self, period: str, language: str) -> List[SignalItem]:
        """Fetch trending repos for a given period and language."""
        params = {
            "period": period,
            "language": language,
        }

        try:
            resp = await self.client.get(OSSINSIGHT_API, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.debug("OSSInsight API error (%s, %s): %s", period, language, e)
            return []

        rows = data.get("data", {}).get("rows", [])
        if not rows:
            return []

        items = []
        for row in rows:
            try:
                item = self._parse_repo(row, period, language)
                if item:
                    items.append(item)
            except Exception as e:
                logger.debug("OSSInsight parse error: %s", e)
                continue

        return items

    def _parse_repo(self, row: dict, period: str, language: str) -> Optional[SignalItem]:
        repo_name = (row.get("repo_name") or "").strip()
        if not repo_name:
            return None

        # Optional keyword filter
        if self.keywords:
            name_lower = repo_name.lower()
            description = (row.get("description") or "").lower()
            found = any(kw.lower() in name_lower or kw.lower() in description for kw in self.keywords)
            if not found:
                return None

        stars = row.get("stars", 0) or 0
        forks = row.get("forks", 0) or 0
        description = (row.get("description") or "").strip()
        primary_lang = row.get("language", language)
        url = f"https://github.com/{repo_name}"

        # Extract tags from repo description
        tags = []
        if description:
            # Simple extraction: capitalized multi-word terms
            tag_matches = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b", description)
            for t in tag_matches:
                if 2 < len(t) < 40:
                    tags.append(t)

        # Build content
        content_parts = [description] if description else []
        if tags:
            content_parts.append(f"Tags: {', '.join(tags)}")
        content = " | ".join(content_parts) if content_parts else repo_name

        return SignalItem(
            id=self._make_id("github_trending", period, repo_name),
            provider=SignalProvider.GITHUB_TRENDING,
            title=f"{repo_name}: {description[:60]}" if description else repo_name,
            url=url,
            content=content,
            author=row.get("owner", repo_name.split("/")[0] if "/" in repo_name else "unknown"),
            published_at=datetime.now(timezone.utc),  # OSSInsight doesn't give publish dates
            hotness=float(stars),
            metadata={
                "repo": repo_name,
                "stars": stars,
                "forks": forks,
                "primary_language": primary_lang,
                "period": period,
                "tags": tags,
            },
        )
