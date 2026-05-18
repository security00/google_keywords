import importlib.util
from pathlib import Path
import sys
import unittest


def load_trends():
    spec = importlib.util.spec_from_file_location(
        "game_radar_trends", Path(__file__).resolve().parents[1] / "scripts" / "game_radar_trends.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class GameRadarTrendsTest(unittest.TestCase):
    def test_passes_when_keyword_has_enough_traffic_and_shape(self):
        trends = load_trends()

        decision = trends.classify_trend_result({"ratioMean": 0.42, "slopeRatio": 0.1, "verdict": "pass"})

        self.assertEqual(decision.status, "trend_pass")
        self.assertIsNone(decision.reject_reason)
        self.assertIn("trend_signal_ok", decision.reason)

    def test_fails_low_traffic_even_with_positive_verdict(self):
        trends = load_trends()

        decision = trends.classify_trend_result({"ratioMean": 0.08, "slopeRatio": 3.0, "verdict": "strong"})

        self.assertEqual(decision.status, "trend_fail")
        self.assertEqual(decision.reject_reason, "low_trend_signal")

    def test_falls_back_to_ratio_field(self):
        trends = load_trends()

        decision = trends.classify_trend_result({"ratio": 0.35, "slopeRatio": 0, "verdict": "watch"})

        self.assertEqual(decision.status, "trend_pass")
        self.assertAlmostEqual(decision.ratio, 0.35)


if __name__ == "__main__":
    unittest.main()
