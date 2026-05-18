import importlib.util
from pathlib import Path
import sys
import unittest


def load_serp():
    spec = importlib.util.spec_from_file_location(
        "game_radar_serp", Path(__file__).resolve().parents[1] / "scripts" / "game_radar_serp.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def serp_result(domain="store.steampowered.com", title="Ice River game on Steam", auth=0):
    return {
        "signals": {"organicCount": 10, "authDomains": auth, "hasFeaturedSnippet": False, "nicheDomains": 4},
        "topResults": [
            {"domain": domain, "title": title, "url": f"https://{domain}/app/1", "description": "Play this game"}
        ],
    }


class GameRadarSerpTest(unittest.TestCase):
    def test_passes_game_relevant_low_competition_serp(self):
        serp = load_serp()

        decision = serp.classify_serp_result(serp_result(), "Ice River")

        self.assertEqual(decision.status, "serp_pass")
        self.assertIsNone(decision.reject_reason)
        self.assertIn("serp_signal_ok", decision.reason)

    def test_fails_irrelevant_serp(self):
        serp = load_serp()

        decision = serp.classify_serp_result(serp_result(domain="example.com", title="River ice weather"), "Ice River")

        self.assertEqual(decision.status, "serp_fail")
        self.assertEqual(decision.reject_reason, "serp_not_game_relevant")

    def test_fails_high_authority_competition(self):
        serp = load_serp()

        decision = serp.classify_serp_result(serp_result(auth=3), "Ice River")

        self.assertEqual(decision.status, "serp_fail")
        self.assertEqual(decision.reject_reason, "serp_competition_high")

    def test_matches_lowercase_api_result_keys(self):
        serp = load_serp()
        results = {"it reaches": serp_result(title="It Reaches game on Steam")}

        matched = results.get("It Reaches") or {str(key).lower(): value for key, value in results.items()}.get("It Reaches".lower())

        self.assertIsNotNone(matched)


if __name__ == "__main__":
    unittest.main()
