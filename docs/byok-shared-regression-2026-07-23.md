# BYOK Shared Regression Record — 2026-07-23

## Status

- Production was rolled back to the previous stable Worker.
- `BYOK_PROVIDER_CONNECTIONS_ENABLED=false`.
- `BYOK_LIVE_MODE_ENABLED=false`.
- Production Shared flows recovered after rollback.
- The BYOK branch must not be merged or deployed until all quality gates pass.

## What regressed

The initial BYOK implementation changed the shared DataForSEO and OpenRouter
client factories to reject redirects globally. This unintentionally changed the
behavior of existing platform-funded Shared requests even while both BYOK
feature flags were disabled.

The original regression escaped the first smoke checks because those checks
verified cached routes and static assets, but did not force a new Shared
provider request.

## Isolation fix

The provider behavior is now split by execution mode:

- Platform-funded Shared clients retain their pre-BYOK redirect behavior.
- BYOK clients use dedicated wrappers that explicitly select manual redirect
  handling and reject every 3xx response.
- Provider credential verification uses Worker-supported manual redirect
  handling instead of `redirect: "error"`.
- BYOK settings are mounted only on the admin BYOK health page. The student
  settings page does not mount or expose the BYOK settings component.

## Added regression gates

The branch now verifies that:

1. With both BYOK flags disabled, management and live BYOK endpoints fail
   closed before authentication or provider access.
2. Shared provider clients preserve the pre-BYOK request behavior.
3. BYOK provider clients reject redirects without changing Shared clients.
4. BYOK modules cannot import the platform provider factories directly.
5. Shared runtime modules cannot import BYOK or provider-connection modules.
6. Production TypeScript cannot use the Worker-incompatible
   `redirect: "error"` option.
7. The student settings page cannot expose `ByokSettings`.

## Revised G0 acceptance

A future non-production or production G0 validation must include all of the
following while both BYOK flags remain disabled:

1. Existing cached Shared research remains readable.
2. A cache miss can create a new Shared provider request successfully.
3. The request progresses through the existing Shared job and cache chain.
4. Cron completes a full Shared Expansion cycle.
5. BYOK routes return `FEATURE_DISABLED`.
6. No BYOK credential, private cache, job, quote, or cost event is created.
7. Student-facing pages contain no BYOK controls.
8. Admin BYOK health remains read-only and reports the disabled state.

Passing cached-route smoke tests alone is no longer sufficient evidence.

## Local verification on 2026-07-23

- Vitest: 62 files, 347 tests passed.
- Python: 105 tests passed.
- Typecheck passed.
- ESLint: 0 errors; 16 pre-existing warnings.
- Migration structure passed: 24 migrations.
- Student paid-provider guard passed.
- BYOK isolation guard passed.
- Cloudflare generated types are current.
- OpenNext production build passed.
- Wrangler deploy dry-run passed with both BYOK flags disabled.

The dependency audit remains blocking because the existing dependency graph
reports five high-severity advisories across Next.js and the
sharp/miniflare/Wrangler chain. Dependency remediation must be evaluated as a
separate controlled change; this BYOK incident patch does not bypass or weaken
that gate.
