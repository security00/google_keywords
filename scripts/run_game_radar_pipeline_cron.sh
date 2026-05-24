#!/usr/bin/env bash
set -euo pipefail

cd /root/clawd/projects/google_keywords

ENV_FILE="${ENV_FILE:-/root/.config/google_keywords/precompute.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

LOG_DIR="${GAME_RADAR_LOG_DIR:-/root/.local/state/google_keywords}"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="$LOG_DIR/game_radar_pipeline_$STAMP.log"
LOCK_FILE="/tmp/google_keywords_game_radar_pipeline.lock"

if [ -e "$LOCK_FILE" ]; then
  echo "status=skipped reason=lock_exists lock=$LOCK_FILE"
  exit 0
fi

cleanup() {
  rm -f "$LOCK_FILE"
}
trap cleanup EXIT
echo "$$" > "$LOCK_FILE"

TIMEOUT_SECONDS="${GAME_RADAR_PIPELINE_TIMEOUT_SECONDS:-900}"
RELEASE_LIMIT="${GAME_RADAR_RELEASE_LIMIT:-80}"
TREND_LIMIT="${GAME_RADAR_TREND_LIMIT:-25}"
SERP_LIMIT="${GAME_RADAR_SERP_LIMIT:-15}"
PROMOTE_LIMIT="${GAME_RADAR_PROMOTE_LIMIT:-10}"

set +e
timeout "$TIMEOUT_SECONDS" python3 scripts/game_radar_pipeline.py \
  --release-limit "$RELEASE_LIMIT" \
  --trend-limit "$TREND_LIMIT" \
  --serp-limit "$SERP_LIMIT" \
  --promote-limit "$PROMOTE_LIMIT" \
  --write > "$LOG_FILE" 2>&1
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -eq 0 ]; then
  STATUS="ok"
elif [ "$EXIT_CODE" -eq 124 ]; then
  STATUS="timeout"
else
  STATUS="error"
fi

echo "status=$STATUS"
echo "exit_code=$EXIT_CODE"
echo "log=$LOG_FILE"
echo "tail:"
tail -n 30 "$LOG_FILE" || true

exit "$EXIT_CODE"
