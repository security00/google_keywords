import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


def load_bridge():
    spec = importlib.util.spec_from_file_location(
        "signal_bridge", Path(__file__).resolve().parents[1] / "scripts" / "signal_bridge.py"
    )
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    return bridge


class SignalBridgeReviewGateTest(unittest.TestCase):
    def test_bridge_only_fetches_admin_approved_candidates(self):
        bridge = load_bridge()
        bridge.GK_API_KEY = "test-key"
        queries = []

        def fake_d1_query(sql, params=None):
            queries.append(sql)
            return []

        with patch.object(bridge, "d1_query", side_effect=fake_d1_query), patch.object(
            sys, "argv", ["signal_bridge.py", "--limit", "5"]
        ):
            bridge.main()

        self.assertIn("accepted LIKE 'accepted:%'", queries[0])
        self.assertIn("processed = 0", queries[0])


if __name__ == "__main__":
    unittest.main()
