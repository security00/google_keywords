import json
import unittest

from scripts.signal_review_queue import source_labels, status_clause


class SignalReviewQueueTest(unittest.TestCase):
    def test_status_clause_is_read_only_filter(self):
        self.assertEqual(status_clause("all"), ("", []))
        self.assertEqual(status_clause("pending"), ("WHERE accepted IS NULL OR accepted = 'pending'", []))
        self.assertEqual(status_clause("accepted"), ("WHERE accepted LIKE ?", ["accepted:%"]))
        self.assertEqual(status_clause("rejected"), ("WHERE accepted LIKE ?", ["rejected:%"]))

        with self.assertRaises(ValueError):
            status_clause("delete")

    def test_source_labels_reads_standardized_evidence(self):
        payload = {
            "evidence": [
                {"source_label": "Hacker News"},
                {"source_label": "r/sideproject"},
                {"source_label": "Hacker News"},
            ]
        }

        self.assertEqual(source_labels(json.dumps(payload)), "Hacker News, r/sideproject")

    def test_source_labels_keeps_legacy_provider_map_compatible(self):
        payload = {
            "hackernews": "Show HN title",
            "github_trending": "repo title",
        }

        self.assertEqual(source_labels(json.dumps(payload)), "github_trending, hackernews")


if __name__ == "__main__":
    unittest.main()

