import importlib.util
from pathlib import Path
import sys
import unittest


def load_autoreview():
    spec = importlib.util.spec_from_file_location(
        "game_radar_autoreview", Path(__file__).resolve().parents[1] / "scripts" / "game_radar_autoreview.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class GameRadarAutoReviewTest(unittest.TestCase):
    def make_candidate(self):
        autoreview = load_autoreview()
        return autoreview.AutoReviewCandidate(
            id="c1",
            keyword="It Reaches",
            source_id="steam-new",
            trend_ratio=1.2,
            trend_slope=2.0,
            trend_verdict="fail",
        )

    def test_approves_when_source_has_enough_successful_history(self):
        autoreview = load_autoreview()
        stats = autoreview.SourceLearningStats(
            source_id="steam-new",
            source_name="Steam New",
            positive_count=8,
            negative_count=2,
            precheck_count=0,
            success_rate=0.8,
            precheck_rate=0.0,
        )

        decision = autoreview.evaluate_candidate(self.make_candidate(), stats)

        self.assertTrue(decision.should_approve)
        self.assertIn("auto_approved_by_source_learning", decision.reason)

    def test_skips_when_source_history_is_too_small(self):
        autoreview = load_autoreview()
        stats = autoreview.SourceLearningStats(
            source_id="itchio-new",
            source_name="itch.io New",
            positive_count=1,
            negative_count=1,
            precheck_count=0,
            success_rate=0.5,
            precheck_rate=0.0,
        )

        decision = autoreview.evaluate_candidate(self.make_candidate(), stats)

        self.assertFalse(decision.should_approve)
        self.assertIn("insufficient_source_history", decision.reason)

    def test_skips_when_source_precheck_rate_is_high(self):
        autoreview = load_autoreview()
        stats = autoreview.SourceLearningStats(
            source_id="itchio-new",
            source_name="itch.io New",
            positive_count=8,
            negative_count=1,
            precheck_count=3,
            success_rate=8 / 9,
            precheck_rate=3 / 12,
        )

        decision = autoreview.evaluate_candidate(self.make_candidate(), stats)

        self.assertFalse(decision.should_approve)
        self.assertIn("source_precheck_rate_high", decision.reason)

    def test_writes_auto_approval_note_without_feedback_row(self):
        autoreview = load_autoreview()

        class FakeD1:
            def __init__(self):
                self.calls = []

            def query(self, sql, params):
                self.calls.append((sql, params))
                return []

        candidate = self.make_candidate()
        decision = autoreview.AutoReviewDecision(candidate, True, "auto_approved_by_source_learning: decisions=10")
        d1 = FakeD1()

        autoreview.approve_candidate(d1, decision)

        self.assertEqual(len(d1.calls), 1)
        self.assertIn("UPDATE game_radar_candidates", d1.calls[0][0])
        self.assertIn("approved", d1.calls[0][0])
        self.assertTrue(any("auto_approved_by_source_learning" in str(param) for param in d1.calls[0][1]))


if __name__ == "__main__":
    unittest.main()
