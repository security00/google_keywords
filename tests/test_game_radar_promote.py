import importlib.util
from pathlib import Path
import sys
import unittest


def load_promote():
    spec = importlib.util.spec_from_file_location(
        "game_radar_promote", Path(__file__).resolve().parents[1] / "scripts" / "game_radar_promote.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class GameRadarPromoteTest(unittest.TestCase):
    def make_candidate(self, ratio=1.5, slope=2.0):
        promote = load_promote()
        return promote.PromotableCandidate(
            id="c1",
            keyword="It Reaches",
            source_id="steam-new",
            trend_ratio=ratio,
            trend_slope=slope,
            trend_verdict="fail",
            trend_series='{"timestamps":[],"values":[]}',
            serp_organic=8,
            serp_auth=0,
            serp_featured=0,
            serp_game_relevance=5,
            trend_reason="trend_signal_ok",
            serp_reason="serp_signal_ok",
            operator_note="new game",
        )

    def test_rising_recommendation_for_medium_traffic_positive_slope(self):
        promote = load_promote()

        recommendation, reason = promote.recommendation_for(self.make_candidate())

        self.assertEqual(recommendation, "📈 rising")
        self.assertIn("SERP passed", reason)
        self.assertIn("operator_note", reason)

    def test_hot_recommendation_for_high_ratio(self):
        promote = load_promote()

        recommendation, _ = promote.recommendation_for(self.make_candidate(ratio=2.2, slope=0.1))

        self.assertEqual(recommendation, "🔥 hot")

    def test_niche_recommendation_for_lower_ratio(self):
        promote = load_promote()

        recommendation, _ = promote.recommendation_for(self.make_candidate(ratio=0.35, slope=0.1))

        self.assertEqual(recommendation, "🎯 niche")


if __name__ == "__main__":
    unittest.main()
