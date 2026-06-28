"""Unified data models for signal collection."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional


class SignalProvider(str, Enum):
    """Supported signal sources."""

    HACKERNEWS = "hackernews"
    REDDIT = "reddit"
    RSS = "rss"
    GITHUB_TRENDING = "github_trending"


class SignalLayer(str, Enum):
    """Product-level layer for multi-platform opportunity evidence."""

    COMMUNITY = "community_signal"
    VERTICAL = "vertical_source"
    SEARCH = "search_demand"


@dataclass
class SignalItem:
    """Unified signal content item from any source."""

    id: str  # Format: {provider}:{native_id}
    provider: SignalProvider
    title: str
    url: str
    content: Optional[str] = None
    author: Optional[str] = None
    published_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    hotness: float = 0.0  # Source-native score (HN points, Reddit upvotes, etc.)
    metadata: dict = field(default_factory=dict)


@dataclass
class SignalEvidence:
    """Normalized evidence item shown to reviewers before paid expansion."""

    provider: SignalProvider
    source_label: str
    title: str
    url: str
    published_at: str
    hotness: float
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class StandardizedSignalOpportunity:
    """Review-first opportunity object projected from raw platform signals."""

    keyword: str
    keyword_normalized: str
    signal_layer: SignalLayer
    source_count: int
    signal_score: float
    avg_hotness: float
    first_seen_at: str
    last_seen_at: str
    evidence: list[SignalEvidence]
    review_required: bool = True
    paid_expand_allowed: bool = False


@dataclass
class KeywordCandidate:
    """Keyword candidate extracted from signals."""

    keyword: str
    keyword_normalized: str
    source_signals: list[SignalItem] = field(default_factory=list)
    source_count: int = 0
    avg_hotness: float = 0.0
    first_seen_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_seen_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    extract_method: str = ""  # "title_ngram" | "content_tfidf" | "llm_extract"

    def add_signal(self, item: SignalItem):
        self.source_signals.append(item)
        self.source_count = len(set(s.provider.value for s in self.source_signals))
        total = sum(s.hotness for s in self.source_signals)
        self.avg_hotness = total / len(self.source_signals) if self.source_signals else 0
        if item.published_at > self.last_seen_at:
            self.last_seen_at = item.published_at
