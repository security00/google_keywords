"""Standardize raw platform signals into review-first opportunity evidence."""

import json
from dataclasses import asdict
from datetime import datetime
from typing import Iterable

from .models import (
    KeywordCandidate,
    SignalEvidence,
    SignalItem,
    SignalLayer,
    SignalProvider,
    StandardizedSignalOpportunity,
)


def source_label_for(item: SignalItem) -> str:
    """Return a reviewer-friendly source label without leaking provider internals."""
    if item.provider == SignalProvider.REDDIT:
        subreddit = item.metadata.get("subreddit")
        return f"r/{subreddit}" if subreddit else "Reddit"
    if item.provider == SignalProvider.HACKERNEWS:
        return "Hacker News"
    if item.provider == SignalProvider.RSS:
        return str(item.metadata.get("feed_name") or "RSS")
    if item.provider == SignalProvider.GITHUB_TRENDING:
        return str(item.metadata.get("repo") or item.metadata.get("full_name") or "GitHub Trending")
    return item.provider.value


def signal_layer_for(providers: Iterable[SignalProvider]) -> SignalLayer:
    """Map raw providers to the PRD's product-level evidence layers."""
    provider_set = set(providers)
    if provider_set and provider_set <= {SignalProvider.GITHUB_TRENDING}:
        return SignalLayer.VERTICAL
    return SignalLayer.COMMUNITY


def evidence_from_item(item: SignalItem) -> SignalEvidence:
    published_at = item.published_at.isoformat() if isinstance(item.published_at, datetime) else str(item.published_at)
    return SignalEvidence(
        provider=item.provider,
        source_label=source_label_for(item),
        title=item.title,
        url=item.url,
        published_at=published_at,
        hotness=item.hotness,
        metadata=dict(item.metadata or {}),
    )


def standardized_signal_opportunity(candidate: KeywordCandidate) -> StandardizedSignalOpportunity:
    """Project an extracted keyword candidate into a stable review object."""
    providers = [item.provider for item in candidate.source_signals]
    evidence = [evidence_from_item(item) for item in candidate.source_signals]
    signal_score = candidate.source_count * 5 + (candidate.avg_hotness / 10)

    return StandardizedSignalOpportunity(
        keyword=candidate.keyword,
        keyword_normalized=candidate.keyword_normalized,
        signal_layer=signal_layer_for(providers),
        source_count=candidate.source_count,
        signal_score=signal_score,
        avg_hotness=candidate.avg_hotness,
        first_seen_at=candidate.first_seen_at.isoformat(),
        last_seen_at=candidate.last_seen_at.isoformat(),
        evidence=evidence,
    )


def signal_sources_json(candidate: KeywordCandidate) -> str:
    """Serialize standardized evidence for the existing signal_candidates table."""
    opportunity = standardized_signal_opportunity(candidate)
    return json.dumps(asdict(opportunity), ensure_ascii=False, sort_keys=True)

