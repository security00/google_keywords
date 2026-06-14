import importlib.util
from pathlib import Path
import tempfile
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

    def test_fetch_roblox_search_extracts_game_results(self):
        scanner = load_scanner()

        payload = {
            "searchResults": [
                {
                    "contentGroupType": "Game",
                    "contents": [
                        {
                            "name": "[UPD] Fresh Roblox Planet 🚀",
                            "rootPlaceId": 123,
                        },
                        {
                            "name": "Free Online Games",
                            "rootPlaceId": 456,
                        },
                        {
                            "name": "[UPD] Fresh Roblox Planet 🚀",
                            "rootPlaceId": 789,
                        },
                    ],
                },
                {"contentGroupType": "User", "contents": [{"name": "Fresh Roblox Planet"}]},
            ]
        }
        response = MagicMock()
        response.__enter__.return_value.read.return_value = scanner.json.dumps(payload).encode("utf-8")

        with patch.object(scanner.urllib.request, "urlopen", return_value=response), \
             patch.object(scanner.time, "sleep"):
            games = scanner.fetch_roblox_search()

        self.assertEqual(games, [{"name": "Fresh Roblox Planet", "source": "roblox", "roblox_place_id": 123}])

    def test_select_games_to_check_weights_sources_after_daily_floor(self):
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
            ["crazygames", "steam", "poki", "steam", "steam", "steam"],
        )

    def test_select_games_to_check_keeps_one_floor_for_low_weight_sources(self):
        scanner = load_scanner()

        games = (
            [{"name": f"Crazy {i}", "source": "crazygames"} for i in range(5)]
            + [{"name": "Steam 0", "source": "steam"}]
            + [{"name": "Itch 0", "source": "itchio-free"}]
        )

        selected = scanner.select_games_to_check(games, checked_names=set(), max_keywords=5)

        self.assertEqual(
            [game["source"] for game in selected],
            ["crazygames", "steam", "itchio-free", "crazygames", "crazygames"],
        )

    def test_select_games_to_check_prioritizes_watchlist_rechecks(self):
        scanner = load_scanner()

        games = (
            [{"name": f"Crazy {i}", "source": "crazygames"} for i in range(5)]
            + [{"name": "Watched One", "source": "itchio-free"}]
            + [{"name": "Watched Two", "source": "itchio-free"}]
            + [{"name": "Steam 0", "source": "steam"}]
        )

        selected = scanner.select_games_to_check(
            games,
            checked_names=set(),
            max_keywords=5,
            watchlist_names={"watched one", "watched two"},
        )

        self.assertEqual([game["name"] for game in selected[:2]], ["Watched One", "Watched Two"])

    def test_select_games_to_check_skips_already_checked_names(self):
        scanner = load_scanner()

        games = [
            {"name": "Already Done", "source": "crazygames"},
            {"name": "Fresh Steam", "source": "steam"},
        ]

        selected = scanner.select_games_to_check(games, checked_names={"already done"}, max_keywords=10)

        self.assertEqual(selected, [{"name": "Fresh Steam", "source": "steam"}])

    def test_call_trends_api_saves_pending_job_on_timeout(self):
        scanner = load_scanner()

        with tempfile.TemporaryDirectory() as tmpdir:
            scanner.TRENDS_PENDING_JOBS_FILE = str(Path(tmpdir) / "pending.json")
            submit = MagicMock()
            submit.returncode = 0
            submit.stdout = scanner.json.dumps({
                "jobId": "job-123456",
                "status": "processing",
                "total": 2,
                "cost": {"actualCostUsd": 0.0045},
            })
            poll = MagicMock()
            poll.returncode = 0
            poll.stdout = scanner.json.dumps({"status": "processing", "progress": "0/2 tasks ready"})

            with patch.object(scanner.subprocess, "run", side_effect=[submit, poll]), \
                 patch.object(scanner.time, "time", side_effect=[0, 1, 1]):
                resp = scanner.call_trends_api(["Fresh Steam", "Fresh Poki"], max_wait=0)

            self.assertEqual(resp["status"], "pending")
            self.assertEqual(resp["jobId"], "job-123456")
            pending = scanner.load_pending_trends_jobs()
            self.assertEqual(len(pending), 1)
            self.assertEqual(next(iter(pending.values()))["jobId"], "job-123456")

    def test_call_trends_api_resumes_saved_pending_job(self):
        scanner = load_scanner()

        with tempfile.TemporaryDirectory() as tmpdir:
            scanner.TRENDS_PENDING_JOBS_FILE = str(Path(tmpdir) / "pending.json")
            key = scanner.trends_pending_key(["Fresh Steam", "Fresh Poki"])
            scanner.remember_pending_trends_job(key, {
                "jobId": "job-123456",
                "keywords": ["Fresh Steam", "Fresh Poki"],
                "days": scanner.TREND_DAYS,
                "endpointLabel": "trends_14d",
                "taskCount": 2,
                "actualCostUsd": 0.0045,
                "cost": {"actualCostUsd": 0.0045},
            })
            poll = MagicMock()
            poll.returncode = 0
            poll.stdout = scanner.json.dumps({
                "status": "complete",
                "results": [{"keyword": "Fresh Steam", "ratioMean": 1.2}],
            })

            with patch.object(scanner.subprocess, "run", return_value=poll), \
                 patch.object(scanner, "record_trends_cost") as record_cost:
                resp = scanner.call_trends_api(["Fresh Steam", "Fresh Poki"], max_wait=0)

            self.assertEqual(resp["status"], "complete")
            self.assertTrue(resp["fromPendingJob"])
            self.assertEqual(resp["results"][0]["keyword"], "Fresh Steam")
            self.assertEqual(scanner.load_pending_trends_jobs(), {})
            record_cost.assert_called_once()

    def test_game_name_filter_rejects_generic_non_game_phrases(self):
        scanner = load_scanner()

        self.assertFalse(scanner.is_game_name_valid("Machine Learning"))
        self.assertFalse(scanner.is_game_name_valid("Data Science"))
        self.assertFalse(scanner.is_game_name_valid("chud the builder givesendgo"))
        self.assertFalse(scanner.is_game_name_valid("streamer legal fund gofundme"))
        self.assertTrue(scanner.is_game_name_valid("It Reaches"))
        self.assertTrue(scanner.is_game_name_valid("Metro 2033"))

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

    def test_classify_low_trend_relevant_game_as_watchlist_not_recommended(self):
        scanner = load_scanner()

        rec, reason = scanner.classify_keyword(
            ratio=0.08,
            slope=0.3,
            verdict="fail",
            serp_auth=0,
            serp_game_relevance=1,
            hist_vs_bench=0.2,
            surge=1.1,
            hist_avg=4,
        )

        self.assertEqual(rec, scanner.WATCHLIST_RECOMMENDATION)
        self.assertIn("观察名单", reason)

    def test_serp_relevance_query_adds_source_context(self):
        scanner = load_scanner()

        self.assertEqual(scanner.serp_relevance_query("Brookhaven RP", "roblox"), "Brookhaven RP roblox")
        self.assertEqual(scanner.serp_relevance_query("Lost Castle 2", "steam"), "Lost Castle 2 steam")
        self.assertEqual(scanner.serp_relevance_query("Tap Out", "crazygames"), "Tap Out game")

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
