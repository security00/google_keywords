from datetime import datetime, timezone
import json
import unittest

from signal_collector.models import KeywordCandidate, SignalItem, SignalLayer, SignalProvider
from signal_collector.standardizer import signal_sources_json, standardized_signal_opportunity


def signal_item(provider: SignalProvider, title: str, **metadata) -> SignalItem:
    return SignalItem(
        id=f"{provider.value}:{title}",
        provider=provider,
        title=title,
        url=f"https://example.com/{provider.value}",
        published_at=datetime(2026, 6, 28, tzinfo=timezone.utc),
        hotness=80,
        metadata=metadata,
    )


def candidate(*items: SignalItem) -> KeywordCandidate:
    c = KeywordCandidate(
        keyword="Claude Desktop",
        keyword_normalized="claude desktop",
        first_seen_at=datetime(2026, 6, 28, tzinfo=timezone.utc),
        last_seen_at=datetime(2026, 6, 28, tzinfo=timezone.utc),
        extract_method="bigram",
    )
    for item in items:
        c.add_signal(item)
    return c


class SignalStandardizerTest(unittest.TestCase):
    def test_standardizes_reddit_evidence_for_review_first_flow(self):
        opportunity = standardized_signal_opportunity(
            candidate(signal_item(SignalProvider.REDDIT, "Claude Desktop alternative", subreddit="sideproject"))
        )

        self.assertEqual(opportunity.signal_layer, SignalLayer.COMMUNITY)
        self.assertTrue(opportunity.review_required)
        self.assertFalse(opportunity.paid_expand_allowed)
        self.assertEqual(opportunity.evidence[0].source_label, "r/sideproject")

    def test_marks_github_trending_as_vertical_source(self):
        opportunity = standardized_signal_opportunity(
            candidate(signal_item(SignalProvider.GITHUB_TRENDING, "claude desktop repo", repo="acme/claude-desktop"))
        )

        self.assertEqual(opportunity.signal_layer, SignalLayer.VERTICAL)
        self.assertEqual(opportunity.evidence[0].source_label, "acme/claude-desktop")

    def test_serializes_stable_signal_sources_json(self):
        payload = json.loads(signal_sources_json(candidate(
            signal_item(SignalProvider.HACKERNEWS, "Claude Desktop launches"),
            signal_item(SignalProvider.RSS, "Claude Desktop guide", feed_name="TechCrunch"),
        )))

        self.assertEqual(payload["keyword_normalized"], "claude desktop")
        self.assertEqual(payload["signal_layer"], "community_signal")
        self.assertEqual(payload["source_count"], 2)
        self.assertEqual(payload["evidence"][0]["source_label"], "Hacker News")
        self.assertEqual(payload["evidence"][1]["source_label"], "TechCrunch")
        self.assertTrue(payload["review_required"])
        self.assertFalse(payload["paid_expand_allowed"])


if __name__ == "__main__":
    unittest.main()

