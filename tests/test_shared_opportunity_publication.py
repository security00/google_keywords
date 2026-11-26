import unittest
from unittest.mock import patch

from scripts import precompute_shared_expand as driver


class SharedOpportunityPublicationTest(unittest.TestCase):
    def setUp(self):
        self.expand = {
            "dateTo": "2026-11-25",
            "candidates": [{"keyword": "Demo", "source": "editor"}, {"keyword": "demo", "source": "tool"}],
        }
        self.result = {"keyword": "demo", "verdict": "pass", "ratioRecent": 1.2}

    @patch.object(driver, "curl_json", return_value={"ok": True})
    def test_posts_only_shared_projection_with_sorted_roots(self, post):
        driver.publish_shared_opportunities(self.expand, {"results": [self.result]}, ["Demo"])
        method, path, payload = post.call_args.args
        self.assertEqual((method, path), ("POST", "/api/cron/shared-opportunities"))
        self.assertEqual(payload["items"][0]["roots"], ["editor", "tool"])
        self.assertEqual(payload["dataDate"], "2026-11-25")
        self.assertEqual(payload["items"][0]["ratioRecent"], 1.2)

    @patch.object(driver, "curl_json")
    def test_rejects_sessions_foreign_keywords_and_missing_results(self, post):
        for comparison in [
            {"sessionId": "private", "results": [self.result]},
            {"comparisonId": "private", "results": [self.result]},
            {"results": [dict(self.result, keyword="another")]},
            {"status": "complete"},
        ]:
            with self.subTest(comparison=comparison), self.assertRaises(RuntimeError):
                driver.publish_shared_opportunities(self.expand, comparison, ["demo"])
        post.assert_not_called()
