# Dependency Security Upgrade — 2026-07-23

## Scope

This change is isolated from the BYOK behavior fix. It updates only application
and Worker build dependencies required to clear the repository's high-severity
dependency audit gate.

## Upgrade set

- Next.js: `16.2.10` → `16.2.11`
- `@next/swc-wasm-nodejs`: `16.2.10` → `16.2.11`
- `eslint-config-next`: `16.2.10` → `16.2.11`
- `@opennextjs/cloudflare`: `1.20.1` → `1.20.2`
- Wrangler: `4.112.0` → `4.113.0`
- sharp: resolved globally to `0.35.3`

Next.js `16.2.11` contains the published fixes for the July 2026 Next.js
advisories. OpenNext `1.20.2` declares compatibility with Next.js `16.2.11`
and Wrangler 4.x.

The sharp override is intentional. Next.js and Miniflare otherwise resolve
sharp `0.34.5`, which is affected by the inherited libvips vulnerabilities
reported in `GHSA-f88m-g3jw-g9cj`. The override replaces the transitive
resolution with sharp `0.35.3`; the complete test, build, dry-run, and startup
checks below validate that replacement in this project.

## Reproducibility and audit

- A clean `npm ci` completed successfully on Node.js 22.
- `npm ls` resolves one deduplicated sharp `0.35.3` for Next.js and Miniflare.
- `npm audit --audit-level=high` reports zero vulnerabilities.

## Compatibility validation

- 62 Vitest files / 347 tests passed.
- 105 Python tests passed.
- Student paid-provider and BYOK isolation guards passed.
- ESLint completed with zero errors and the existing 16 warnings.
- Typecheck, migration structure, business-rules sync, and Cloudflare type
  checks passed.
- OpenNext production build passed with Next.js `16.2.11` and OpenNext
  `1.20.2`.
- Wrangler `4.113.0` deployment dry-run passed.
- Both BYOK feature flags remained `false` in the dry-run binding report.
- Wrangler startup analysis completed successfully.

This evidence authorizes non-production validation only. It does not authorize
merging to `main`, applying migrations, enabling BYOK, or deploying to
production.
