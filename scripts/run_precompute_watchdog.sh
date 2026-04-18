#!/usr/bin/env bash

set -u

PROJECT_DIR="${GK_PRECOMPUTE_PROJECT_DIR:-/root/clawd/projects/google_keywords}"
ENV_FILE="${GK_PRECOMPUTE_ENV_FILE:-/root/.config/google_keywords/precompute.env}"
LOG_FILE="${GK_PRECOMPUTE_LOG_FILE:-/var/log/google-keywords-precompute.log}"
STATE_DIR="${GK_PRECOMPUTE_STATE_DIR:-/root/.local/state/google_keywords}"
LOCK_DIR="${GK_PRECOMPUTE_LOCK_DIR:-/tmp/google_keywords_precompute.lock}"
RUNNER_SCRIPT="${GK_PRECOMPUTE_RUNNER_SCRIPT:-scripts/run_precompute_with_retry.sh}"
PYTHON_BIN="${GK_PRECOMPUTE_PYTHON_BIN:-/usr/bin/python3}"
WATCHDOG_STALE_SECONDS="${GK_PRECOMPUTE_WATCHDOG_STALE_SECONDS:-900}"
WATCHDOG_MINUTE_THRESHOLD="${GK_PRECOMPUTE_WATCHDOG_MINUTE_THRESHOLD:-10}"
WATCHDOG_MAX_RETRY_ATTEMPTS="${GK_PRECOMPUTE_WATCHDOG_RETRY_ATTEMPTS:-2}"

mkdir -p "$(dirname "$LOG_FILE")" "$STATE_DIR"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE" 2>/dev/null || true

exec >> "$LOG_FILE" 2>&1

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

if [ ! -f "$ENV_FILE" ]; then
  log "watchdog env file missing: $ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

shared_date="$("$PYTHON_BIN" - <<'PY'
from datetime import datetime
from zoneinfo import ZoneInfo
import os
tz = ZoneInfo(os.environ.get("GK_PRECOMPUTE_TIMEZONE", "Asia/Shanghai"))
print(datetime.now(tz).strftime("%Y-%m-%d"))
PY
)"

state_path="$STATE_DIR/precompute_state_${shared_date}.json"

if [ -d "$LOCK_DIR" ] && [ -f "$LOCK_DIR/pid" ]; then
  existing_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    log "watchdog: precompute already running with pid=$existing_pid"
    exit 0
  fi
fi

watchdog_decision="$(STATE_PATH="$state_path" WATCHDOG_STALE_SECONDS="$WATCHDOG_STALE_SECONDS" WATCHDOG_MINUTE_THRESHOLD="$WATCHDOG_MINUTE_THRESHOLD" "$PYTHON_BIN" - <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

state_path = Path(os.environ["STATE_PATH"])
stale_seconds = int(os.environ["WATCHDOG_STALE_SECONDS"])
minute_threshold = int(os.environ["WATCHDOG_MINUTE_THRESHOLD"])
tz = ZoneInfo(os.environ.get("GK_PRECOMPUTE_TIMEZONE", "Asia/Shanghai"))

now_local = datetime.now(tz)
minutes_since_midnight = now_local.hour * 60 + now_local.minute
if minutes_since_midnight < minute_threshold:
    print("skip|before_threshold")
    sys.exit(0)

if not state_path.exists():
    print("run|missing_state")
    sys.exit(0)

try:
    state = json.loads(state_path.read_text())
except Exception:
    print("run|invalid_state")
    sys.exit(0)

stage = state.get("stage") or "unknown"
if stage == "complete":
    print("skip|complete")
    sys.exit(0)

updated_at = state.get("updatedAt") or state.get("stageStartedAt")
if not updated_at:
    print(f"run|no_timestamp:{stage}")
    sys.exit(0)

try:
    updated = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
except ValueError:
    print(f"run|bad_timestamp:{stage}")
    sys.exit(0)

age = (datetime.now(timezone.utc) - updated.astimezone(timezone.utc)).total_seconds()
if age >= stale_seconds:
    print(f"run|stale:{stage}:{int(age)}")
else:
    print(f"skip|fresh:{stage}:{int(age)}")
PY
)"

decision="${watchdog_decision%%|*}"
reason="${watchdog_decision#*|}"

if [ "$decision" != "run" ]; then
  log "watchdog: no action ($reason)"
  exit 0
fi

log "watchdog: resuming precompute ($reason)"
(
  cd "$PROJECT_DIR" &&
  GK_PRECOMPUTE_RETRY_ATTEMPTS="$WATCHDOG_MAX_RETRY_ATTEMPTS" \
  "$RUNNER_SCRIPT"
)
