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


if __name__ == "__main__":
    unittest.main()
