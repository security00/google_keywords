from __future__ import annotations

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
TARGETS = (
    ROOT / "lib" / "byok",
    ROOT / "lib" / "provider-connections",
    ROOT / "app" / "api" / "research" / "byok",
    ROOT / "app" / "api" / "provider-connections",
    ROOT / "components" / "byok-settings.tsx",
)
FORBIDDEN = {
    "platform DataForSEO client": re.compile(r"\bgetPlatformDataForSeoClient\b"),
    "platform OpenRouter client": re.compile(r"\bgetPlatformOpenRouterClient\b"),
    "platform DataForSEO credential": re.compile(r"process\.env\.DATAFORSEO_(?:LOGIN|PASSWORD)"),
    "platform OpenRouter credential": re.compile(r"process\.env\.OPENROUTER_(?:API_KEY|MODEL|BASE_URL)"),
    "shared cache scope": re.compile(r"type\s*:\s*[\"']shared[\"']"),
    "legacy cache read": re.compile(r"allowLegacyRead\s*:\s*true"),
    "legacy/shared research namespace": re.compile(
        r"namespace\s*:\s*[\"'](?:expand-result|compare-result|trends-result|serp-result|legacy)[\"']"
    ),
}


def production_typescript_files() -> list[Path]:
    files: list[Path] = []
    for target in TARGETS:
        if not target.exists():
            continue
        candidates = [target] if target.is_file() else target.rglob("*.ts*")
        for path in candidates:
            if path.name.endswith(".test.ts"):
                continue
            files.append(path)
    return sorted(files)


def main() -> int:
    violations: list[str] = []
    files = production_typescript_files()
    if not files:
        violations.append("no BYOK production TypeScript files found")
    for path in files:
        text = path.read_text(encoding="utf-8")
        relative = path.relative_to(ROOT)
        for label, pattern in FORBIDDEN.items():
            for match in pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                violations.append(f"{relative}:{line}: forbidden {label}")
    if violations:
        print("BYOK isolation guard failed:", file=sys.stderr)
        for violation in violations:
            print(f"- {violation}", file=sys.stderr)
        return 1
    print(f"BYOK isolation guard OK: {len(files)} production files checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
