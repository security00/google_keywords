import importlib.util
from pathlib import Path
import sys
import unittest


def load_pipeline():
    spec = importlib.util.spec_from_file_location(
        "game_radar_pipeline", Path(__file__).resolve().parents[1] / "scripts" / "game_radar_pipeline.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeD1:
    def __init__(self):
        self.calls = []

    def query(self, sql, params=None):
        self.calls.append((sql, params or []))
        if "FROM game_radar_candidates" in sql:
            return [{
                "discovered_count": 3,
                "trend_checked_count": 2,
                "trend_pass_count": 1,
                "trend_fail_count": 1,
                "serp_checked_count": 1,
                "serp_pass_count": 1,
                "serp_fail_count": 0,
                "promoted_count": 1,
            }]
        if "FROM game_keyword_pipeline" in sql:
            return [{"count": 4}]
        return []


class GameRadarPipelineTest(unittest.TestCase):
    def test_parse_sources_supports_comma_separated_values(self):
        pipeline = load_pipeline()

        sources = pipeline.parse_sources(["steam-new,roblox-search", "itchio-new"])

        self.assertEqual(sources, ["steam-new", "roblox-search", "itchio-new"])

    def test_fetch_funnel_snapshot_counts_run_activity_and_student_visible(self):
        pipeline = load_pipeline()
        d1 = FakeD1()

        snapshot = pipeline.fetch_funnel_snapshot(d1, "roblox-search", "2026-05-24T13:00:00+00:00")

        self.assertEqual(snapshot.source_id, "roblox-search")
        self.assertEqual(snapshot.discovered_count, 3)
        self.assertEqual(snapshot.trend_pass_count, 1)
        self.assertEqual(snapshot.serp_pass_count, 1)
        self.assertEqual(snapshot.promoted_count, 1)
        self.assertEqual(snapshot.student_visible_count, 4)

    def test_record_funnel_snapshot_inserts_observability_only_row(self):
        pipeline = load_pipeline()
        d1 = FakeD1()
        snapshot = pipeline.FunnelSnapshot(
            source_id="steam-new",
            discovered_count=1,
            trend_checked_count=1,
            trend_pass_count=1,
            trend_fail_count=0,
            serp_checked_count=1,
            serp_pass_count=1,
            serp_fail_count=0,
            promoted_count=1,
            student_visible_count=2,
        )

        pipeline.record_funnel_snapshot(
            d1,
            snapshot,
            run_id="run-1",
            run_started_at="2026-05-24T13:00:00+00:00",
            run_completed_at="2026-05-24T13:10:00+00:00",
            status="ok",
            error=None,
        )

        sql, params = d1.calls[-1]
        self.assertIn("INSERT INTO game_radar_source_funnel_runs", sql)
        self.assertEqual(params[0], "run-1:steam-new")
        self.assertEqual(params[1], "steam-new")
        self.assertEqual(params[5], 1)
        self.assertEqual(params[13], 2)


if __name__ == "__main__":
    unittest.main()
