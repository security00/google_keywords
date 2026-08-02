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
WORKER_RUNTIME_ROOTS = (
    ROOT / "app",
    ROOT / "lib",
    ROOT / "components",
)
SHARED_RUNTIME_TARGETS = (
    ROOT / "app" / "api" / "research",
    ROOT / "lib" / "expand",
    ROOT / "lib" / "compare",
    ROOT / "lib" / "serp.ts",
    ROOT / "lib" / "ai-intent.ts",
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
DIRECT_PROVIDER_FACTORY = re.compile(
    r"\b(?:createDataForSeoClient|createOpenRouterClient)\b"
)
WORKER_UNSUPPORTED_REDIRECT = re.compile(
    r"redirect\s*:\s*[\"']error[\"']"
)
SHARED_IMPORTS_BYOK = re.compile(
    r"from\s+[\"']@/lib/(?:byok|provider-connections)(?:/|[\"'])"
)


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


def production_files_under(targets: tuple[Path, ...]) -> list[Path]:
    files: list[Path] = []
    for target in targets:
        if not target.exists():
            continue
        candidates = [target] if target.is_file() else target.rglob("*.ts*")
        for path in candidates:
            if path.name.endswith(".test.ts"):
                continue
            files.append(path)
    return sorted(set(files))


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
        if (
            relative.parts[:2] == ("lib", "byok")
            and relative != Path("lib/byok/provider-clients.ts")
        ):
            for match in DIRECT_PROVIDER_FACTORY.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                violations.append(
                    f"{relative}:{line}: BYOK must use the redirect-isolated provider wrapper"
                )

    for path in production_files_under(WORKER_RUNTIME_ROOTS):
        text = path.read_text(encoding="utf-8")
        relative = path.relative_to(ROOT)
        for match in WORKER_UNSUPPORTED_REDIRECT.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            violations.append(
                f"{relative}:{line}: redirect='error' is unsupported by Cloudflare Workers"
            )

    for path in production_files_under(SHARED_RUNTIME_TARGETS):
        if "byok" in path.relative_to(ROOT).parts:
            continue
        text = path.read_text(encoding="utf-8")
        relative = path.relative_to(ROOT)
        for match in SHARED_IMPORTS_BYOK.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            violations.append(
                f"{relative}:{line}: Shared runtime path imports BYOK implementation"
            )

    student_settings = ROOT / "app" / "dashboard" / "settings" / "page.tsx"
    if student_settings.exists():
        text = student_settings.read_text(encoding="utf-8")
        if "showResearchTools={true}" in text:
            line = text.count("\n", 0, text.index("showResearchTools={true}")) + 1
            violations.append(
                f"{student_settings.relative_to(ROOT)}:{line}: student settings expose BYOK research tools"
            )
    byok_settings = ROOT / "components" / "byok-settings.tsx"
    if byok_settings.exists():
        text = byok_settings.read_text(encoding="utf-8")
        if "showResearchTools = false" not in text:
            violations.append(
                f"{byok_settings.relative_to(ROOT)}: BYOK research tools must remain hidden by default"
            )
    if violations:
        print("BYOK isolation guard failed:", file=sys.stderr)
        for violation in violations:
            print(f"- {violation}", file=sys.stderr)
        return 1
    print(f"BYOK isolation guard OK: {len(files)} production files checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
