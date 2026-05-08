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


if __name__ == "__main__":
    unittest.main()
