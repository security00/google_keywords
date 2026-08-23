import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class GameRadarCandidateSitemapsMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        self.addCleanup(self.connection.close)
        for name in (
            "0009_game_page_radar.sql",
            "0010_game_radar_source_notes.sql",
            "0030_game_radar_candidate_sitemaps.sql",
        ):
            sql = (ROOT / "migrations/d1" / name).read_text(encoding="utf-8")
            self.connection.executescript(sql)

    def test_enables_usable_sitemaps_and_parks_the_rest(self):
        enabled = {
            row["id"]
            for row in self.connection.execute(
                "SELECT id FROM game_radar_sources WHERE enabled = 1"
            )
        }
        parked = {
            row["id"]
            for row in self.connection.execute(
                "SELECT id FROM game_radar_sources WHERE enabled = 0"
            )
        }
        self.assertIn("onlinegames-io", enabled)
        self.assertIn("freegames-com", enabled)
        self.assertIn("coolmathgames", enabled)
        self.assertTrue({"lagged", "arkadium", "gamemonetize", "minijuegos"} <= parked)

    def test_does_not_reenable_existing_crazygames_row(self):
        self.connection.execute(
            "UPDATE game_radar_sources SET enabled = 0 WHERE id = 'crazygames'"
        )
        sql = (ROOT / "migrations/d1/0030_game_radar_candidate_sitemaps.sql").read_text(
            encoding="utf-8"
        )
        self.connection.executescript(sql)
        row = self.connection.execute(
            "SELECT enabled FROM game_radar_sources WHERE id = 'crazygames'"
        ).fetchone()
        self.assertEqual(row["enabled"], 0)

    def test_coolmath_only_matches_game_prefix(self):
        row = self.connection.execute(
            "SELECT url_include_patterns, url_exclude_patterns FROM game_radar_sources WHERE id = 'coolmathgames'"
        ).fetchone()
        self.assertIn("/0-", row["url_include_patterns"])
        self.assertIn("/c/", row["url_exclude_patterns"])
