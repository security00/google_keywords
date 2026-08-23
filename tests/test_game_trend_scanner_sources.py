import importlib.util
from pathlib import Path
import tempfile
import unittest
import urllib.error
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

    def test_fetch_steam_top_sellers_keeps_recent_hot_games(self):
        scanner = load_scanner()

        search_payload = {
            "results_html": """
              <a href="https://store.steampowered.com/app/4704690/MECCHA_CHAMELEON/"
                 data-ds-appid="4704690" class="search_result_row">
                <span class="title">MECCHA CHAMELEON</span>
              </a>
              <a href="https://store.steampowered.com/app/730/CounterStrike_2/"
                 data-ds-appid="730" class="search_result_row">
                <span class="title">Counter-Strike 2</span>
              </a>
            """
        }
        responses = []
        for payload in [
            search_payload,
            {"4704690": {"success": True, "data": {"release_date": {"coming_soon": False, "date": "9 Jun, 2026"}}}},
            {"730": {"success": True, "data": {"release_date": {"coming_soon": False, "date": "21 Aug, 2012"}}}},
        ]:
            response = MagicMock()
            response.__enter__.return_value.read.return_value = scanner.json.dumps(payload).encode("utf-8")
            responses.append(response)

        with patch.object(scanner.urllib.request, "urlopen", side_effect=responses), \
             patch.object(scanner, "is_recent_steam_release", side_effect=lambda date: date == "9 Jun, 2026"), \
             patch.object(scanner.time, "sleep"):
            games = scanner.fetch_steam_top_sellers()

        self.assertEqual(games, [{"name": "MECCHA CHAMELEON", "source": "steam-topsellers", "steam_id": "4704690"}])

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

    def test_fetch_roblox_search_continues_after_query_429(self):
        scanner = load_scanner()
        payload = {
            "searchResults": [
                {
                    "contentGroupType": "Game",
                    "contents": [{"name": "Fresh Roblox Planet", "rootPlaceId": 123}],
                }
            ]
        }
        response = MagicMock()
        response.__enter__.return_value.read.return_value = scanner.json.dumps(payload).encode("utf-8")
        rate_limited = urllib.error.HTTPError("https://roblox.test", 429, "Too Many Requests", {}, None)

        with patch.object(scanner.urllib.request, "urlopen", side_effect=[rate_limited, response]), \
             patch.object(scanner.time, "sleep"), \
             patch.object(scanner, "ROBLOX_SEARCH_QUERIES", ["new roblox game", "new simulator"]):
            games = scanner.fetch_roblox_search()

        self.assertEqual(games, [{"name": "Fresh Roblox Planet", "source": "roblox", "roblox_place_id": 123}])

    def test_select_games_to_check_weights_sources_after_daily_floor(self):
        scanner = load_scanner()

        games = (
            [{"name": f"Crazy {i}", "source": "crazygames"} for i in range(10)]
            + [{"name": f"Steam {i}", "source": "steam"} for i in range(4)]
            + [{"name": "Top Seller 0", "source": "steam-topsellers"}]
            + [{"name": "Top Seller 1", "source": "steam-topsellers"}]
            + [{"name": f"Poki {i}", "source": "poki"} for i in range(4)]
        )

        selected = scanner.select_games_to_check(games, checked_names=set(), max_keywords=7)

        self.assertEqual(len(selected), 7)
        self.assertEqual(
            [game["source"] for game in selected],
            ["crazygames", "steam", "steam-topsellers", "poki", "steam-topsellers", "steam", "steam"],
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

    def test_steam_web_api_helpers_are_noop_without_key(self):
        scanner = load_scanner()
        with patch.dict(scanner.os.environ, {"STEAM_WEB_API_KEY": ""}, clear=False):
            games = [{"name": "Fresh Steam", "source": "steam", "steam_id": "1"}]
            self.assertIsNone(scanner.fetch_steam_player_count("730"))
            self.assertEqual(scanner.fetch_steam_charts_recent(), [])
            self.assertEqual(scanner.enrich_games_with_steam_players(games), games)
            self.assertNotIn("steam_player_count", games[0])

    def test_player_count_boosts_steam_selection_without_starving_other_sources(self):
        scanner = load_scanner()
        games = (
            [{"name": f"Crazy {i}", "source": "crazygames"} for i in range(4)]
            + [{"name": "Quiet Steam", "source": "steam", "steam_player_count": 3}]
            + [{"name": "Hot Steam", "source": "steam", "steam_player_count": 50000}]
        )
        selected = scanner.select_games_to_check(games, checked_names=set(), max_keywords=3)
        self.assertEqual(
            [game["name"] for game in selected],
            ["Crazy 0", "Hot Steam", "Quiet Steam"],
        )

    def test_append_steam_player_reason_is_idempotent(self):
        scanner = load_scanner()
        reason = scanner.append_steam_player_reason("14d rising vs gpts", 12345)
        self.assertEqual(reason, "Steam在线 12,345人 · 14d rising vs gpts")
        self.assertEqual(scanner.append_steam_player_reason(reason, 12345), reason)
        self.assertEqual(
            scanner.append_steam_player_reason(reason, 999),
            "Steam在线 999人 · 14d rising vs gpts",
        )
        self.assertIsNone(scanner.append_steam_player_reason(None, None))

    def test_search_steam_app_id_requires_normalized_exact_name(self):
        scanner = load_scanner()
        payload = {
            "items": [
                {"type": "bundle", "name": "How to Fish", "id": 1},
                {"type": "app", "name": "How to Fish!", "id": 4001890},
                {"type": "app", "name": "How to Fish 2", "id": 99},
            ]
        }
        response = MagicMock()
        response.__enter__.return_value.read.return_value = scanner.json.dumps(payload).encode("utf-8")
        with patch.object(scanner.urllib.request, "urlopen", return_value=response):
            self.assertEqual(scanner.search_steam_app_id("How to Fish"), "4001890")

        payload["items"] = [{"type": "app", "name": "Something Else", "id": 2}]
        response.__enter__.return_value.read.return_value = scanner.json.dumps(payload).encode("utf-8")
        with patch.object(scanner.urllib.request, "urlopen", return_value=response):
            self.assertIsNone(scanner.search_steam_app_id("How to Fish"))

    def test_refresh_steam_player_reasons_is_noop_without_key(self):
        scanner = load_scanner()
        with patch.dict(scanner.os.environ, {"STEAM_WEB_API_KEY": ""}, clear=False), \
             patch.object(scanner, "d1_query") as query:
            self.assertEqual(scanner.refresh_steam_player_reasons(), 0)
            query.assert_not_called()
            self.assertEqual(scanner.refresh_steam_player_reasons(require_key=True), 1)
            query.assert_not_called()

    def test_refresh_steam_player_reasons_updates_matching_steam_rows(self):
        scanner = load_scanner()
        rows = [
            {"keyword": "How to Fish", "source_site": "steam-topsellers", "reason": "14d rising vs gpts"},
            {"keyword": "Roblox Homonym", "source_site": "roblox", "reason": "should not be queried"},
        ]
        with patch.dict(scanner.os.environ, {
            "STEAM_WEB_API_KEY": "test-key",
            "CF_ACCOUNT_ID": "acct",
            "CF_API_TOKEN": "token",
        }, clear=False), \
             patch.object(scanner, "D1_ACCOUNT_ID", "acct"), \
             patch.object(scanner, "D1_API_TOKEN", "token"), \
             patch.object(scanner, "d1_query", return_value=rows[:1]) as query, \
             patch.object(scanner, "d1_execute", return_value=True) as execute, \
             patch.object(scanner, "search_steam_app_id", return_value="4001890") as search, \
             patch.object(scanner, "fetch_steam_player_count", return_value=263000) as ccu, \
             patch.object(scanner.time, "sleep"):
            self.assertEqual(scanner.refresh_steam_player_reasons(), 0)

        query.assert_called_once()
        search.assert_called_once_with("How to Fish")
        ccu.assert_called_once_with("4001890")
        execute.assert_called_once_with(
            "UPDATE game_keyword_pipeline SET reason = ? WHERE keyword = ? AND source_site = ?",
            ["Steam在线 263,000人 · 14d rising vs gpts", "How to Fish", "steam-topsellers"],
        )

    def test_refresh_steam_player_reasons_dry_run_does_not_write(self):
        scanner = load_scanner()
        rows = [{"keyword": "How to Fish", "source_site": "steam", "reason": None}]
        with patch.dict(scanner.os.environ, {"STEAM_WEB_API_KEY": "test-key"}, clear=False), \
             patch.object(scanner, "D1_ACCOUNT_ID", "acct"), \
             patch.object(scanner, "D1_API_TOKEN", "token"), \
             patch.object(scanner, "d1_query", return_value=rows), \
             patch.object(scanner, "d1_execute") as execute, \
             patch.object(scanner, "search_steam_app_id", return_value="4001890"), \
             patch.object(scanner, "fetch_steam_player_count", return_value=10), \
             patch.object(scanner.time, "sleep"):
            self.assertEqual(scanner.refresh_steam_player_reasons(dry_run=True), 0)
        execute.assert_not_called()

    def test_fetch_steam_charts_recent_keeps_recent_games_only(self):
        scanner = load_scanner()
        charts = {"response": {"ranks": [{"appid": 11, "peak_in_game": 9000}, {"appid": 22, "peak_in_game": 800}]}}

        def fake_get(method_path, params=None):
            self.assertEqual(method_path, "ISteamChartsService/GetMostPlayedGames/v1/")
            return charts

        def fake_basic(app_id):
            if str(app_id) == "11":
                return {"name": "Fresh Chart Game", "type": "game", "coming_soon": False, "release_date": "1 Aug, 2026"}
            return {"name": "Old Chart Game", "type": "game", "coming_soon": False, "release_date": "1 Aug, 2012"}

        with patch.dict(scanner.os.environ, {"STEAM_WEB_API_KEY": "test-key"}, clear=False), \
             patch.object(scanner, "steam_web_api_get", side_effect=fake_get), \
             patch.object(scanner, "fetch_steam_app_basic", side_effect=fake_basic), \
             patch.object(scanner, "is_recent_steam_release", side_effect=lambda date: date == "1 Aug, 2026"), \
             patch.object(scanner, "fetch_steam_player_count", return_value=4321), \
             patch.object(scanner.time, "sleep"):
            games = scanner.fetch_steam_charts_recent(max_lookups=10)

        self.assertEqual(
            games,
            [{"name": "Fresh Chart Game", "source": "steam-charts", "steam_id": "11", "steam_player_count": 4321}],
        )

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
