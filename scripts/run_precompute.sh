#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${GK_PRECOMPUTE_PROJECT_DIR:-/root/clawd/projects/google_keywords}"
ENV_FILE="${GK_PRECOMPUTE_ENV_FILE:-/root/.config/google_keywords/precompute.env}"
PYTHON_BIN="${GK_PRECOMPUTE_PYTHON_BIN:-python3}"
PRECOMPUTE_SCRIPT="${GK_PRECOMPUTE_SCRIPT:-scripts/precompute_shared_expand.py}"

if [ ! -f "$ENV_FILE" ]; then
  printf 'env file missing: %s\n' "$ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

cd "$PROJECT_DIR"
exec "$PYTHON_BIN" "$PRECOMPUTE_SCRIPT" "$@"
