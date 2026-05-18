import importlib.util
from pathlib import Path
import sys
import unittest


def load_radar():
    spec = importlib.util.spec_from_file_location(
        "game_suggest_radar", Path(__file__).resolve().parents[1] / "scripts" / "game_suggest_radar.py"
    )
    radar = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = radar
    spec.loader.exec_module(radar)
    return radar


class GameSuggestRadarTest(unittest.TestCase):
    def test_cleans_game_intent_suffixes_to_entity(self):
        radar = load_radar()
        self.assertEqual(radar.clean_suggest_keyword("new silksong game guide"), "Silksong")
        self.assertEqual(radar.clean_suggest_keyword("new anime final stand codes"), "Anime Final Stand")
        self.assertEqual(radar.clean_suggest_keyword("deltarune chapter 3 release date"), "Deltarune Chapter 3")
        self.assertEqual(radar.clean_suggest_keyword("upcoming game blockspin"), "Blockspin")

    def test_requires_new_or_upcoming_intent(self):
        radar = load_radar()
        self.assertIsNone(radar.clean_suggest_keyword("game guide grow a garden"))
        self.assertIsNone(radar.clean_suggest_keyword("game codes for blockspin"))
        self.assertIsNone(radar.clean_suggest_keyword("game guide fisch value"))
        self.assertIsNone(radar.clean_suggest_keyword("game guide creatures of sonaria"))
        self.assertIsNone(radar.clean_suggest_keyword("game guide dragon adventures"))

    def test_rejects_generic_game_queries(self):
        radar = load_radar()
        self.assertIsNone(radar.clean_suggest_keyword("best games online"))
        self.assertIsNone(radar.clean_suggest_keyword("roblox games to play"))
        self.assertIsNone(radar.clean_suggest_keyword("free online games"))
        self.assertIsNone(radar.clean_suggest_keyword("new game releases 2026"))
        self.assertIsNone(radar.clean_suggest_keyword("new game of thrones"))

    def test_build_seed_queries_expands_safe_seeds_alphabetically(self):
        radar = load_radar()
        plain = radar.build_seed_queries(["game codes"], alphabet=False)
        expanded = radar.build_seed_queries(["game codes", "game guide"], alphabet=True)
        self.assertEqual(plain, [("game codes", "game codes")])
        self.assertNotIn(("game codes", "game codes a"), expanded)
        self.assertIn(("game guide", "game guide a"), expanded)
        self.assertIn(("game guide", "game guide z"), expanded)


if __name__ == "__main__":
    unittest.main()
