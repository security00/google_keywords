
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch


def load_release_radar():
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    spec = importlib.util.spec_from_file_location(
        "game_release_radar", root / "scripts" / "game_release_radar.py"
    )
    radar = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = radar
    spec.loader.exec_module(radar)
    return radar


class GameReleaseRadarTest(unittest.TestCase):
    def test_fetch_steam_new_filters_noise_and_builds_release_candidates(self):
        radar = load_release_radar()
        payload = {
            "new_releases": {
                "items": [
                    {"id": 10, "name": "Fresh Planet"},
                    {"id": 11, "name": "Hentai Noise"},
                    {"id": 14, "name": "High Pleasure Mall"},
                    {"id": 12, "name": "Free Online Games"},
                    {"id": 13, "name": "Fresh Planet"},
                ]
            }
        }
        response = MagicMock()
        response.__enter__.return_value.read.return_value = radar.json.dumps(payload).encode("utf-8")

        with patch.object(radar.urllib.request, "urlopen", return_value=response):
            candidates = radar.fetch_steam_new()

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].keyword, "Fresh Planet")
        self.assertEqual(candidates[0].source_id, "steam-new")
        self.assertEqual(candidates[0].url, "https://store.steampowered.com/app/10")

    def test_fetch_itchio_new_extracts_game_urls(self):
        radar = load_release_radar()
        html = '''
          <a href="https://studio-one.itch.io/fresh-planet"></a>
          <a href="https://studio-two.itch.io/free-online-games"></a>
          <a href="https://studio-one.itch.io/fresh-planet"></a>
        '''
        response = MagicMock()
        response.__enter__.return_value.read.return_value = html.encode("utf-8")

        with patch.object(radar.urllib.request, "urlopen", return_value=response):
            candidates = radar.fetch_itchio("itchio-new")

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].keyword, "Fresh Planet")
        self.assertEqual(candidates[0].source_id, "itchio-new")
        self.assertEqual(candidates[0].url, "https://studio-one.itch.io/fresh-planet")


if __name__ == "__main__":
    unittest.main()
