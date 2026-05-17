import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch


def load_scanner():
    spec = importlib.util.spec_from_file_location(
        "game_trend_scanner", Path(__file__).resolve().parents[1] / "scripts" / "game_trend_scanner.py"
    )
    scanner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scanner)
    return scanner


class GameTrendScannerSourcesTest(unittest.TestCase):
    def test_fetch_steam_new_releases_keeps_free_and_paid_current_games(self):
        scanner = load_scanner()

        payload = {
            "new_releases": {
                "items": [
                    {"id": 1, "name": "Big Traffic Game", "original_price": 1999},
                    {"id": 2, "name": "Free Trend Game", "original_price": 0},
                    {"id": 3, "name": "Hentai Noise", "original_price": 999},
                    {"id": 4, "name": "Current", "original_price": 999},
                    {"id": 5, "name": "Tiny", "original_price": None},
                    {"id": 6, "name": "Futanari Mermaids", "original_price": 999},
                    {"id": 7, "name": "A Summer In Oneeshota Town", "original_price": 999},
                ]
            }
        }

        response = MagicMock()
        response.__enter__.return_value.read.return_value = scanner.json.dumps(payload).encode("utf-8")

        with patch.object(scanner.urllib.request, "urlopen", return_value=response):
            games = scanner.fetch_steam_new_releases()

        self.assertEqual(
            games,
            [
                {"name": "Big Traffic Game", "source": "steam", "steam_id": 1},
                {"name": "Free Trend Game", "source": "steam", "steam_id": 2},
            ],
        )

    def test_select_games_to_check_gives_each_source_a_daily_floor(self):
        scanner = load_scanner()

        games = (
            [{"name": f"Crazy {i}", "source": "crazygames"} for i in range(10)]
            + [{"name": f"Steam {i}", "source": "steam"} for i in range(4)]
            + [{"name": f"Poki {i}", "source": "poki"} for i in range(4)]
        )

        selected = scanner.select_games_to_check(games, checked_names=set(), max_keywords=6)

        self.assertEqual(len(selected), 6)
        self.assertEqual(
            [game["source"] for game in selected],
            ["crazygames", "crazygames", "steam", "steam", "poki", "poki"],
        )

    def test_select_games_to_check_fills_remaining_by_original_order(self):
        scanner = load_scanner()

        games = (
            [{"name": f"Crazy {i}", "source": "crazygames"} for i in range(5)]
            + [{"name": "Steam 0", "source": "steam"}]
            + [{"name": "Poki 0", "source": "poki"}]
        )

        selected = scanner.select_games_to_check(games, checked_names=set(), max_keywords=5)

        self.assertEqual(
            [game["source"] for game in selected],
            ["crazygames", "steam", "poki", "crazygames", "crazygames"],
        )

    def test_select_games_to_check_skips_already_checked_names(self):
        scanner = load_scanner()

        games = [
            {"name": "Already Done", "source": "crazygames"},
            {"name": "Fresh Steam", "source": "steam"},
        ]

        selected = scanner.select_games_to_check(games, checked_names={"already done"}, max_keywords=10)

        self.assertEqual(selected, [{"name": "Fresh Steam", "source": "steam"}])

    def test_classify_established_but_rising_low_competition_as_niche_opportunity(self):
        scanner = load_scanner()

        rec, reason = scanner.classify_keyword(
            ratio=0.74,
            slope=2.92,
            verdict="fail",
            serp_auth=0,
            serp_game_relevance=1,
            hist_vs_bench=0.6,
            surge=0.5,
            hist_avg=20,
        )

        self.assertEqual(rec, "🎯 niche")
        self.assertIn("非纯新词", reason)
        self.assertIn("可做机会", reason)

    def test_classify_established_low_ratio_still_skips(self):
        scanner = load_scanner()

        rec, _ = scanner.classify_keyword(
            ratio=0.21,
            slope=5.89,
            verdict="fail",
            serp_auth=0,
            hist_vs_bench=0.6,
            surge=0.5,
            hist_avg=20,
        )

        self.assertEqual(rec, "⏭️ skip")

    def test_classify_established_low_competition_requires_strong_recent_slope(self):
        scanner = load_scanner()

        rec, _ = scanner.classify_keyword(
            ratio=0.74,
            slope=0.5,
            verdict="fail",
            serp_auth=0,
            hist_vs_bench=0.6,
            surge=0.5,
            hist_avg=20,
        )

        self.assertEqual(rec, "⏭️ skip")

    def test_check_serp_competition_reads_signals_and_game_relevance(self):
        scanner = load_scanner()

        serp = {
            "signals": {"organicCount": 9, "authDomains": 0, "hasFeaturedSnippet": False, "nicheDomains": 5},
            "topResults": [
                {"title": "Wheel Masters: Home", "domain": "wheelmasters.com", "description": "wheel and tire performance"},
                {"title": "WHEEL MASTER - Play Online for Free!", "domain": "poki.com", "description": "Wheel Master is a physics bike game"},
            ],
        }

        is_low, organic, auth, featured, relevance = scanner.check_serp_competition(serp, "Wheel Master")

        self.assertTrue(is_low)
        self.assertEqual(organic, 9)
        self.assertEqual(auth, 0)
        self.assertFalse(featured)
        self.assertEqual(relevance, 1)

    def test_check_serp_competition_rejects_irrelevant_serp(self):
        scanner = load_scanner()

        serp = {
            "signals": {"organicCount": 9, "authDomains": 0, "hasFeaturedSnippet": False, "nicheDomains": 5},
            "topResults": [
                {"title": "Between Stops Short Film", "domain": "imdb.com", "description": "A short film"},
                {"title": "The United States needs fewer bus stops", "domain": "worksinprogress.co", "description": "transit stops"},
            ],
        }

        is_low, organic, auth, featured, relevance = scanner.check_serp_competition(serp, "Between Stops")

        self.assertFalse(is_low)
        self.assertEqual(organic, 9)
        self.assertGreaterEqual(auth, 0)
        self.assertFalse(featured)
        self.assertEqual(relevance, 0)

    def test_classify_requires_serp_game_relevance_for_niche(self):
        scanner = load_scanner()

        rec, reason = scanner.classify_keyword(
            ratio=1.24,
            slope=11,
            verdict="watch",
            serp_auth=0,
            serp_game_relevance=0,
            hist_vs_bench=0.6,
            surge=0.8,
            hist_avg=28,
        )

        self.assertEqual(rec, "⏭️ skip")
        self.assertIn("SERP首页缺少游戏相关结果", reason)

    def test_classify_defaults_to_skip_without_serp_relevance(self):
        scanner = load_scanner()

        rec, reason = scanner.classify_keyword(
            ratio=43.36,
            slope=99,
            verdict="watch",
            serp_auth=0,
            hist_vs_bench=24.5,
            surge=0.83,
            hist_avg=80.6,
        )

        self.assertEqual(rec, "⏭️ skip")
        self.assertIn("SERP首页缺少游戏相关结果", reason)


if __name__ == "__main__":
    unittest.main()
