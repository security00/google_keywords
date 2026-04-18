#!/usr/bin/env bash

set -u

PROJECT_DIR="${GK_PRECOMPUTE_PROJECT_DIR:-/root/clawd/projects/google_keywords}"
ENV_FILE="${GK_PRECOMPUTE_ENV_FILE:-/root/.config/google_keywords/precompute.env}"
LOG_FILE="${GK_PRECOMPUTE_LOG_FILE:-/var/log/google-keywords-precompute.log}"
STATE_DIR="${GK_PRECOMPUTE_STATE_DIR:-/root/.local/state/google_keywords}"
LOCK_DIR="${GK_PRECOMPUTE_LOCK_DIR:-/tmp/google_keywords_precompute.lock}"

ATTEMPTS="${GK_PRECOMPUTE_RETRY_ATTEMPTS:-5}"
DELAY_SECONDS="${GK_PRECOMPUTE_RETRY_DELAY_SECONDS:-600}"
MAX_DELAY_SECONDS="${GK_PRECOMPUTE_RETRY_MAX_DELAY_SECONDS:-3600}"
PYTHON_BIN="${GK_PRECOMPUTE_PYTHON_BIN:-/usr/bin/python3}"
PRECOMPUTE_SCRIPT="${GK_PRECOMPUTE_SCRIPT:-scripts/precompute_shared_expand.py}"

mkdir -p "$(dirname "$LOG_FILE")" "$STATE_DIR"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE" 2>/dev/null || true

exec >> "$LOG_FILE" 2>&1

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

release_lock() {
  rm -rf "$LOCK_DIR"
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    trap release_lock EXIT INT TERM
    return 0
  fi

  existing_pid=""
  if [ -f "$LOCK_DIR/pid" ]; then
    existing_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  fi

  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    log "precompute already running with pid=$existing_pid; exiting"
    exit 0
  fi

  log "removing stale precompute lock"
  rm -rf "$LOCK_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    trap release_lock EXIT INT TERM
    return 0
  fi

  log "failed to acquire precompute lock"
  exit 1
}

if [ ! -f "$ENV_FILE" ]; then
  log "env file missing: $ENV_FILE"
  exit 1
fi

acquire_lock

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

attempt=1
delay="$DELAY_SECONDS"
last_exit=1

while [ "$attempt" -le "$ATTEMPTS" ]; do
  log "precompute attempt $attempt/$ATTEMPTS started"

  (
    cd "$PROJECT_DIR" &&
    "$PYTHON_BIN" "$PRECOMPUTE_SCRIPT"
  )
  last_exit=$?

  if [ "$last_exit" -eq 0 ]; then
    date -u '+%Y-%m-%dT%H:%M:%SZ' > "$STATE_DIR/last_success_at"
    rm -f "$STATE_DIR/last_failure"
    log "precompute attempt $attempt/$ATTEMPTS succeeded"
    exit 0
  fi

  printf 'exit=%s attempt=%s at=%s\n' \
    "$last_exit" \
    "$attempt" \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$STATE_DIR/last_failure"

  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    log "precompute failed after $ATTEMPTS attempts; last_exit=$last_exit"
    exit "$last_exit"
  fi

  log "precompute attempt $attempt/$ATTEMPTS failed with exit=$last_exit; retrying in ${delay}s"
  sleep "$delay"

  attempt=$((attempt + 1))
  delay=$((delay * 2))
  if [ "$delay" -gt "$MAX_DELAY_SECONDS" ]; then
    delay="$MAX_DELAY_SECONDS"
  fi
done

exit "$last_exit"
