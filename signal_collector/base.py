"""Base scraper interface for signal collection."""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import List

import httpx

from .models import SignalItem


class BaseSignalScraper(ABC):
    """Abstract base class for all signal scrapers."""

    def __init__(self, config: dict, http_client: httpx.AsyncClient):
        self.config = config
        self.client = http_client

    @abstractmethod
    async def fetch(self, since: datetime) -> List[SignalItem]:
        """Fetch signal items published since the given time.

        Args:
            since: Only fetch items published after this time

        Returns:
            List of SignalItem
        """
        ...

    def _make_id(self, provider: str, subtype: str, native_id: str) -> str:
        return f"{provider}:{subtype}:{native_id}"
