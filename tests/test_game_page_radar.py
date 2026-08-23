import importlib.util
from pathlib import Path
import sys
import unittest


def load_radar():
    spec = importlib.util.spec_from_file_location(
        "game_page_radar", Path(__file__).resolve().parents[1] / "scripts" / "game_page_radar.py"
    )
    radar = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = radar
    spec.loader.exec_module(radar)
    return radar


class GamePageRadarTest(unittest.TestCase):
    def test_url_filter_keeps_game_pages(self):
        radar = load_radar()
        source = {
            "url_include_patterns": '["/en/g/"]',
            "url_exclude_patterns": '["/category/", "/privacy"]',
        }

        self.assertTrue(radar.is_candidate_url("https://poki.com/en/g/wheel-master", source))
        self.assertFalse(radar.is_candidate_url("https://poki.com/en/category/action", source))
        self.assertFalse(radar.is_candidate_url("https://poki.com/privacy", source))

    def test_extract_keyword_from_known_slug(self):
        radar = load_radar()
        source = {"keyword_extract_rule": '{"type":"slug","stripPrefix":"/en/g/"}'}

        extracted = radar.extract_keyword_from_url("https://poki.com/en/g/wheel-master", source)

        self.assertEqual(extracted.method, "slug")
        self.assertEqual(extracted.keyword, "Wheel Master")
        self.assertEqual(extracted.normalized, "wheel master")

    def test_clean_keyword_removes_site_boilerplate(self):
        radar = load_radar()

        self.assertEqual(
            radar.clean_keyword("Play Wheel Master Online for Free"),
            "Wheel Master",
        )

    def test_onlinegames_and_freegames_and_coolmath_filters(self):
        radar = load_radar()
        onlinegames = {
            "url_include_patterns": "[]",
            "url_exclude_patterns": '["/about", "/privacy"]',
            "keyword_extract_rule": '{"type":"slug"}',
        }
        freegames = {
            "url_include_patterns": '["/game/"]',
            "url_exclude_patterns": '["/category/"]',
            "keyword_extract_rule": '{"type":"slug","stripPrefix":"/game/"}',
        }
        coolmath = {
            "url_include_patterns": '["/0-"]',
            "url_exclude_patterns": '["/c/"]',
            "keyword_extract_rule": '{"type":"slug","stripPrefix":"0-"}',
        }

        self.assertTrue(radar.is_candidate_url("https://www.onlinegames.io/monster-truck-mountain-climb/", onlinegames))
        self.assertFalse(radar.is_candidate_url("https://www.onlinegames.io/about", onlinegames))
        self.assertEqual(
            radar.extract_keyword_from_url("https://www.onlinegames.io/monster-truck-mountain-climb/", onlinegames).keyword,
            "Monster Truck Mountain Climb",
        )

        self.assertTrue(radar.is_candidate_url("https://www.freegames.com/game/Steal-An-Egg", freegames))
        self.assertFalse(radar.is_candidate_url("https://www.freegames.com/category/action", freegames))
        self.assertEqual(
            radar.extract_keyword_from_url("https://www.freegames.com/game/Steal-An-Egg", freegames).keyword,
            "Steal an Egg",
        )

        self.assertTrue(radar.is_candidate_url("https://www.coolmathgames.com/0-spaceburst", coolmath))
        self.assertFalse(radar.is_candidate_url("https://www.coolmathgames.com/c/logic-games", coolmath))
        self.assertEqual(
            radar.extract_keyword_from_url("https://www.coolmathgames.com/0-spaceburst", coolmath).keyword,
            "Spaceburst",
        )

    def test_rejects_generic_or_non_game_slugs(self):
        radar = load_radar()
        source = {"keyword_extract_rule": '{"type":"slug"}'}

        self.assertIsNone(radar.extract_keyword_from_url("https://example.com/privacy", source))
        self.assertIsNone(radar.extract_keyword_from_url("https://example.com/games", source))
        self.assertIsNone(radar.extract_keyword_from_url("https://example.com/12345", source))

    def test_parse_sitemap_urls_sorts_newest_lastmod_first(self):
        radar = load_radar()
        xml = """
        <urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">
          <url><loc>https://example.com/game/old-game</loc><lastmod>2026-04-01</lastmod></url>
          <url><loc>https://example.com/game/new-game</loc><lastmod>2026-05-08</lastmod></url>
          <url><loc>https://example.com/game/no-date-game</loc></url>
        </urlset>
        """

        entries = radar.parse_sitemap_entries(xml)

        self.assertEqual(
            [entry.url for entry in entries],
            [
                "https://example.com/game/new-game",
                "https://example.com/game/old-game",
                "https://example.com/game/no-date-game",
            ],
        )


if __name__ == "__main__":
    unittest.main()
