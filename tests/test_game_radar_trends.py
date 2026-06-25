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

    def test_passes_sustained_steam_top_seller_with_high_ratio(self):
        trends = load_trends()

        decision = trends.classify_trend_result(
            {"ratioMean": 46.33, "slopeRatio": -18.0, "verdict": "fail"},
            source_id="steam-topsellers",
        )

        self.assertEqual(decision.status, "trend_pass")
        self.assertIsNone(decision.reject_reason)
        self.assertIn("steam_top_seller_sustained", decision.reason)

    def test_does_not_apply_steam_top_seller_override_to_other_sources(self):
        trends = load_trends()

        decision = trends.classify_trend_result(
            {"ratioMean": 46.33, "slopeRatio": -18.0, "verdict": "fail"},
            source_id="steam-new",
        )

        self.assertEqual(decision.status, "trend_fail")
        self.assertEqual(decision.reject_reason, "low_trend_signal")

    def test_prefilter_marks_obvious_non_game_before_api_calls(self):
        trends = load_trends()

        class FakeD1:
            def __init__(self):
                self.calls = []

            def query(self, sql, params):
                self.calls.append((sql, params))
                return []

        d1 = FakeD1()
        valid = trends.prefilter_candidates(
            d1,
            [
                trends.RadarCandidate("bad", "Machine Learning", "itchio-new", "new"),
                trends.RadarCandidate("good", "It Reaches", "steam-new", "new"),
            ],
            dry_run=False,
        )

        self.assertEqual([item.keyword for item in valid], ["It Reaches"])
        self.assertEqual(len(d1.calls), 1)
        self.assertIn("not_game_name_precheck", d1.calls[0][1])


if __name__ == "__main__":
    unittest.main()
