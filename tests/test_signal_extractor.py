from datetime import datetime, timezone
import unittest

from signal_collector.extractor import extract_keyword_candidates
from signal_collector.models import SignalItem, SignalProvider


def item(title: str, provider: SignalProvider = SignalProvider.RSS, **metadata) -> SignalItem:
    return SignalItem(
        id=f"test:{title}",
        provider=provider,
        title=title,
        url="https://example.com",
        published_at=datetime.now(timezone.utc),
        hotness=100,
        metadata=metadata,
    )


class SignalExtractorNoiseTest(unittest.TestCase):
    def test_skips_known_signal_noise(self):
        candidates = extract_keyword_candidates([
            item("Spidey tracker launches for official Spider-Man event"),
            item("Wu Tang name generator goes viral again"),
            item("Bỉ – Ai Cập match preview and live score"),
            item("Rising 2026 World Cup searches surge"),
            item("Gemini watermark remover trend raises concerns"),
        ])

        extracted = {c.keyword_normalized for c in candidates}

        self.assertNotIn("spidey tracker", extracted)
        self.assertNotIn("tang name", extracted)
        self.assertNotIn("world cup", extracted)
        self.assertNotIn("watermark remover", extracted)

    def test_uses_github_repo_name_instead_of_description_fragments(self):
        candidates = extract_keyword_candidates([
            item(
                "DeusData/codebase-memory-mcp: High-performance code server. Indexes your codebase",
                SignalProvider.GITHUB_TRENDING,
                repo="DeusData/codebase-memory-mcp",
            ),
        ])

        extracted = {c.keyword_normalized for c in candidates}

        self.assertIn("codebase memory mcp", extracted)
        self.assertNotIn("server indexes", extracted)
        self.assertNotIn("high-performance code", extracted)

    def test_blocks_recent_dry_run_news_fragments(self):
        candidates = extract_keyword_candidates([
            item("Wall Street is awaiting maker Micron earnings"),
            item("Flock cameras are spreading across neighborhoods"),
            item("Why they're spreading so quickly"),
            item("Chat Control is moving forward behind closed doors", SignalProvider.HACKERNEWS),
        ])

        extracted = {c.keyword_normalized for c in candidates}

        self.assertNotIn("wall street", extracted)
        self.assertNotIn("maker micron", extracted)
        self.assertNotIn("flock cameras", extracted)
        self.assertNotIn("they re", extracted)
        self.assertNotIn("chat control", extracted)
        self.assertNotIn("control moving", extracted)

    def test_keeps_buildable_tool_phrase_from_reddit(self):
        candidates = extract_keyword_candidates([
            item("[Tool] SaaS pricing calculator for founders", SignalProvider.REDDIT, subreddit="sideproject"),
        ])

        extracted = {c.keyword_normalized for c in candidates}

        self.assertIn("pricing calculator", extracted)

    def test_keeps_hn_or_rss_phrases_with_buildable_hints(self):
        candidates = extract_keyword_candidates([
            item("Show HN: Fugu API docs generator", SignalProvider.HACKERNEWS),
            item("New LLM agent browser extension launches", SignalProvider.RSS),
        ])

        extracted = {c.keyword_normalized for c in candidates}

        self.assertIn("fugu api", extracted)
        self.assertIn("api docs", extracted)
        self.assertIn("browser extension", extracted)


if __name__ == "__main__":
    unittest.main()
