#!/usr/bin/env bash
# Independent daily hook for /api/cron/lifecycle-emails.
#
# Do NOT add this to precompute or game pipeline crons.
# Do NOT register this in OpenClaw until reminder mail is approved.
# Even after registration, the script no-ops unless
# LIFECYCLE_EMAILS_CRON_ENABLED=true is set in the env file.
set -euo pipefail

ROOT="${GK_PROJECT_ROOT:-/root/clawd/projects/google_keywords}"
ENV_FILE="${ENV_FILE:-/root/.config/google_keywords/precompute.env}"
SITE_URL="${GK_SITE_URL:-https://discoverkeywords.co}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ "${LIFECYCLE_EMAILS_CRON_ENABLED:-false}" != "true" ]]; then
  echo "status=skipped"
  echo "reason=LIFECYCLE_EMAILS_CRON_ENABLED is not true"
  exit 0
fi

CRON_SECRET="${GK_CRON_SECRET:-${CRON_SECRET:-}}"
if [[ -z "$CRON_SECRET" ]]; then
  echo "status=error"
  echo "reason=missing cron secret"
  exit 1
fi

cd "$ROOT"

curl -sS -X GET "${SITE_URL}/api/cron/lifecycle-emails" \
  -H "x-cron-secret: ${CRON_SECRET}"
echo
