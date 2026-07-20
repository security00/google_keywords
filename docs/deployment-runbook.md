# Production Delivery Runbook

## Delivery flow

1. Push changes to a non-`main` branch and open a pull request.
2. The `validate` job runs without production secrets. It executes all tests,
   security and migration structure checks, then builds and packages the Worker
   on Linux without deploying it.
3. Require the `Quality gates and Linux build` check before merging.
4. A push or manual workflow run on `main` starts the `deploy` job in the
   GitHub `production` environment.
5. The deploy job rebuilds the exact commit on Linux, records the current D1
   Time Travel bookmark, previews and applies pending migrations, verifies the
   migration ledger, deploys the Worker, and performs no-cost production smoke
   tests.

Pull requests never receive Cloudflare credentials and never modify D1 or
Worker traffic.

## Required GitHub secrets

The repository or `production` environment must define:

- `CF_API_TOKEN`: scoped to this account with Workers Scripts edit plus D1 read
  and edit permissions.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account containing the Worker and D1
  database.

Never store either value in the repository. Prefer environment-scoped secrets
and configure required reviewers for the `production` environment when the
GitHub plan supports deployment protection rules.

## Migration and rollback boundaries

- D1 migrations are additive, immutable, and run before application traffic is
  changed. A failed migration stops the job before Worker deployment.
- The migration runner is executed again after `--apply`; a checksum mismatch
  or remaining migration fails the deployment.
- A post-deploy smoke failure automatically rolls the Worker back to the prior
  deployment and verifies the recovered public paths.
- D1 Time Travel restore is intentionally manual because it overwrites the
  database and cancels in-flight work. Use the bookmark printed by the deploy
  job only after confirming data corruption; application errors should use a
  Worker rollback without restoring D1.

## Static assets and rollout strategy

The Next.js build uses content-hashed static assets. Until Cloudflare version
affinity is configured, do not leave two Worker versions in a long-lived
traffic split: HTML from one version can request assets unavailable in the
other version. The automated workflow therefore performs a tested 100% deploy
and relies on immediate Worker rollback if the smoke check fails.

## No-cost smoke scope

`npm run smoke:production` checks public pages, the anonymous session endpoint,
authorization rejection on protected endpoints, and every Next.js static asset
referenced by the landing page. It does not submit research jobs, invoke cron,
or call DataForSEO, OpenRouter, SERP, Trends, Expand, or Compare providers.
