import importlib.util
from pathlib import Path
import unittest


def load_bridge():
    spec = importlib.util.spec_from_file_location(
        "signal_bridge", Path(__file__).resolve().parents[1] / "scripts" / "signal_bridge.py"
    )
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    return bridge


class SignalBridgeClassificationTest(unittest.TestCase):
    def test_allows_ai_tool_product_signals(self):
        bridge = load_bridge()

        allowed, fit, reason = bridge.allow_signal_bridge("Claude Desktop")

        self.assertTrue(allowed)
        self.assertEqual(fit, "new_tool")
        self.assertEqual(reason, "ai_tool_candidate")

    def test_allows_game_signals(self):
        bridge = load_bridge()

        allowed, fit, reason = bridge.allow_signal_bridge("Brookhaven RP roblox")

        self.assertTrue(allowed)
        self.assertEqual(fit, "new_game")
        self.assertEqual(reason, "game_candidate")

    def test_blocks_brand_news_events(self):
        bridge = load_bridge()

        allowed, fit, reason = bridge.allow_signal_bridge("mcdonald's drive-thru ai upgrade")

        self.assertFalse(allowed)
        self.assertEqual(fit, "business_news_event")
        self.assertEqual(reason, "brand_news_event")

    def test_blocks_general_news_and_weak_fragments(self):
        bridge = load_bridge()

        self.assertEqual(bridge.allow_signal_bridge("Middle East")[0], False)
        self.assertEqual(bridge.allow_signal_bridge("engineering career")[0], False)
        self.assertEqual(bridge.allow_signal_bridge("technical breakdown")[0], False)

    def test_blocks_ip_sports_non_english_and_rights_evasion_noise(self):
        bridge = load_bridge()

        cases = [
            ("spidey tracker", "unsafe", "entertainment_ip_or_trademark"),
            ("wu tang name generator", "unsafe", "entertainment_ip_or_trademark"),
            ("bỉ – ai cập", "noise", "non_english_keyword"),
            ("rising 2026 World Cup", "general_content", "sports_event"),
            ("gemini watermark remover", "unsafe", "rights_evasion"),
            ("agent kim reactivated", "unsafe", "entertainment_ip_or_trademark"),
            ("agent kim tracker", "unsafe", "entertainment_ip_or_trademark"),
        ]

        for keyword, fit, reason in cases:
            with self.subTest(keyword=keyword):
                allowed, actual_fit, actual_reason = bridge.allow_signal_bridge(keyword)
                self.assertFalse(allowed)
                self.assertEqual(actual_fit, fit)
                self.assertEqual(actual_reason, reason)

    def test_blocks_ai_brand_title_fragments(self):
        bridge = load_bridge()

        for keyword in ["AI generated", "contain Claude", "Claude across", "AI already", "Comfortably monitor", "maker LastPass"]:
            with self.subTest(keyword=keyword):
                allowed, fit, reason = bridge.allow_signal_bridge(keyword)
                self.assertFalse(allowed)
                self.assertEqual(fit, "noise")
                self.assertEqual(reason, "title_fragment")

    def test_blocks_generic_platform_phrases(self):
        bridge = load_bridge()

        for keyword in ["Game Engine", "Extensions SDK", "strncpy API", "electronic calculator", "AI Assistant", "Game Boy"]:
            with self.subTest(keyword=keyword):
                allowed, fit, reason = bridge.allow_signal_bridge(keyword)
                self.assertFalse(allowed)
                self.assertEqual(fit, "noise")
                self.assertEqual(reason, "generic_platform_phrase")

    def test_blocks_github_repo_fragments(self):
        bridge = load_bridge()

        allowed, fit, reason = bridge.allow_signal_bridge("refactoringhq/tolaria Desktop")

        self.assertFalse(allowed)
        self.assertEqual(fit, "noise")
        self.assertEqual(reason, "repo_fragment")


if __name__ == "__main__":
    unittest.main()
