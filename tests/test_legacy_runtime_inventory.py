import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class LegacyRuntimeInventoryTest(unittest.TestCase):
    def test_serp_confidence_runtime_access_is_removed(self) -> None:
        matches = []
        for path in list((ROOT / "app").rglob("*.ts")) + list((ROOT / "lib").rglob("*.ts")):
            if "serp_confidence_cache" in path.read_text(encoding="utf-8"):
                matches.append(path.relative_to(ROOT).as_posix())
        self.assertEqual(matches, [])

    def test_active_sitemap_paths_remain_documented(self) -> None:
        inventory = (ROOT / "docs/legacy-runtime-inventory.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("Status: UI step 1 started; tables and cron remain active.", inventory)
        self.assertIn("Independent deletion", inventory)
        self.assertTrue((ROOT / "app/api/sitemaps/scan/route.ts").exists())
        self.assertTrue((ROOT / "app/dashboard/discovery/page.tsx").exists())


if __name__ == "__main__":
    unittest.main()
